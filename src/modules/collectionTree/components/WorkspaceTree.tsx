import { useEffect, useMemo, useRef, useState } from 'react'
import type { Collection, RequestItem, TreeSortMode } from '../types'
import type { Environment } from '../../../shared/types/environment'
import type { Workspace, WorkspaceFolder } from '../../../shared/types/workspace'
import { handleWorkspaceDrop, onDragOverMove, onWorkspaceFolderDragStart } from '../utils/treeDndHandlers'
import { getEffectiveWorkspaceSearchTreeOpenCommand, getSearchOpenWorkspaceFolders, getVisibleWorkspaceSearchTree, normalizeWorkspaceTreeSearch } from '../utils/workspaceTreeSearch'
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
  sortMode?: TreeSortMode
  environmentsByCollection: Record<string, Environment>
  activeRequestId?: string
  inFlightCountByRequestId?: Record<string, number>
  treeOpenCommand?: { action: 'expand' | 'collapse', nonce: number } | null
  onTreeAllExpandedChange?: (isAllExpanded: boolean) => void
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
  onMoveFolderToCollection?: (sourceCollectionId: string, folderId: string, targetCollectionId: string, targetParentFolderId: string | null) => void
  onMoveRequestToCollection?: (sourceCollectionId: string, requestId: string, targetCollectionId: string, targetFolderId: string | null) => void
  onDeleteFolder: (collectionId: string, folderId: string) => void
  onDeleteRequest: (collectionId: string, requestId: string) => void
  onDeleteCollection: (collectionId: string) => void
  onMoveCollectionToWorkspaceFolder: (collectionId: string, workspaceFolderId: string | null) => void
  onMoveWorkspaceFolder: (workspaceFolderId: string, targetParentWorkspaceFolderId: string | null) => void
  onAddWorkspaceFolderToFolder: (workspaceFolderId: string) => void
  onRenameWorkspaceFolder: (workspaceFolderId: string, name: string) => void
  onDeleteWorkspaceFolder: (workspaceFolderId: string) => void
}) {
  type OpenStateSummary = {
    totalCollections: number
    openCollections: number
    totalFolders: number
    openFolders: number
  }

  const [openWorkspaceFolders, setOpenWorkspaceFolders] = useState<Set<string>>(() => new Set(loadWorkspaceOpenIds()))
  const [collectionSummariesByScope, setCollectionSummariesByScope] = useState<Record<string, OpenStateSummary>>({})
  const [openMenuWorkspaceFolderId, setOpenMenuWorkspaceFolderId] = useState<string | null>(null)
  const menuWrapRef = useRef<HTMLDivElement | null>(null)
  const lastAppliedTreeCommandNonceRef = useRef<number | null>(null)
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchTerm = useMemo(() => normalizeWorkspaceTreeSearch(searchQuery), [searchQuery])

  const { visibleCollections, visibleWorkspaceFolders } = useMemo(
    () => getVisibleWorkspaceSearchTree(props.collections, props.workspace.folders, searchTerm),
    [props.collections, props.workspace.folders, searchTerm],
  )
  const searchOpenWorkspaceFolders = useMemo(() => {
    return getSearchOpenWorkspaceFolders(visibleWorkspaceFolders, searchTerm)
  }, [searchTerm, visibleWorkspaceFolders])
  const effectiveTreeOpenCommand = useMemo(() => {
    return getEffectiveWorkspaceSearchTreeOpenCommand({
      searchTerm,
      treeOpenCommand: props.treeOpenCommand,
      visibleWorkspaceFolderCount: visibleWorkspaceFolders.length,
      visibleCollectionCount: visibleCollections.length,
    })
  }, [props.treeOpenCommand, searchTerm, visibleWorkspaceFolders.length, visibleCollections.length])

  function applyMenuPosition(panel: HTMLDivElement | null) {
    if (!panel) return
    requestAnimationFrame(() => {
      const wrap = panel.parentElement
      const btn = wrap?.querySelector('button.treeMenuBtn') as HTMLButtonElement | null
      if (!btn) return

      panel.style.visibility = 'hidden'
      panel.style.position = 'fixed'
      panel.style.zIndex = '3000'
      panel.style.right = 'auto'
      panel.style.bottom = 'auto'
      panel.style.left = '0px'
      panel.style.top = '0px'

      const margin = 8
      const vw = document.documentElement.clientWidth
      const vh = document.documentElement.clientHeight
      const btnRect = btn.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()

      let left = btnRect.right - panelRect.width
      if (left < margin) left = btnRect.left
      left = Math.min(Math.max(margin, left), vw - margin - panelRect.width)

      let top = btnRect.bottom + 4
      if (top + panelRect.height > vh - margin) {
        const topUp = btnRect.top - 4 - panelRect.height
        if (topUp >= margin) top = topUp
        else top = Math.min(Math.max(margin, top), vh - margin - panelRect.height)
      }

      panel.style.left = `${Math.round(left)}px`
      panel.style.top = `${Math.round(top)}px`
      panel.style.visibility = 'visible'
    })
  }

  useEffect(() => {
    saveWorkspaceOpenIds(Array.from(openWorkspaceFolders))
  }, [openWorkspaceFolders])

  useEffect(() => {
    const cmd = props.treeOpenCommand
    if (!cmd) return
    if (lastAppliedTreeCommandNonceRef.current === cmd.nonce) return
    lastAppliedTreeCommandNonceRef.current = cmd.nonce

    setOpenMenuWorkspaceFolderId(null)
    setEditingFolderId(null)
    setDraftName('')

    if (cmd.action === 'collapse') {
      setOpenWorkspaceFolders(new Set())
      return
    }

    const ids: string[] = []
    function visit(folder: WorkspaceFolder) {
      ids.push(folder.id)
      for (const child of folder.folders ?? []) visit(child)
    }
    for (const folder of visibleWorkspaceFolders) visit(folder)
    setOpenWorkspaceFolders(new Set(ids))
  }, [props.treeOpenCommand, visibleWorkspaceFolders])

  const workspaceFolderIds = useMemo(() => {
    const ids: string[] = []
    function visit(folder: WorkspaceFolder) {
      ids.push(folder.id)
      for (const child of folder.folders ?? []) visit(child)
    }
    for (const folder of visibleWorkspaceFolders) visit(folder)
    return ids
  }, [visibleWorkspaceFolders])

  const collectionTreeScopeIds = useMemo(() => {
    const scopes = ['root']
    for (const id of workspaceFolderIds) scopes.push(`wf:${id}`)
    return scopes
  }, [workspaceFolderIds])

  useEffect(() => {
    setCollectionSummariesByScope(prev => {
      const next: Record<string, OpenStateSummary> = {}
      let changed = false
      for (const scopeId of collectionTreeScopeIds) {
        const summary = prev[scopeId]
        if (summary) next[scopeId] = summary
      }
      if (Object.keys(prev).length !== Object.keys(next).length) changed = true
      if (!changed) return prev
      return next
    })
  }, [collectionTreeScopeIds])

  function onCollectionScopeSummaryChange(scopeId: string, summary: OpenStateSummary) {
    setCollectionSummariesByScope(prev => {
      const current = prev[scopeId]
      if (
        current &&
        current.totalCollections === summary.totalCollections &&
        current.openCollections === summary.openCollections &&
        current.totalFolders === summary.totalFolders &&
        current.openFolders === summary.openFolders
      ) return prev
      return { ...prev, [scopeId]: summary }
    })
  }

  useEffect(() => {
    if (!props.onTreeAllExpandedChange) return

    const totalWorkspaceFolders = workspaceFolderIds.length
    const openWorkspaceFoldersCount = workspaceFolderIds.reduce((n, id) => n + (openWorkspaceFolders.has(id) ? 1 : 0), 0)

    let totalCollections = 0
    let openCollections = 0
    let totalFolders = 0
    let openFolders = 0
    for (const summary of Object.values(collectionSummariesByScope)) {
      totalCollections += summary.totalCollections
      openCollections += summary.openCollections
      totalFolders += summary.totalFolders
      openFolders += summary.openFolders
    }

    const total = totalWorkspaceFolders + totalCollections + totalFolders
    const openCount = openWorkspaceFoldersCount + openCollections + openFolders
    const isAllExpanded = total > 0 && openCount === total
    props.onTreeAllExpandedChange(isAllExpanded)
  }, [collectionSummariesByScope, openWorkspaceFolders, props.onTreeAllExpandedChange, workspaceFolderIds])

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
    if (!openMenuWorkspaceFolderId) return
    const wrap = menuWrapRef.current
    const scroller = (wrap?.closest?.('.sidebarTreeWrap') as HTMLElement | null) ?? null
    if (!scroller) return

    function onScroll() {
      setOpenMenuWorkspaceFolderId(null)
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [openMenuWorkspaceFolderId])

  useEffect(() => {
    if (!editingFolderId) return
    requestAnimationFrame(() => editInputRef.current?.focus())
  }, [editingFolderId])

  const { rootCollections, collectionsByWorkspaceFolderId } = useMemo(() => {
    const byId = new Map(visibleCollections.map(c => [c.id, c]))

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

    for (const folder of visibleWorkspaceFolders) visit(folder)

    const rootCollections = visibleCollections.filter(c => !inAnyFolder.has(c.id))
    return { rootCollections, collectionsByWorkspaceFolderId }
  }, [visibleCollections, visibleWorkspaceFolders])

  useEffect(() => {
    if (rootCollections.length) return
    onCollectionScopeSummaryChange('root', {
      totalCollections: 0,
      openCollections: 0,
      totalFolders: 0,
      openFolders: 0,
    })
  }, [rootCollections.length])

  function renderWorkspaceFolder(folder: WorkspaceFolder, depth: number) {
    const cols = collectionsByWorkspaceFolderId[folder.id] ?? []
    const isEditing = editingFolderId === folder.id
    const isMenuOpen = openMenuWorkspaceFolderId === folder.id && !isEditing
    const childWorkspaceFolders = folder.folders ?? []
    const directChildCount = cols.length + childWorkspaceFolders.length

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
        open={searchTerm ? !!searchOpenWorkspaceFolders?.has(folder.id) : openWorkspaceFolders.has(folder.id)}
        onToggle={e => {
          if (searchTerm) return
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
                    spellCheck={false}
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
                  <span className="small treeFolderCount">{directChildCount}</span>
                </span>
              ) : (
                <span className="treeFolderNameWrap">
                  <span className="treeFolderName" title={folder.name}>{folder.name}</span>
                  <span className="small treeFolderCount">{directChildCount}</span>
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
                  ref={applyMenuPosition}
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
            sortMode={props.sortMode}
            environmentsByCollection={props.environmentsByCollection}
            activeRequestId={props.activeRequestId}
            inFlightCountByRequestId={props.inFlightCountByRequestId}
            treeOpenCommand={effectiveTreeOpenCommand}
            onOpenStateSummaryChange={summary => onCollectionScopeSummaryChange(`wf:${folder.id}`, summary)}
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
            onMoveFolderToCollection={props.onMoveFolderToCollection}
            onMoveRequestToCollection={props.onMoveRequestToCollection}
            onDeleteFolder={props.onDeleteFolder}
            onDeleteRequest={props.onDeleteRequest}
            onDeleteCollection={props.onDeleteCollection}
          />
        ) : childWorkspaceFolders.length ? null : (
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
      <div className="workspaceTreeSearchWrap">
        <div className="workspaceTreeSearchField">
          <input
            ref={searchInputRef}
            type="text"
            className="workspaceTreeSearchInput"
            placeholder="Search workspace tree..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            spellCheck={false}
            aria-label="Search workspace tree"
          />
          {searchQuery ? (
            <button
              type="button"
              className="workspaceTreeSearchClearBtn"
              aria-label="Clear search"
              title="Clear"
              onClick={() => {
                setSearchQuery('')
                requestAnimationFrame(() => searchInputRef.current?.focus())
              }}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      <div className="tree">
        {visibleWorkspaceFolders.map(folder => renderWorkspaceFolder(folder, 0))}

        {rootCollections.length ? (
          <CollectionsTree
            collections={rootCollections}
            sortMode={props.sortMode}
            environmentsByCollection={props.environmentsByCollection}
            activeRequestId={props.activeRequestId}
            inFlightCountByRequestId={props.inFlightCountByRequestId}
            treeOpenCommand={effectiveTreeOpenCommand}
            onOpenStateSummaryChange={summary => onCollectionScopeSummaryChange('root', summary)}
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
            onMoveFolderToCollection={props.onMoveFolderToCollection}
            onMoveRequestToCollection={props.onMoveRequestToCollection}
            onDeleteFolder={props.onDeleteFolder}
            onDeleteRequest={props.onDeleteRequest}
            onDeleteCollection={props.onDeleteCollection}
          />
        ) : null}

        {!visibleWorkspaceFolders.length && !rootCollections.length ? (
          <div className="workspaceTreeEmptyState small">No matches found</div>
        ) : null}
      </div>
    </div>
  )
}
