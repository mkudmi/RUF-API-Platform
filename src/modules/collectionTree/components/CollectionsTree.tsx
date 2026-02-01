import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { Collection, Folder, RequestItem } from '../types'
import type { Environment } from '../../../shared/types/environment'
import { copyText } from '../../../shared/utils/clipboard'
import { asCollectionDropArgs, handleCollectionTreeDrop, onCollectionDragStart as setCollectionDragData, onDragOverMove, onFolderDragStart as setFolderDragData, onRequestDragStart as setRequestDragData } from '../utils/treeDndHandlers'
import { buildPostmanCollectionFromRufCollection } from '../../export/rufCollection/rufCollectionExporter'

const TREE_OPEN_STATE_KEY = 'ruf_tree_open_state_v1'

type FileSystemFileHandleLike = {
  createWritable: () => Promise<{
    write: (data: string | Blob | BufferSource) => Promise<void>
    close: () => Promise<void>
  }>
}

type TreeOpenState = {
  collections: string[]
  folders: string[]
}

function loadTreeOpenState(): TreeOpenState {
  try {
    const raw = localStorage.getItem(TREE_OPEN_STATE_KEY)
    if (!raw) return { collections: [], folders: [] }
    const parsed = JSON.parse(raw) as any
    const collections = Array.isArray(parsed?.collections) ? parsed.collections.filter((x: any) => typeof x === 'string') : []
    const folders = Array.isArray(parsed?.folders) ? parsed.folders.filter((x: any) => typeof x === 'string') : []
    return { collections, folders }
  } catch {
    return { collections: [], folders: [] }
  }
}

function saveTreeOpenState(state: TreeOpenState) {
  localStorage.setItem(TREE_OPEN_STATE_KEY, JSON.stringify(state))
}

function sanitizeFileNameBase(rawName: string) {
  const trimmed = rawName.trim()
  const replaced = trimmed.replaceAll(/[\\/:*?"<>|]/g, '_')
  const cleaned = replaced.replaceAll(/\s+/g, ' ').replaceAll(/[. ]+$/g, '')
  return cleaned || 'collection'
}

function normalizeRufCollectionFileName(rawName: string) {
  const base = sanitizeFileNameBase(rawName)
  const lower = base.toLowerCase()
  if (lower.endsWith('.rufcollection')) return base
  if (lower.endsWith('.ruf_collection')) return `${base.slice(0, -'.ruf_collection'.length)}.rufcollection`
  return `${base}.rufcollection`
}

async function saveTextWithSuggestedName(args: { suggestedName: string, text: string }) {
  try {
    const w = window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandleLike> }
    if (typeof w.showSaveFilePicker === 'function') {
        const handle = await w.showSaveFilePicker({
          suggestedName: args.suggestedName,
          types: [
            {
              description: 'JSON Source file',
              accept: { 'application/json': ['.rufcollection'] },
            },
          ],
        })
      const writable = await handle.createWritable()
      await writable.write(args.text)
      await writable.close()
      return
    }

    const blob = new Blob([args.text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = args.suggestedName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    if ((e as Error | null)?.name !== 'AbortError') throw e
  }
}

export function CollectionsTree(props: {
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
}) {
  type EditingTarget = { kind: 'collection' | 'folder' | 'request', id: string } | null

  const [editing, setEditing] = useState<EditingTarget>(null)
  const [draftName, setDraftName] = useState('')
  const nameEditableRef = useRef<HTMLElement | null>(null)
  const suppressNextBlurRef = useRef(false)
  const [openMenuCollectionId, setOpenMenuCollectionId] = useState<string | null>(null)
  const collectionMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const [openMenuFolderId, setOpenMenuFolderId] = useState<string | null>(null)
  const folderMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const [openMenuRequestId, setOpenMenuRequestId] = useState<string | null>(null)
  const requestMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const [openCollections, setOpenCollections] = useState<Set<string>>(() => new Set(loadTreeOpenState().collections))
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set(loadTreeOpenState().folders))
  const [, setDraggingFolder] = useState<{ collectionId: string, folderId: string } | null>(null)
  const [, setDraggingRequest] = useState<{ collectionId: string, requestId: string } | null>(null)

  async function exportCollection(col: Collection) {
    const env = props.environmentsByCollection[col.id]
    const postman = buildPostmanCollectionFromRufCollection({ collection: col, environment: env })
    const text = JSON.stringify(postman, null, 2)
    const fileName = normalizeRufCollectionFileName(col.name || 'collection')
    await saveTextWithSuggestedName({ suggestedName: fileName, text })
  }

  function applyMenuAutoFlip(panel: HTMLDivElement | null) {
    if (!panel) return
    requestAnimationFrame(() => {
      panel.classList.remove('treeMenuPanelFlipX', 'treeMenuPanelFlipY')

      const rect = panel.getBoundingClientRect()
      const vw = document.documentElement.clientWidth
      const vh = document.documentElement.clientHeight
      const margin = 8

      let flipX = rect.left < margin
      if (flipX) {
        panel.classList.add('treeMenuPanelFlipX')
        const rect2 = panel.getBoundingClientRect()
        if (rect2.right > vw - margin && rect.right <= vw - margin) {
          panel.classList.remove('treeMenuPanelFlipX')
          flipX = false
        }
}

      const flipY = rect.bottom > vh - margin && rect.height < vh - margin * 2

      if (flipY) panel.classList.add('treeMenuPanelFlipY')
    })
  }

  function countRequests(folder: Folder): number {
    const nested = (folder.folders ?? []).reduce((n, f) => n + countRequests(f), 0)
    return folder.requests.length + nested
  }

  const requestCountByCollection = useMemo(() => {
    const out: Record<string, number> = {}
    for (const col of props.collections) {
      out[col.id] = (col.requests ?? []).length + col.folders.reduce((n, f) => n + countRequests(f), 0)
    }
    return out
  }, [props.collections])

  useEffect(() => {
    saveTreeOpenState({ collections: Array.from(openCollections), folders: Array.from(openFolders) })
  }, [openCollections, openFolders])

  useEffect(() => {
    if (!editing) return
    requestAnimationFrame(() => {
      const el = nameEditableRef.current
      if (!el) return
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
  }, [editing])

  useEffect(() => {
    if (!openMenuCollectionId) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null
      const wrap = collectionMenuWrapRef.current
      if (t && wrap && wrap.contains(t)) return
      setOpenMenuCollectionId(null)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenMenuCollectionId(null)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenuCollectionId])

  useEffect(() => {
    if (!openMenuFolderId) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null
      const wrap = folderMenuWrapRef.current
      if (t && wrap && wrap.contains(t)) return
      setOpenMenuFolderId(null)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenMenuFolderId(null)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenuFolderId])

  useEffect(() => {
    if (!openMenuRequestId) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null
      const wrap = requestMenuWrapRef.current
      if (t && wrap && wrap.contains(t)) return
      setOpenMenuRequestId(null)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenMenuRequestId(null)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenuRequestId])

  function displayMethod(m: string) {
    return m === 'DELETE' ? 'DEL' : m
  }

  function inFlightMethodClass(requestId: string, method: string): string {
    const inFlight = (props.inFlightCountByRequestId?.[requestId] ?? 0) > 0
    if (!inFlight) return ''
    return `treeMethodInFlight treeMethodInFlight${method}`
  }

  function onFolderDragStart(e: DragEvent<HTMLElement>, collectionId: string, folderId: string) {
    setDraggingFolder({ collectionId, folderId })
    setFolderDragData(e, collectionId, folderId)
  }

  function onFolderDragEnd() {
    setDraggingFolder(null)
  }

  function onRequestDragStart(e: DragEvent<HTMLElement>, collectionId: string, requestId: string) {
    setDraggingRequest({ collectionId, requestId })
    setRequestDragData(e, collectionId, requestId)
  }

  function onRequestDragEnd() {
    setDraggingRequest(null)
  }

  function renderFolder(col: Collection, folder: Folder) {
    const childFolders = folder.folders ?? []
    const reqCount = countRequests(folder)
    const isEditing = editing?.kind === 'folder' && editing.id === folder.id
    const isFolderMenuOpen = openMenuFolderId === folder.id && !isEditing

    function startRename() {
      suppressNextBlurRef.current = false
      setOpenMenuFolderId(null)
      setEditing({ kind: 'folder', id: folder.id })
      setDraftName(folder.name)
    }

    function cancelRename() {
      setEditing(null)
      setDraftName('')
    }

    function submitRename() {
      const next = (nameEditableRef.current?.innerText ?? draftName).trim()
      cancelRename()
      if (!next || next === folder.name) return
      props.onRenameFolder(col.id, folder.id, next)
    }

    return (
      <details
        key={folder.id}
        className="treeGroup treeGroupInner"
        open={openFolders.has(folder.id)}
        onToggle={e => {
          const isOpen = (e.currentTarget as HTMLDetailsElement).open
          setOpenFolders(prev => {
            const next = new Set(prev)
            if (isOpen) next.add(folder.id)
            else next.delete(folder.id)
            return next
          })
        }}
      >
        <summary
          className="treeSummary treeSummaryFolder"
          draggable={!isEditing}
          onPointerDown={e => {
            if (!isEditing) return
            const target = e.target as HTMLElement | null
            const nameEl = nameEditableRef.current
            const clickedConfirm = !!target?.closest?.('.treeRenameIconConfirm')
            const clickedName = !!(nameEl && target && nameEl.contains(target))
            if (clickedConfirm || clickedName) return
            e.preventDefault()
            e.stopPropagation()
            suppressNextBlurRef.current = true
            cancelRename()
          }}
          onDragStart={e => {
            if (isEditing) return
            onFolderDragStart(e, col.id, folder.id)
          }}
          onDragEnd={() => {
            if (isEditing) return
            onFolderDragEnd()
          }}
          onDragOver={e => {
            onDragOverMove(e)
          }}
          onDrop={e => {
            handleCollectionTreeDrop(e, {
              ...asCollectionDropArgs(col, folder.id),
              onMoveFolder: props.onMoveFolder,
              onMoveRequest: props.onMoveRequest,
            })
          }}
        >
          <span className="treeChevron" aria-hidden="true" />
          <div className="treeSummaryLeft">
            {isEditing ? (
              <span className="treeFolderNameWrap">
                <span
                  ref={nameEditableRef as any}
                  className="treeFolderName treeNameEditing"
                  contentEditable
                  suppressContentEditableWarning
                  onClick={e => e.stopPropagation()}
                  onPointerDown={e => e.stopPropagation()}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      suppressNextBlurRef.current = true
                      submitRename()
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      suppressNextBlurRef.current = true
                      cancelRename()
                    }
                  }}
                  onBlur={() => {
                    if (suppressNextBlurRef.current) {
                      suppressNextBlurRef.current = false
                      return
                    }
                    cancelRename()
                  }}
                  role="textbox"
                  aria-label="Folder name"
                >
                  {draftName}
                </span>
                <span className="small treeFolderCount">{reqCount}</span>
                <button
                  className="treeRenameIcon treeRenameIconConfirm"
                  onPointerDown={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    suppressNextBlurRef.current = true
                  }}
                  onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    submitRename()
                  }}
                  aria-label="Save folder name"
                  title="Save"
                >
                  ƒo"
                </button>
              </span>
            ) : (
              <span className="treeFolderNameWrap">
                <span
                  className="treeFolderName"
                >
                  {folder.name}
                </span>
                <span className="small treeFolderCount">{reqCount}</span>
                <button
                  className="treeRenameIcon"
                  onPointerDown={e => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    startRename()
                  }}
                  aria-label="Rename folder"
                  title="Rename"
                >
                  ƒoZ
                </button>
              </span>
            )}
          </div>
          <div className="treeSummaryRight">
            {isEditing ? (
              <button
                className="treeRenameIcon treeRenameIconConfirm"
                onPointerDown={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  suppressNextBlurRef.current = true
                }}
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  submitRename()
                }}
                aria-label="Save folder name"
                title="Save"
              >
                OK
              </button>
            ) : null}

            <div ref={isFolderMenuOpen ? folderMenuWrapRef : null} className="treeMenuWrap">
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
                  setOpenMenuCollectionId(null)
                  setOpenMenuFolderId(prev => (prev === folder.id ? null : folder.id))
                }}
                aria-label="Folder menu"
                title="Menu"
              >
                ...
              </button>

              {isFolderMenuOpen ? (
                <div
                  className="treeMenuPanel"
                  role="menu"
                  ref={applyMenuAutoFlip}
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
                      setOpenMenuFolderId(null)
                      setOpenFolders(prev => new Set(prev).add(folder.id))
                      props.onAddRequestToFolder(col.id, folder.id)
                    }}
                  >
                    Add Request
                  </button>
                  <button
                    type="button"
                    className="treeMenuItem"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenuFolderId(null)
                      setOpenFolders(prev => new Set(prev).add(folder.id))
                      props.onAddFolderToFolder(col.id, folder.id)
                    }}
                  >
                    Add Folder
                  </button>
                  <button
                    type="button"
                    className="treeMenuItem"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenuFolderId(null)
                      void copyText(folder.name)
                    }}
                  >
                    Copy Name
                  </button>
                  <button
                    type="button"
                    className="treeMenuItem"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenuFolderId(null)
                      props.onDuplicateFolder(col.id, folder.id)
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="treeMenuItem"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenuFolderId(null)
                      startRename()
                    }}
                  >
                    Rename
                  </button>
                  <div className="treeMenuDivider" role="separator" />
                  <button
                    type="button"
                    className="treeMenuItem treeMenuItemDanger"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenuFolderId(null)
                      props.onDeleteFolder(col.id, folder.id)
                    }}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </summary>

        {childFolders.map(f => renderFolder(col, f))}

        <div className="treeItems">
          {folder.requests.map(r => {
            const active = props.activeRequestId === r.id
            const isEditingRequest = editing?.kind === 'request' && editing.id === r.id
            const isRequestMenuOpen = openMenuRequestId === r.id && !isEditingRequest

            function startRenameRequest() {
              suppressNextBlurRef.current = false
              setOpenMenuRequestId(null)
              setEditing({ kind: 'request', id: r.id })
              setDraftName(r.name)
            }

            function cancelRenameRequest() {
              setEditing(null)
              setDraftName('')
            }

            function submitRenameRequest() {
              const next = (nameEditableRef.current?.innerText ?? draftName).trim()
              cancelRenameRequest()
              if (!next || next === r.name) return
              props.onRenameRequest(col.id, r.id, next)
            }

            return (
              <div
                key={r.id}
                className={`treeItem ${active ? 'treeItemActive' : ''}`}
                draggable={!isEditingRequest}
                onClick={() => {
                  if (isEditingRequest) return
                  props.onPickRequest(r, col)
                }}
                onDragStart={e => {
                  if (isEditingRequest) return
                  onRequestDragStart(e, col.id, r.id)
                }}
                onDragEnd={() => {
                  if (isEditingRequest) return
                  onRequestDragEnd()
                }}
              >
                <span className={`mono small treeMethod ${inFlightMethodClass(r.id, r.method)}`}>{displayMethod(r.method)}</span>
                {isEditingRequest ? (
                  <span className="treeItemNameWrap">
                    <span
                      ref={nameEditableRef as any}
                      className="treeItemName treeNameEditing"
                      contentEditable
                      suppressContentEditableWarning
                      onClick={e => e.stopPropagation()}
                      onPointerDown={e => e.stopPropagation()}
                      onKeyDown={e => {
                        e.stopPropagation()
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          suppressNextBlurRef.current = true
                          submitRenameRequest()
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          suppressNextBlurRef.current = true
                          cancelRenameRequest()
                        }
                      }}
                      onBlur={() => {
                        if (suppressNextBlurRef.current) {
                          suppressNextBlurRef.current = false
                          return
                        }
                        cancelRenameRequest()
                      }}
                      role="textbox"
                      aria-label="Request name"
                    >
                      {draftName}
                    </span>
                    <button
                      className="treeRenameIcon treeRenameIconConfirm"
                      onPointerDown={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        suppressNextBlurRef.current = true
                      }}
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        submitRenameRequest()
                      }}
                      aria-label="Save request name"
                      title="Save"
                    >
                      ƒo"
                    </button>
                  </span>
                ) : (
                  <span className="treeItemNameWrap">
                    <span
                      className="treeItemName"
                      onDoubleClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        startRenameRequest()
                      }}
                      title="Double-click to rename"
                    >
                      {r.name}
                    </span>
                    <button
                      className="treeRenameIcon"
                      onPointerDown={e => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        startRenameRequest()
                      }}
                      aria-label="Rename request"
                      title="Rename"
                    >
                      ƒoZ
                    </button>
                  </span>
                )}

                <div ref={isRequestMenuOpen ? requestMenuWrapRef : null} className="treeMenuWrap">
                  <button
                    type="button"
                    className="iconBtn treeMenuBtn"
                    onPointerDown={e => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onClick={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      setOpenMenuCollectionId(null)
                      setOpenMenuFolderId(null)
                      setOpenMenuRequestId(prev => (prev === r.id ? null : r.id))
                    }}
                    aria-label="Request menu"
                    title="Menu"
                  >
                    ...
                  </button>

                  {isRequestMenuOpen ? (
                    <div
                      className="treeMenuPanel"
                      role="menu"
                      ref={applyMenuAutoFlip}
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
                          setOpenMenuRequestId(null)
                          props.onDuplicateRequest(col.id, r.id)
                        }}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="treeMenuItem"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenuRequestId(null)
                          startRenameRequest()
                        }}
                      >
                        Rename
                      </button>
                      <div className="treeMenuDivider" role="separator" />
                      <button
                        type="button"
                        className="treeMenuItem treeMenuItemDanger"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenuRequestId(null)
                          props.onDeleteRequest(col.id, r.id)
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </details>
    )
  }

  return (
    <div className="tree">
      {props.collections.map(col => (
        <details
          key={col.id}
          className="treeGroup"
          open={openCollections.has(col.id)}
          onToggle={e => {
            const isOpen = (e.currentTarget as HTMLDetailsElement).open
            setOpenCollections(prev => {
              const next = new Set(prev)
              if (isOpen) next.add(col.id)
              else next.delete(col.id)
              return next
            })
          }}
        >
          {(() => {
            const reqCount = requestCountByCollection[col.id] ?? 0
            const isEditing = editing?.kind === 'collection' && editing.id === col.id
            const isMenuOpen = !isEditing && openMenuCollectionId === col.id

            function startRename() {
              suppressNextBlurRef.current = false
              setOpenMenuCollectionId(null)
              setEditing({ kind: 'collection', id: col.id })
              setDraftName(col.name)
            }

            function cancelRename() {
              setEditing(null)
              setDraftName('')
            }

            function submitRename() {
              const next = (nameEditableRef.current?.innerText ?? draftName).trim()
              cancelRename()
              if (!next || next === col.name) return
              props.onRenameCollection(col.id, next)
            }

            return (
              <>
                <summary
                  className="treeSummary"
                  draggable={!isEditing}
                  onPointerDown={e => {
                    if (!isEditing) return
                    const target = e.target as HTMLElement | null
                    const nameEl = nameEditableRef.current
                    const clickedConfirm = !!target?.closest?.('.treeRenameIconConfirm')
                    const clickedName = !!(nameEl && target && nameEl.contains(target))
                    if (clickedConfirm || clickedName) return
                    e.preventDefault()
                    e.stopPropagation()
                    suppressNextBlurRef.current = true
                    cancelRename()
                  }}
                  onDragStart={e => {
                    if (isEditing) return
                    setCollectionDragData(e, col.id)
                  }}
                  onDragOver={e => {
                    onDragOverMove(e)
                  }}
                  onDrop={e => {
                    handleCollectionTreeDrop(e, {
                      ...asCollectionDropArgs(col, null),
                      onMoveFolder: props.onMoveFolder,
                      onMoveRequest: props.onMoveRequest,
                    })
                  }}
                >
                  <span className="treeChevron" aria-hidden="true" />
                  <div className="treeSummaryLeft">
                    {isEditing ? (
                      <span className="treeCollectionNameWrap">
                        <b
                          ref={nameEditableRef as any}
                          className="treeCollectionName treeCollectionNameEditing"
                          contentEditable
                          suppressContentEditableWarning
                          onClick={e => e.stopPropagation()}
                          onPointerDown={e => e.stopPropagation()}
                          onKeyDown={e => {
                            e.stopPropagation()
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              suppressNextBlurRef.current = true
                              submitRename()
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              suppressNextBlurRef.current = true
                              cancelRename()
                            }
                          }}
                          onBlur={() => {
                            if (suppressNextBlurRef.current) {
                              suppressNextBlurRef.current = false
                              return
                            }
                            cancelRename()
                          }}
                          role="textbox"
                          aria-label="Collection name"
                        >
                          {draftName}
                        </b>
                        <span className="small treeCollectionCount">{reqCount}</span>
                        <button
                          className="treeRenameIcon treeRenameIconConfirm"
                          onPointerDown={e => {
                            e.preventDefault()
                            e.stopPropagation()
                            suppressNextBlurRef.current = true
                          }}
                          onClick={e => {
                            e.preventDefault()
                            e.stopPropagation()
                            submitRename()
                          }}
                          aria-label="Save collection name"
                          title="Save"
                        >
                          ✓
                        </button>
                      </span>
                    ) : (
                      <span className="treeCollectionNameWrap">
                        <b
                          className="treeCollectionName"
                          onDoubleClick={e => {
                            e.preventDefault()
                            e.stopPropagation()
                            startRename()
                          }}
                          title="Double-click to rename"
                        >
                          {col.name}
                        </b>
                        <span className="small treeCollectionCount">{reqCount}</span>
                        <button
                          className="treeRenameIcon"
                          onPointerDown={e => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onClick={e => {
                            e.preventDefault()
                            e.stopPropagation()
                            startRename()
                          }}
                          aria-label="Rename collection"
                          title="Rename"
                        >
                          ✎
                        </button>
                      </span>
                    )}
                  </div>
                  <div className="treeSummaryRight">
                    {isEditing ? (
                      <button
                        className="treeRenameIcon treeRenameIconConfirm"
                        onPointerDown={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          suppressNextBlurRef.current = true
                        }}
                        onClick={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          submitRename()
                        }}
                        aria-label="Save collection name"
                        title="Save"
                      >
                        OK
                      </button>
                    ) : null}

                    <div ref={isMenuOpen ? collectionMenuWrapRef : null} className="treeMenuWrap">
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
                          setOpenMenuFolderId(null)
                          setOpenMenuCollectionId(prev => (prev === col.id ? null : col.id))
                        }}
                        aria-label="Collection menu"
                        title="Menu"
                      >
                        ...
                      </button>

                      {isMenuOpen ? (
                        <div
                          className="treeMenuPanel"
                          role="menu"
                          ref={applyMenuAutoFlip}
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
                              setOpenMenuCollectionId(null)
                              props.onAddRequest(col.id)
                            }}
                          >
                            Add Request
                          </button>
                          <button
                            type="button"
                            className="treeMenuItem"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuCollectionId(null)
                              props.onAddFolder(col.id)
                            }}
                          >
                            Add Folder
                          </button>
                          <button
                            type="button"
                            className="treeMenuItem"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuCollectionId(null)
                              props.onDuplicateCollection(col.id)
                            }}
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            className="treeMenuItem"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuCollectionId(null)
                              void exportCollection(col).catch(e => {
                                // eslint-disable-next-line no-console
                                console.error(e)
                                alert((e as Error | null)?.message || 'Export failed')
                              })
                            }}
                          >
                            Export
                          </button>
                          <button
                            type="button"
                            className="treeMenuItem"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuCollectionId(null)
                              startRename()
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="treeMenuItem"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuCollectionId(null)
                              props.onOpenEnv(col.id)
                            }}
                          >
                            Enviroment
                          </button>
                          {col.sourceUrl && props.onUpdateCollectionFromUrl ? (
                            <button
                              type="button"
                              className="treeMenuItem"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenuCollectionId(null)
                                props.onUpdateCollectionFromUrl?.(col.id)
                              }}
                              title={col.sourceUrl}
                            >
                              Update from URL
                            </button>
                          ) : null}
                          {col.sourceType === 'file' && props.onReloadCollectionFromFile ? (
                            <button
                              type="button"
                              className="treeMenuItem"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenuCollectionId(null)
                                props.onReloadCollectionFromFile?.(col.id)
                              }}
                              title={col.sourceFileName}
                            >
                              Reload From File
                            </button>
                          ) : null}
                          <div className="treeMenuDivider" role="separator" />
                          <button
                            type="button"
                            className="treeMenuItem treeMenuItemDanger"
                            role="menuitem"
                            onClick={() => {
                              setOpenMenuCollectionId(null)
                              props.onDeleteCollection(col.id)
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <button
                      className="envBtn"
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        props.onOpenEnv(col.id)
                      }}
                      title="Окружение"
                    >
                      env
                    </button>
                    <button
                      className="deleteBtn"
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        props.onDeleteCollection(col.id)
                      }}
                      title="Удалить коллекцию"
                      aria-label="Delete collection"
                    >
                      ✕
                    </button>
                  </div>
                </summary>
              </>
            )
          })()}

          <div className="treeItems">
            {(col.requests ?? []).map(r => {
              const active = props.activeRequestId === r.id
              const isEditingRequest = editing?.kind === 'request' && editing.id === r.id
              const isRequestMenuOpen = openMenuRequestId === r.id && !isEditingRequest

              function startRenameRequest() {
                suppressNextBlurRef.current = false
                setOpenMenuRequestId(null)
                setEditing({ kind: 'request', id: r.id })
                setDraftName(r.name)
              }

              function cancelRenameRequest() {
                setEditing(null)
                setDraftName('')
              }

              function submitRenameRequest() {
                const next = (nameEditableRef.current?.innerText ?? draftName).trim()
                cancelRenameRequest()
                if (!next || next === r.name) return
                props.onRenameRequest(col.id, r.id, next)
              }

                return (
                  <div
                    key={r.id}
                    className={`treeItem ${active ? 'treeItemActive' : ''}`}
                    draggable={!isEditingRequest}
                    onClick={() => {
                    if (isEditingRequest) return
                    props.onPickRequest(r, col)
                  }}
                  onDragStart={e => {
                    if (isEditingRequest) return
                    onRequestDragStart(e, col.id, r.id)
                  }}
                  onDragEnd={() => {
                    if (isEditingRequest) return
                    onRequestDragEnd()
                    }}
                  >
                    <span className={`mono small treeMethod ${inFlightMethodClass(r.id, r.method)}`}>{displayMethod(r.method)}</span>
                    {isEditingRequest ? (
                      <span className="treeItemNameWrap">
                        <span
                          ref={nameEditableRef as any}
                          className="treeItemName treeNameEditing"
                        contentEditable
                        suppressContentEditableWarning
                        onClick={e => e.stopPropagation()}
                        onPointerDown={e => e.stopPropagation()}
                        onKeyDown={e => {
                          e.stopPropagation()
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            suppressNextBlurRef.current = true
                            submitRenameRequest()
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            suppressNextBlurRef.current = true
                            cancelRenameRequest()
                          }
                        }}
                        onBlur={() => {
                          if (suppressNextBlurRef.current) {
                            suppressNextBlurRef.current = false
                            return
                          }
                          cancelRenameRequest()
                        }}
                        role="textbox"
                        aria-label="Request name"
                      >
                        {draftName}
                      </span>
                      <button
                        className="treeRenameIcon treeRenameIconConfirm"
                        onPointerDown={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          suppressNextBlurRef.current = true
                        }}
                        onClick={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          submitRenameRequest()
                        }}
                        aria-label="Save request name"
                        title="Save"
                      >
                        ’'o"
                      </button>
                    </span>
                  ) : (
                    <span className="treeItemNameWrap">
                      <span
                        className="treeItemName"
                        onDoubleClick={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          startRenameRequest()
                        }}
                        title="Double-click to rename"
                      >
                        {r.name}
                      </span>
                      <button
                        className="treeRenameIcon"
                        onPointerDown={e => {
                          e.preventDefault()
                          e.stopPropagation()
                        }}
                        onClick={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          startRenameRequest()
                        }}
                        aria-label="Rename request"
                        title="Rename"
                      >
                        ’'oZ
                      </button>
                    </span>
                  )}

                  <div ref={isRequestMenuOpen ? requestMenuWrapRef : null} className="treeMenuWrap">
                    <button
                      type="button"
                      className="iconBtn treeMenuBtn"
                      onPointerDown={e => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        setOpenMenuCollectionId(null)
                        setOpenMenuFolderId(null)
                        setOpenMenuRequestId(prev => (prev === r.id ? null : r.id))
                      }}
                      aria-label="Request menu"
                      title="Menu"
                    >
                      ...
                    </button>

                  {isRequestMenuOpen ? (
                    <div
                      className="treeMenuPanel"
                      role="menu"
                      ref={applyMenuAutoFlip}
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
                            setOpenMenuRequestId(null)
                            props.onDuplicateRequest(col.id, r.id)
                          }}
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          className="treeMenuItem"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenuRequestId(null)
                            startRenameRequest()
                          }}
                        >
                          Rename
                        </button>
                        <div className="treeMenuDivider" role="separator" />
                        <button
                          type="button"
                          className="treeMenuItem treeMenuItemDanger"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenuRequestId(null)
                            props.onDeleteRequest(col.id, r.id)
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>

          {col.folders.map(folder => renderFolder(col, folder))}
        </details>
      ))}
    </div>
  )
}
