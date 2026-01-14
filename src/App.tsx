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

export default function App() {
  const [collections, setCollections] = useState<Collection[]>(() => loadCollections())
  const [active, setActive] = useState<{ col: Collection, req: RequestItem } | null>(null)
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

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  useEffect(() => {
    editorWidthRef.current = editorWidth
  }, [editorWidth])

  const activeRequestId = useMemo(() => active?.req.id, [active])
  const envModalCollection = useMemo(() => {
    if (!envModalCollectionId) return null
    return collections.find(c => c.id === envModalCollectionId) ?? null
  }, [collections, envModalCollectionId])

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
            <ResponseViewer result={result} />
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
