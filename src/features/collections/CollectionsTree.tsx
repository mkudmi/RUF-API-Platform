import { useEffect, useRef, useState } from 'react'
import type { Collection, RequestItem } from '../../shared/types/collection'
import type { Environment } from '../../shared/types/environment'

export function CollectionsTree(props: {
  collections: Collection[]
  environmentsByCollection: Record<string, Environment>
  activeRequestId?: string
  onPickRequest: (req: RequestItem, col: Collection) => void
  onOpenEnv: (collectionId: string) => void
  onRenameCollection: (collectionId: string, name: string) => void
  onDeleteCollection: (collectionId: string) => void
}) {
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const nameEditableRef = useRef<HTMLElement | null>(null)
  const suppressNextBlurRef = useRef(false)

  useEffect(() => {
    if (!editingCollectionId) return
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
  }, [editingCollectionId])

  function displayMethod(m: string) {
    return m === 'DELETE' ? 'DEL' : m
  }

  return (
    <div className="tree">
      {props.collections.map(col => (
        <details key={col.id} className="treeGroup">
          {(() => {
            const reqCount = col.folders.reduce((n, f) => n + f.requests.length, 0)
            const isEditing = editingCollectionId === col.id

            function startRename() {
              suppressNextBlurRef.current = false
              setEditingCollectionId(col.id)
              setDraftName(col.name)
            }

            function cancelRename() {
              setEditingCollectionId(null)
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

          {col.folders.map(folder => (
            <details key={folder.id} className="treeGroup treeGroupInner">
              <summary className="treeSummary treeSummaryFolder">
                <span className="treeChevron" aria-hidden="true" />
                <div className="treeSummaryLeft">
                  <span className="treeFolderName">{folder.name}</span>
                  <span className="small">{folder.requests.length}</span>
                </div>
              </summary>

              <div className="treeItems">
                {folder.requests.map(r => {
                  const active = props.activeRequestId === r.id
                  return (
                    <div
                      key={r.id}
                      className={`treeItem ${active ? 'treeItemActive' : ''}`}
                      onClick={() => props.onPickRequest(r, col)}
                    >
                      <span className="mono small treeMethod">{displayMethod(r.method)}</span>
                      <span className="treeItemName">{r.name}</span>
                    </div>
                  )
                })}
              </div>
            </details>
          ))}
        </details>
      ))}
    </div>
  )
}
