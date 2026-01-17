import { useEffect, useMemo, useRef, useState } from 'react'
import type { Collection, Folder, RequestItem } from '../../shared/types/collection'
import type { Environment } from '../../shared/types/environment'

const TREE_OPEN_STATE_KEY = 'ruf_tree_open_state_v1'

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

export function CollectionsTree(props: {
  collections: Collection[]
  environmentsByCollection: Record<string, Environment>
  activeRequestId?: string
  onPickRequest: (req: RequestItem, col: Collection) => void
  onOpenEnv: (collectionId: string) => void
  onRenameCollection: (collectionId: string, name: string) => void
  onRenameFolder: (collectionId: string, folderId: string, name: string) => void
  onRenameRequest: (collectionId: string, requestId: string, name: string) => void
  onMoveFolder: (collectionId: string, folderId: string, targetParentFolderId: string | null) => void
  onDeleteCollection: (collectionId: string) => void
}) {
  type EditingTarget = { kind: 'collection' | 'folder' | 'request', id: string } | null

  const [editing, setEditing] = useState<EditingTarget>(null)
  const [draftName, setDraftName] = useState('')
  const nameEditableRef = useRef<HTMLElement | null>(null)
  const suppressNextBlurRef = useRef(false)
  const [openMenuCollectionId, setOpenMenuCollectionId] = useState<string | null>(null)
  const menuWrapRef = useRef<HTMLDivElement | null>(null)
  const [openCollections, setOpenCollections] = useState<Set<string>>(() => new Set(loadTreeOpenState().collections))
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set(loadTreeOpenState().folders))
  const [, setDraggingFolder] = useState<{ collectionId: string, folderId: string } | null>(null)

  function countRequests(folder: Folder): number {
    const nested = (folder.folders ?? []).reduce((n, f) => n + countRequests(f), 0)
    return folder.requests.length + nested
  }

  const requestCountByCollection = useMemo(() => {
    const out: Record<string, number> = {}
    for (const col of props.collections) {
      out[col.id] = col.folders.reduce((n, f) => n + countRequests(f), 0)
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
      const wrap = menuWrapRef.current
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

  function displayMethod(m: string) {
    return m === 'DELETE' ? 'DEL' : m
  }

  function onFolderDragStart(e: React.DragEvent, collectionId: string, folderId: string) {
    setDraggingFolder({ collectionId, folderId })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-ruf-folder', JSON.stringify({ collectionId, folderId }))
    e.dataTransfer.setData('text/plain', folderId)
  }

  function onFolderDragEnd() {
    setDraggingFolder(null)
  }

  function tryReadDraggedFolder(e: React.DragEvent): { collectionId: string, folderId: string } | null {
    try {
      const raw = e.dataTransfer.getData('application/x-ruf-folder')
      if (!raw) return null
      const parsed = JSON.parse(raw) as any
      const collectionId = typeof parsed?.collectionId === 'string' ? parsed.collectionId : ''
      const folderId = typeof parsed?.folderId === 'string' ? parsed.folderId : ''
      if (!collectionId || !folderId) return null
      return { collectionId, folderId }
    } catch {
      return null
    }
  }

  function renderFolder(col: Collection, folder: Folder) {
    const childFolders = folder.folders ?? []
    const reqCount = countRequests(folder)
    const isEditing = editing?.kind === 'folder' && editing.id === folder.id

    function startRename() {
      suppressNextBlurRef.current = false
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
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDrop={e => {
            e.preventDefault()
            e.stopPropagation()
            const dragged = tryReadDraggedFolder(e)
            if (!dragged) return
            if (dragged.collectionId !== col.id) return
            if (dragged.folderId === folder.id) return
            props.onMoveFolder(col.id, dragged.folderId, folder.id)
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
                  onDoubleClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    startRename()
                  }}
                  title="Double-click to rename"
                >
                  {folder.name}
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
                    startRename()
                  }}
                  aria-label="Rename folder"
                  title="Rename"
                >
                  ƒoZ
                </button>
              </span>
            )}
            <span className="small">{reqCount}</span>
          </div>
        </summary>

        {childFolders.map(f => renderFolder(col, f))}

        <div className="treeItems">
          {folder.requests.map(r => {
            const active = props.activeRequestId === r.id
            const isEditingRequest = editing?.kind === 'request' && editing.id === r.id

            function startRenameRequest() {
              suppressNextBlurRef.current = false
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
                onClick={() => {
                  if (isEditingRequest) return
                  props.onPickRequest(r, col)
                }}
              >
                <span className="mono small treeMethod">{displayMethod(r.method)}</span>
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
                  onDragOver={e => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    const dragged = tryReadDraggedFolder(e)
                    if (!dragged) return
                    if (dragged.collectionId !== col.id) return
                    props.onMoveFolder(col.id, dragged.folderId, null)
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
                    <span className="small">{reqCount}</span>
                  </div>
                  <div className="treeSummaryRight">
                    <div ref={isMenuOpen ? menuWrapRef : null} className="treeMenuWrap">
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
                          setOpenMenuCollectionId(prev => (prev === col.id ? null : col.id))
                        }}
                        aria-label="Collection menu"
                        title="Menu"
                      >
                        ⋯
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

          {col.folders.map(folder => renderFolder(col, folder))}
        </details>
      ))}
    </div>
  )
}
