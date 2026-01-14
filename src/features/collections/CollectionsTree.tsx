import type { Collection, RequestItem } from '../../shared/types/collection'
import { computeEffectiveBaseUrl } from '../../shared/utils/url'
import type { Environment } from '../../shared/types/environment'

export function CollectionsTree(props: {
  collections: Collection[]
  environmentsByCollection: Record<string, Environment>
  activeRequestId?: string
  onPickRequest: (req: RequestItem, col: Collection) => void
  onOpenEnv: (collectionId: string) => void
  onDeleteCollection: (collectionId: string) => void
}) {
  function displayMethod(m: string) {
    return m === 'DELETE' ? 'DEL' : m
  }

  return (
    <div className="tree">
      {props.collections.map(col => (
        <details key={col.id} className="treeGroup">
          {(() => {
            const envBaseUrl = props.environmentsByCollection[col.id]?.baseUrl
            const effective = computeEffectiveBaseUrl(envBaseUrl, col.baseUrl)
            const reqCount = col.folders.reduce((n, f) => n + f.requests.length, 0)
            return (
              <>
                <summary className="treeSummary">
                  <span className="treeChevron" aria-hidden="true" />
                  <div className="treeSummaryLeft">
                    <b className="treeCollectionName">{col.name}</b>
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

                <div className="small mono treeBaseUrl">
                  {effective || '{{baseUrl}}'}
                </div>
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
