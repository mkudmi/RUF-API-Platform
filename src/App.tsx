import { useEffect, useMemo, useRef, useState } from 'react'
import { ImportFab } from './features/importSpec/ImportFab'
import { CollectionsTree } from './features/collections/CollectionsTree'
import { RequestEditor } from './features/requestRunner/RequestEditor'
import { ResponseViewer } from './features/requestRunner/ResponseViewer'
import { EnvironmentSettings } from './features/environment/EnvironmentSettings'
import type { Collection, RequestItem } from './shared/types/collection'
import type { Environment } from './shared/types/environment'
import { DEFAULT_ENVIRONMENT } from './shared/types/environment'
import { loadCollections, loadEnvironmentsByCollection, saveCollections, saveEnvironmentsByCollection } from './shared/utils/storage'
import type { RunResult } from './features/requestRunner/runRequest'
import { uid } from './shared/utils/id'

function isAbsoluteUrl(url: string) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) || url.startsWith('//')
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

const ACTIVE_SELECTION_KEY = 'ruf_active_request_v1'
const RESPONSE_TAB_BY_REQUEST_KEY = 'ruf_response_tab_by_request_v1'

type SavedActiveSelection = { collectionId: string, requestId: string }

function safeParseJson<T>(raw: string | null): T | null {
  try {
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function loadActiveSelection(): SavedActiveSelection | null {
  const parsed = safeParseJson<any>(localStorage.getItem(ACTIVE_SELECTION_KEY))
  if (!parsed || typeof parsed !== 'object') return null
  const collectionId = typeof parsed.collectionId === 'string' ? parsed.collectionId : ''
  const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : ''
  if (!collectionId || !requestId) return null
  return { collectionId, requestId }
}

function saveActiveSelection(sel: SavedActiveSelection) {
  localStorage.setItem(ACTIVE_SELECTION_KEY, JSON.stringify(sel))
}

function clearActiveSelection() {
  localStorage.removeItem(ACTIVE_SELECTION_KEY)
}

function findRequestByIds(collections: Collection[], collectionId: string, requestId: string) {
  const col = collections.find(c => c.id === collectionId)
  if (!col) return null
  const collection = col
  function walk(folders: any[]): { col: Collection, req: RequestItem } | null {
    for (const folder of folders) {
      const req = (folder?.requests ?? []).find((r: RequestItem) => r.id === requestId)
      if (req) return { col: collection, req }
      const nested = Array.isArray(folder?.folders) ? folder.folders : []
      const found = walk(nested)
      if (found) return found
    }
    return null
  }
  const found = walk(col.folders as any)
  if (found) return found
  return null
}

export default function App() {
  const [collections, setCollections] = useState<Collection[]>(() => loadCollections())
  const [active, setActive] = useState<{ col: Collection, req: RequestItem } | null>(() => {
    const saved = loadActiveSelection()
    if (!saved) return null
    const cols = loadCollections()
    return findRequestByIds(cols, saved.collectionId, saved.requestId)
  })
  const [result, setResult] = useState<RunResult | null>(null)
  const [envByCollection, setEnvByCollection] = useState<Record<string, Environment>>(() => loadEnvironmentsByCollection())
  const [envModalCollectionId, setEnvModalCollectionId] = useState<string | null>(null)
  const createProjectDialogRef = useRef<HTMLDialogElement | null>(null)
  const [projectName, setProjectName] = useState('')
  const [projectError, setProjectError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmDeleteName, setConfirmDeleteName] = useState<string>('')
  const confirmDeleteDialogRef = useRef<HTMLDialogElement | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const raw = localStorage.getItem('ruf_sidebar_width_v1')
    const n = raw ? Number(raw) : 320
    return Number.isFinite(n) && n > 0 ? n : 320
  })
  const [editorWidth, setEditorWidth] = useState(() => {
    const raw = localStorage.getItem('ruf_editor_width_v1')
    const n = raw ? Number(raw) : 0
    return Number.isFinite(n) && n > 0 ? n : 0
  })
  const panelRef = useRef<HTMLDivElement | null>(null)
  const sidebarWidthRef = useRef(sidebarWidth)
  const editorWidthRef = useRef(editorWidth)
  const [responseTabByRequest, setResponseTabByRequest] = useState<Record<string, 'body' | 'headers'>>(() => {
    const parsed = safeParseJson<any>(localStorage.getItem(RESPONSE_TAB_BY_REQUEST_KEY))
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, 'body' | 'headers'> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && (v === 'body' || v === 'headers')) out[k] = v
    }
    return out
  })

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  useEffect(() => {
    editorWidthRef.current = editorWidth
  }, [editorWidth])

  const activeRequestId = useMemo(() => active?.req.id, [active])
  const activeResponseTab = useMemo(() => {
    if (!activeRequestId) return 'body' as const
    return responseTabByRequest[activeRequestId] ?? 'body'
  }, [activeRequestId, responseTabByRequest])
  const envModalCollection = useMemo(() => {
    if (!envModalCollectionId) return null
    return collections.find(c => c.id === envModalCollectionId) ?? null
  }, [collections, envModalCollectionId])

  useEffect(() => {
    if (!active) return
    const found = findRequestByIds(collections, active.col.id, active.req.id)
    if (!found) {
      setActive(null)
      setResult(null)
      clearActiveSelection()
      return
    }
    if (found.col !== active.col || found.req !== active.req) setActive(found)
  }, [active, collections])

  function addCollection(col: Collection) {
    const next = [col, ...collections]
    setCollections(next)
    saveCollections(next)

    setEnvByCollection(prev => {
      if (prev[col.id]) return prev
      const seededBaseUrl = col.baseUrl && isAbsoluteUrl(col.baseUrl) ? col.baseUrl.trim() : ''
      const nextEnvs = { ...prev, [col.id]: { ...DEFAULT_ENVIRONMENT, baseUrl: seededBaseUrl } }
      saveEnvironmentsByCollection(nextEnvs)
      return nextEnvs
    }
    )
  }

  function pick(req: RequestItem, col: Collection) {
    setActive({ req, col })
    setResult(null)
    saveActiveSelection({ collectionId: col.id, requestId: req.id })
  }

  function saveEnvForCollection(collectionId: string, next: Environment) {
    setEnvByCollection(prev => {
      const nextEnvs = { ...prev, [collectionId]: next }
      saveEnvironmentsByCollection(nextEnvs)
      return nextEnvs
    })
  }

  function requestDeleteCollection(collectionId: string) {
    const col = collections.find(c => c.id === collectionId)
    setConfirmDeleteId(collectionId)
    setConfirmDeleteName(col?.name || '')
    confirmDeleteDialogRef.current?.showModal()
  }

  function renameCollection(collectionId: string, name: string) {
    const nextName = name.trim()
    if (!nextName) return
    setCollections(prev => {
      const next = prev.map(c => c.id === collectionId ? { ...c, name: nextName } : c)
      saveCollections(next)
      return next
    })
  }

  function moveFolder(collectionId: string, folderId: string, targetParentFolderId: string | null) {
    setCollections(prev => {
      const next = prev.map(c => {
        if (c.id !== collectionId) return c

        function containsFolderId(folder: any, id: string): boolean {
          if (!folder) return false
          if (folder.id === id) return true
          const nested = Array.isArray(folder.folders) ? folder.folders : []
          return nested.some((f: any) => containsFolderId(f, id))
        }

        function removeFolder(folders: any[]): { folders: any[], removed: any | null } {
          let removed: any | null = null
          const nextFolders: any[] = []

          for (const f of folders) {
            if (!removed && f?.id === folderId) {
              removed = f
              continue
            }
            if (removed) {
              nextFolders.push(f)
              continue
            }
            const nested = Array.isArray(f?.folders) ? f.folders : []
            const child = removeFolder(nested)
            if (child.removed) {
              removed = child.removed
              nextFolders.push({ ...f, folders: child.folders })
              continue
            }
            nextFolders.push(f)
          }

          return { folders: nextFolders, removed }
        }

        function insertFolder(folders: any[], parentId: string, folder: any): { folders: any[], inserted: boolean } {
          let inserted = false
          const nextFolders = folders.map(f => {
            if (inserted) return f
            if (f?.id === parentId) {
              inserted = true
              const kids = Array.isArray(f?.folders) ? f.folders : []
              return { ...f, folders: [...kids, folder] }
            }
            const nested = Array.isArray(f?.folders) ? f.folders : []
            if (!nested.length) return f
            const child = insertFolder(nested, parentId, folder)
            if (!child.inserted) return f
            inserted = true
            return { ...f, folders: child.folders }
          })
          return { folders: nextFolders, inserted }
        }

        const removedRes = removeFolder(c.folders as any)
        const removed = removedRes.removed
        if (!removed) return c
        if (targetParentFolderId && containsFolderId(removed, targetParentFolderId)) return c

        let nextFolders: any[]
        if (!targetParentFolderId) {
          nextFolders = [...removedRes.folders, removed]
        } else {
          const inserted = insertFolder(removedRes.folders, targetParentFolderId, removed)
          nextFolders = inserted.inserted ? inserted.folders : [...removedRes.folders, removed]
        }
        return { ...c, folders: nextFolders }
      })
      saveCollections(next)
      return next
    })
  }

  function confirmDeleteCollection() {
    const collectionId = confirmDeleteId
    if (!collectionId) return

    setCollections(prev => {
      const next = prev.filter(c => c.id !== collectionId)
      saveCollections(next)
      return next
    })

    setEnvByCollection(prev => {
      if (!prev[collectionId]) return prev
      const { [collectionId]: _removed, ...rest } = prev
      saveEnvironmentsByCollection(rest)
      return rest
    })

    if (active?.col.id === collectionId) {
      setActive(null)
      setResult(null)
      clearActiveSelection()
    }
    if (envModalCollectionId === collectionId) setEnvModalCollectionId(null)
    setConfirmDeleteId(null)
    setConfirmDeleteName('')
    confirmDeleteDialogRef.current?.close()
  }

  function cancelDeleteCollection() {
    setConfirmDeleteId(null)
    setConfirmDeleteName('')
    confirmDeleteDialogRef.current?.close()
  }

  function openCreateProject() {
    setProjectError(null)
    setProjectName('')
    createProjectDialogRef.current?.showModal()
  }

  function closeCreateProject() {
    createProjectDialogRef.current?.close()
  }

  function createProject() {
    setProjectError(null)
    const name = projectName.trim()
    if (!name) {
      setProjectError('Введите имя проекта.')
      return
    }

    const col: Collection = {
      id: uid('col'),
      name,
      baseUrl: undefined,
      folders: [],
    }

    addCollection(col)
    closeCreateProject()
  }

  useEffect(() => {
    if (editorWidth) return
    const el = panelRef.current
    if (!el) return
    const w = el.getBoundingClientRect().width
    if (w > 0) setEditorWidth(Math.round(w / 2))
  }, [editorWidth])

  function onSidebarResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth
    ;(e.currentTarget as any).setPointerCapture?.(e.pointerId)

    function onMove(ev: PointerEvent) {
      const next = clamp(startW + (ev.clientX - startX), 240, 720)
      setSidebarWidth(next)
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      localStorage.setItem('ruf_sidebar_width_v1', String(sidebarWidthRef.current))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  function onPanelResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const startX = e.clientX
    const startW = editorWidth || Math.round(rect.width / 2)
    ;(e.currentTarget as any).setPointerCapture?.(e.pointerId)

    function onMove(ev: PointerEvent) {
      const min = 320
      const max = Math.max(min, rect.width - 320)
      const next = clamp(startW + (ev.clientX - startX), min, max)
      setEditorWidth(next)
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      localStorage.setItem('ruf_editor_width_v1', String(editorWidthRef.current))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  return (
    <div className="layout" style={{ gridTemplateColumns: `${sidebarWidth}px 8px 1fr` }}>
      <ImportFab onImported={addCollection} />
      <aside className="sidebar">
        <div className="sidebarBrand">
          <div className="sidebarBrandRow">
            <span className="appTitle">Ruf</span> <span className="small">(web-only)</span>
          </div>
          <div className="small sidebarTagline">API platform</div>
        </div>
        <div style={{marginBottom: 12}}>
          <div style={{display:'grid', gap:10}}>
            <button onClick={openCreateProject}>Создать проект</button>
          </div>
        </div>

        <CollectionsTree
          collections={collections}
          environmentsByCollection={envByCollection}
          activeRequestId={activeRequestId}
          onPickRequest={pick}
          onOpenEnv={setEnvModalCollectionId}
          onRenameCollection={renameCollection}
          onMoveFolder={moveFolder}
          onDeleteCollection={requestDeleteCollection}
        />
      </aside>
      <div className="resizer" onPointerDown={onSidebarResizePointerDown} />

      <main className="main">
        <div className="topbar">
          <b><span className="appTitle">Ruf</span> <span className="small">(web-only)</span></b>
          <span className="small">OpenAPI v2/v3 import + коллекции</span>
          <span className="small" style={{marginLeft:'auto'}}>
            Для запросов нужен CORS на стороне API
          </span>
        </div>

        <div ref={panelRef} className="panel" style={{
          gridTemplateColumns: editorWidth ? `${editorWidth}px 8px 1fr` : '1fr 8px 1fr',
        }}>
          <section className="card">
            {active
              ? <RequestEditor environment={envByCollection[active.col.id] ?? DEFAULT_ENVIRONMENT} collection={active.col} request={active.req} onResult={setResult} />
              : <div className="small">Импортируй OpenAPI или выбери запрос слева.</div>
            }
          </section>

          <div className="resizer" onPointerDown={onPanelResizePointerDown} />

          <section className="card">
            <ResponseViewer
              result={result}
              tab={activeResponseTab}
              onTabChange={tab => {
                const requestId = activeRequestId
                if (!requestId) return
                setResponseTabByRequest(prev => {
                  const next = { ...prev, [requestId]: tab }
                  localStorage.setItem(RESPONSE_TAB_BY_REQUEST_KEY, JSON.stringify(next))
                  return next
                })
              }}
            />
          </section>
        </div>
      </main>

      {envModalCollection && (
        <EnvironmentSettings
          open={!!envModalCollectionId}
          collectionName={envModalCollection.name}
          env={envByCollection[envModalCollection.id] ?? DEFAULT_ENVIRONMENT}
          onSave={env => saveEnvForCollection(envModalCollection.id, env)}
          onClose={() => setEnvModalCollectionId(null)}
        />
      )}

      <dialog
        ref={createProjectDialogRef}
        className="modal"
        onClose={() => {
          setProjectError(null)
          setProjectName('')
        }}
      >
        <div className="modalHeader">
          <b>Создать проект</b>
          <button onClick={closeCreateProject}>Закрыть</button>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'200px 1fr', gap:10, alignItems:'center'}}>
          <div className="small">Имя</div>
          <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="My API" />
        </div>

        {projectError && <div className="small" style={{color:'#ff9a9a', marginTop: 8}}>{projectError}</div>}

        <div className="modalActions">
          <button onClick={createProject}>Создать</button>
        </div>
      </dialog>

      <dialog ref={confirmDeleteDialogRef} className="modal modalSmall" onClose={cancelDeleteCollection}>
        <div className="modalHeader">
          <b>Удалить коллекцию?</b>
        </div>

        <div className="small">
          {confirmDeleteName ? `Коллекция: ${confirmDeleteName}` : 'Эта коллекция будет удалена.'}
        </div>

        <div className="modalActions">
          <button onClick={cancelDeleteCollection}>Отмена</button>
          <button className="deleteBtn" onClick={confirmDeleteCollection}>Удалить</button>
        </div>
      </dialog>
    </div>
  )
}
