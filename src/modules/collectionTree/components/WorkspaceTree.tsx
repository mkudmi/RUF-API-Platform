import { useEffect, useMemo, useRef, useState } from 'react'
import type { Collection, RequestItem } from '../types'
import type { Environment } from '../../../shared/types/environment'
import type { Workspace, WorkspaceFolder } from '../../../shared/types/workspace'
import { handleWorkspaceDrop, onDragOverMove, onWorkspaceFolderDragStart } from '../utils/treeDndHandlers'
import { CollectionsTree } from './CollectionsTree'

const WORKSPACE_OPEN_STATE_KEY = 'ruf_workspace_open_state_v1'

function loadWorkspaceOpenIds(): string[] {
  try {
    const raw = localStorage.getItem(WORKSPACE_OPEN_STATE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveWorkspaceOpenIds(ids: string[]) {
  localStorage.setItem(WORKSPACE_OPEN_STATE_KEY, JSON.stringify(ids))
}

export function WorkspaceTree(props: {
  workspace: Workspace
  collections: Collection[]
  environmentsByCollection: Record<string, Environment>
  activeRequestId?: string
  inFlightCountByRequestId?: Record<string, number>
  onPickRequest: (req: RequestItem, col: Collection) => void
  onOpenEnv: (collectionId: string) => void
  onUpdateCollectionFromUrl?: (collectionId: string) => void
  onReloadCollectionFromFile?: (collectionId: string) => void
  onAddRequest: (collectionId: string) => void
  onAddFolder: (collectionId: string) => void
  onAddRequestToFolder: (collectionId: string, folderId: string) => void
  onAddFolderToFolder: (collectionId: string, folderId: string) => void
  onRenameCollection: (collectionId: string, name: string) => void
  onRenameFolder: (collectionId: string, folderId: string, name: string) => void
  onRenameRequest: (collectionId: string, requestId: string, name: string) => void
  onDuplicateCollection: (collectionId: string) => void
  onDuplicateFolder: (collectionId: string, folderId: string) => void
  onDuplicateRequest: (collectionId: string, requestId: string) => void
  onMoveFolder: (collectionId: string, folderId: string, targetParentFolderId: string | null) => void
  onMoveRequest: (collectionId: string, requestId: string, targetFolderId: string | null) => void
  onDeleteFolder: (collectionId: string, folderId: string) => void
  onDeleteRequest: (collectionId: string, requestId: string) => void
  onDeleteCollection: (collectionId: string) => void
  onMoveCollectionToWorkspaceFolder: (collectionId: string, workspaceFolderId: string | null) => void
  onMoveWorkspaceFolder: (workspaceFolderId: string, targetParentWorkspaceFolderId: string | null) => void
  onAddWorkspaceFolderToFolder: (workspaceFolderId: string) => void
  onRenameWorkspaceFolder: (workspaceFolderId: string, name: string) => void
  onDeleteWorkspaceFolder: (workspaceFolderId: string) => void
}) {
  const [openWorkspaceFolders, setOpenWorkspaceFolders] = useState<Set<string>>(() => new Set(loadWorkspaceOpenIds()))
  const [openMenuWorkspaceFolderId, setOpenMenuWorkspaceFolderId] = useState<string | null>(null)
  const menuWrapRef = useRef<HTMLDivElement | null>(null)
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const editInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    saveWorkspaceOpenIds(Array.from(openWorkspaceFolders))
  }, [openWorkspaceFolders])

  useEffect(() => {
    if (!openMenuWorkspaceFolderId) return
    function onPointerDown(e: PointerEvent) {
      const el = menuWrapRef.current
      if (!el) return
      const target = e.target as Node | null
      if (!target) return
      if (el.contains(target)) return
      setOpenMenuWorkspaceFolderId(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [openMenuWorkspaceFolderId])

  useEffect(() => {
    if (!editingFolderId) return
    requestAnimationFrame(() => editInputRef.current?.focus())
  }, [editingFolderId])

  const { rootCollections, collectionsByWorkspaceFolderId } = useMemo(() => {
    const byId = new Map(props.collections.map(c => [c.id, c]))

    const inAnyFolder = new Set<string>()
    const collectionsByWorkspaceFolderId: Record<string, Collection[]> = {}

    function visit(folder: WorkspaceFolder) {
      const list: Collection[] = []
      for (const collectionId of folder.collectionIds) {
        const col = byId.get(collectionId)
        if (!col) continue
        list.push(col)
        inAnyFolder.add(collectionId)
      }
      collectionsByWorkspaceFolderId[folder.id] = list

      for (const child of folder.folders ?? []) visit(child)
    }

    for (const folder of props.workspace.folders) visit(folder)

    const rootCollections = props.collections.filter(c => !inAnyFolder.has(c.id))
    return { rootCollections, collectionsByWorkspaceFolderId }
  }, [props.collections, props.workspace.folders])

  function renderWorkspaceFolder(folder: WorkspaceFolder, depth: number) {
    const cols = collectionsByWorkspaceFolderId[folder.id] ?? []
    const isEditing = editingFolderId === folder.id
    const isMenuOpen = openMenuWorkspaceFolderId === folder.id && !isEditing
    const childWorkspaceFolders = folder.folders ?? []

    function startRename() {
      setOpenMenuWorkspaceFolderId(null)
      setEditingFolderId(folder.id)
      setDraftName(folder.name)
    }

    function cancelRename() {
      setEditingFolderId(null)
      setDraftName('')
    }

    function submitRename() {
      const next = draftName.trim()
      cancelRename()
      if (!next || next === folder.name) return
      props.onRenameWorkspaceFolder(folder.id, next)
    }

    return (
      <details
        key={folder.id}
        className={depth ? 'treeGroup treeWorkspaceFolder treeWorkspaceFolderInner' : 'treeGroup treeWorkspaceFolder'}
        open={openWorkspaceFolders.has(folder.id)}
        onToggle={e => {
          const isOpen = (e.currentTarget as HTMLDetailsElement).open
          setOpenWorkspaceFolders(prev => {
            const next = new Set(prev)
            if (isOpen) next.add(folder.id)
            else next.delete(folder.id)
            return next
          })
        }}
      >
        <summary
          className="treeSummary treeSummaryWorkspaceFolder"
          onPointerDown={e => {
            if (!isEditing) return
            const target = e.target as HTMLElement | null
            if (target?.closest?.('input')) return
            e.preventDefault()
            e.stopPropagation()
            cancelRename()
          }}
        >
          <div
            className="treeSummaryDnd"
            draggable={!isEditing}
            onDragStart={e => {
              if (isEditing) return
              onWorkspaceFolderDragStart(e, folder.id)
            }}
            onDragOver={e => {
              onDragOverMove(e)
            }}
            onDrop={e => {
              handleWorkspaceDrop(e, {
                targetWorkspaceFolderId: folder.id,
                onMoveWorkspaceFolder: props.onMoveWorkspaceFolder,
                onMoveCollectionToWorkspaceFolder: props.onMoveCollectionToWorkspaceFolder,
              })
            }}
          >
            <span className="treeChevron" aria-hidden="true" />
            <div className="treeSummaryLeft">
              {isEditing ? (
                <span className="treeFolderNameWrap">
                  <input
                    ref={editInputRef}
                    className="treeFolderName treeNameEditing"
                    value={draftName}
                    onChange={e => setDraftName(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onPointerDown={e => e.stopPropagation()}
                    onKeyDown={e => {
                      e.stopPropagation()
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        submitRename()
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelRename()
                      }
                    }}
                    onBlur={submitRename}
                    style={{ width: '100%', background: 'transparent', border: 0, color: 'inherit', padding: 0 }}
                  />
                  <span className="small treeFolderCount">{cols.length}</span>
                </span>
              ) : (
                <span className="treeFolderNameWrap">
                  <span className="treeFolderName">{folder.name}</span>
                  <span className="small treeFolderCount">{cols.length}</span>
                </span>
              )}
            </div>

            <div className="treeSummaryRight">
              <div ref={isMenuOpen ? menuWrapRef : null} className="treeMenuWrap">
                <button
                  type="button"
                  className="iconBtn treeMenuBtn"
                  disabled={isEditing}
                  onPointerDown={e => {
                    if (isEditing) return
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={e => {
                    if (isEditing) return
                    e.preventDefault()
                    e.stopPropagation()
                    setOpenMenuWorkspaceFolderId(prev => (prev === folder.id ? null : folder.id))
                  }}
                  aria-label="Folder menu"
                  title="Menu"
                >
                  ...
                </button>

              {isMenuOpen ? (
                <div
                  className="treeMenuPanel"
                  role="menu"
                  onPointerDown={e => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                >
                  <button
                    type="button"
                    className="treeMenuItem"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenuWorkspaceFolderId(null)
                      setOpenWorkspaceFolders(prev => new Set(prev).add(folder.id))
                      props.onAddWorkspaceFolderToFolder(folder.id)
                    }}
                  >
                    Add Folder
                  </button>
                  <button
                    type="button"
                    className="treeMenuItem"
                    role="menuitem"
                    onClick={() => startRename()}
                  >
                    Rename
                  </button>
                  <div className="treeMenuDivider" role="separator" />
                  <button
                    type="button"
                    className="treeMenuItem treeMenuItemDanger"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenuWorkspaceFolderId(null)
                      props.onDeleteWorkspaceFolder(folder.id)
                    }}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          </div>
        </summary>

        {childWorkspaceFolders.map(child => renderWorkspaceFolder(child, depth + 1))}

        {cols.length ? (
          <CollectionsTree
            collections={cols}
            environmentsByCollection={props.environmentsByCollection}
            activeRequestId={props.activeRequestId}
            inFlightCountByRequestId={props.inFlightCountByRequestId}
            onPickRequest={props.onPickRequest}
            onOpenEnv={props.onOpenEnv}
            onUpdateCollectionFromUrl={props.onUpdateCollectionFromUrl}
            onReloadCollectionFromFile={props.onReloadCollectionFromFile}
            onAddRequest={props.onAddRequest}
            onAddFolder={props.onAddFolder}
            onAddRequestToFolder={props.onAddRequestToFolder}
            onAddFolderToFolder={props.onAddFolderToFolder}
            onRenameCollection={props.onRenameCollection}
            onRenameFolder={props.onRenameFolder}
            onRenameRequest={props.onRenameRequest}
            onDuplicateCollection={props.onDuplicateCollection}
            onDuplicateFolder={props.onDuplicateFolder}
            onDuplicateRequest={props.onDuplicateRequest}
            onMoveFolder={props.onMoveFolder}
            onMoveRequest={props.onMoveRequest}
            onDeleteFolder={props.onDeleteFolder}
            onDeleteRequest={props.onDeleteRequest}
            onDeleteCollection={props.onDeleteCollection}
          />
        ) : (
          <div className="small" style={{ padding: '6px 4px', color: 'rgba(255,255,255,.55)' }}>
            Drop collections here
          </div>
        )}
      </details>
    )
  }

  return (
    <div
      className="workspaceRoot"
      onDragOver={e => {
        onDragOverMove(e)
      }}
      onDrop={e => {
        handleWorkspaceDrop(e, {
          targetWorkspaceFolderId: null,
          onMoveWorkspaceFolder: props.onMoveWorkspaceFolder,
          onMoveCollectionToWorkspaceFolder: props.onMoveCollectionToWorkspaceFolder,
        })
      }}
    >
      <div className="tree">
        {props.workspace.folders.map(folder => renderWorkspaceFolder(folder, 0))}

        <CollectionsTree
          collections={rootCollections}
          environmentsByCollection={props.environmentsByCollection}
          activeRequestId={props.activeRequestId}
          inFlightCountByRequestId={props.inFlightCountByRequestId}
          onPickRequest={props.onPickRequest}
          onOpenEnv={props.onOpenEnv}
          onUpdateCollectionFromUrl={props.onUpdateCollectionFromUrl}
          onReloadCollectionFromFile={props.onReloadCollectionFromFile}
          onAddRequest={props.onAddRequest}
          onAddFolder={props.onAddFolder}
          onAddRequestToFolder={props.onAddRequestToFolder}
          onAddFolderToFolder={props.onAddFolderToFolder}
          onRenameCollection={props.onRenameCollection}
          onRenameFolder={props.onRenameFolder}
          onRenameRequest={props.onRenameRequest}
          onDuplicateCollection={props.onDuplicateCollection}
          onDuplicateFolder={props.onDuplicateFolder}
          onDuplicateRequest={props.onDuplicateRequest}
          onMoveFolder={props.onMoveFolder}
          onMoveRequest={props.onMoveRequest}
          onDeleteFolder={props.onDeleteFolder}
          onDeleteRequest={props.onDeleteRequest}
          onDeleteCollection={props.onDeleteCollection}
        />
      </div>
    </div>
  )
}
