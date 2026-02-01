import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { SidebarCreateMenu } from '../shared/components/SidebarCreateMenu'
import { WorkspaceTree, syncCollectionKeepingIds, summarizeCollectionDiff, type Collection, type HttpMethod, type RequestItem } from '../modules/collectionTree'
import { RequestEditor } from '../modules/requestEditor'
import { ResponseViewer } from '../modules/responseViewer'
import { ImportFab, buildImportedCollectionFromText } from '../modules/import'
import { EnvironmentSettings } from '../modules/environment'
import type { Environment } from '../shared/types/environment'
import { DEFAULT_ENVIRONMENT } from '../shared/types/environment'
import { loadCollections, loadEnvironmentsByCollection, saveCollections, saveEnvironmentsByCollection } from '../shared/utils/storage'
import type { Workspace, WorkspaceFolder } from '../shared/types/workspace'
import { loadWorkspace, saveWorkspace } from '../shared/utils/workspaceStorage'
import type { RunResult } from '../modules/requestRunner/runRequest'
import { uid } from '../shared/utils/id'
import type { RequestDraft, RequestHistoryItem } from '../shared/types/requestHistory'
import { appendRequestHistoryItem, loadRequestHistoryByRequestId, saveRequestHistoryByRequestId } from '../shared/utils/requestHistory'
import { loadAppSettings, saveAppSettings } from '../shared/utils/appSettings'
import { fetchWithProxyFallback } from '../shared/utils/proxyFetch'
import { isAbsoluteUrl } from '../shared/utils/url'
import { isTauri } from '../shared/utils/tauri'
import { useAppUpdater } from './useAppUpdater'

//TODO:
// Из body убрать красное подчеркивание
// Двойное нажатие на нижнюю границу редактора body чтобы развернуть по границу текста в поле ввода, вся нижняя граница с возможностью ресайза
// Кнопка reload хэдеры\параметры из изначального импорта, восстанавливать недостающие
// При релоаде из урла\файла восстанавливать еще и хэдеры\параметры если они отсутствуют
// удалил параметр\хэдер возврат через ctrl+z
// импортированные хэдеры сделать key редактируемые удаляемые (перелопатить все связанныое с импортом хэдеров и параметров, по умолчанию последняя строка всегда есть, везде крестики, активный неактивный, просто вставлять хэдеры в поля, добавляя в конце пустую строку для нового хэдера)
// сертификаты в настройках
// запись в историю поиска по ответу делается после каждого изменения?? нажатия мышки??
// пофиксить ошибку подключения к бд в варме
// отправлять серию запросов с вводом числа итераций??
// редактор отпраляемых файлов??
// переработать историю запросов
// активный неактивный sql скрипт
// активный неактивный файл
// добавить переменные из окружения в выбор через скобки
// Экспорт в openapi?? и\или postman
// Кнопка Send превращается в красную Cancel которая останавливает запрос если он в процессе
// По центру responseViewer счетчик времени запроса от отправки до получения ответа

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
  const direct = (collection.requests ?? []).find(r => r.id === requestId)
  if (direct) return { col: collection, req: direct }
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
  const settingsDialogRef = useRef<HTMLDialogElement | null>(null)
  const importOpenRef = useRef<(() => void) | null>(null)
  const reloadFromFileDialogRef = useRef<HTMLDialogElement | null>(null)
  const reloadFromFileInputRef = useRef<HTMLInputElement | null>(null)
  const [validateCertificates, setValidateCertificates] = useState<boolean>(() => loadAppSettings().validateCertificates)
  const [reloadFromFileCollectionId, setReloadFromFileCollectionId] = useState<string | null>(null)
  const [reloadFromFileError, setReloadFromFileError] = useState<string | null>(null)
  const [reloadFromFilePending, setReloadFromFilePending] = useState<Collection | null>(null)
  const [reloadFromFileSummary, setReloadFromFileSummary] = useState<ReturnType<typeof summarizeCollectionDiff> | null>(null)
  const [reloadFromFileSelectedName, setReloadFromFileSelectedName] = useState('')

  const [collections, setCollections] = useState<Collection[]>(() => loadCollections())
  const [workspace, setWorkspace] = useState<Workspace>(() => loadWorkspace())
  const [active, setActive] = useState<{ col: Collection, req: RequestItem } | null>(() => {
    const saved = loadActiveSelection()
    if (!saved) return null
    const cols = loadCollections()
    return findRequestByIds(cols, saved.collectionId, saved.requestId)
  })
  const [resultByRequestId, setResultByRequestId] = useState<Record<string, RunResult | null>>({})
  const [inFlightCountByRequestId, setInFlightCountByRequestId] = useState<Record<string, number>>({})
  const [envByCollection, setEnvByCollection] = useState<Record<string, Environment>>(() => loadEnvironmentsByCollection())
  const [envModalCollectionId, setEnvModalCollectionId] = useState<string | null>(null)
  const createProjectDialogRef = useRef<HTMLDialogElement | null>(null)
  const [projectName, setProjectName] = useState('')
  const [projectError, setProjectError] = useState<string | null>(null)
  const createWorkspaceFolderDialogRef = useRef<HTMLDialogElement | null>(null)
  const [workspaceFolderName, setWorkspaceFolderName] = useState('New Folder')
  const [workspaceFolderError, setWorkspaceFolderError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmDeleteName, setConfirmDeleteName] = useState<string>('')
  const confirmDeleteDialogRef = useRef<HTMLDialogElement | null>(null)
  const SIDEBAR_BASE_PCT = 0.22
  const SIDEBAR_MIN_PX = 190
  const SIDEBAR_MAX_PX = 720
  const PANEL_EDITOR_BASE_PCT = 0.6
  const PANEL_EDITOR_NARROW_PCT = 0.7
  const RESIZER_GUTTER_PX = 8
  const LAYOUT_MAIN_MIN_PX = 520

  function getViewportWidthPx() {
    return document.documentElement?.clientWidth || window.innerWidth || 0
  }

  function getDefaultSidebarWidthPx() {
    const w = getViewportWidthPx()
    const base = w > 0 ? Math.round(w * SIDEBAR_BASE_PCT) : 420
    const maxByViewport = Math.min(
      SIDEBAR_MAX_PX,
      Math.max(SIDEBAR_MIN_PX, w - RESIZER_GUTTER_PX - LAYOUT_MAIN_MIN_PX),
    )
    return clamp(base, SIDEBAR_MIN_PX, maxByViewport)
  }

  function getPanelPaneConstraints(panelWidthPx: number) {
    const usable = Math.max(0, panelWidthPx - RESIZER_GUTTER_PX)
    if (usable <= 0) return { min: 0, max: 0, usable: 0 }
    const minTarget = Math.min(320, Math.max(80, Math.floor(usable / 3)))
    const min = Math.min(minTarget, Math.floor(usable / 2))
    const max = usable - min
    return { min, max, usable }
  }

  function getDefaultEditorWidthPx(panelWidthPx: number) {
    const { min, max, usable } = getPanelPaneConstraints(panelWidthPx)
    const desiredPct = getViewportWidthPx() < 900 ? PANEL_EDITOR_NARROW_PCT : PANEL_EDITOR_BASE_PCT
    const base = Math.round(usable * desiredPct)
    return clamp(base, min, max)
  }
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const raw = localStorage.getItem('ruf_sidebar_width_v1')
    const n = raw ? Number(raw) : getDefaultSidebarWidthPx()
    const base = Number.isFinite(n) && n > 0 ? n : getDefaultSidebarWidthPx()
    return clamp(base, SIDEBAR_MIN_PX, SIDEBAR_MAX_PX)
  })
  const [editorWidth, setEditorWidth] = useState(() => {
    const raw = localStorage.getItem('ruf_editor_width_v1')
    const n = raw ? Number(raw) : 0
    return Number.isFinite(n) && n > 0 ? n : 0
  })
  const panelRef = useRef<HTMLDivElement | null>(null)
  const sidebarWidthRef = useRef(sidebarWidth)
  const editorWidthRef = useRef(editorWidth)
  const viewportWidthRef = useRef(0)
  const [responseTabByRequest, setResponseTabByRequest] = useState<Record<string, 'body' | 'headers' | 'history'>>(() => {
    const parsed = safeParseJson<any>(localStorage.getItem(RESPONSE_TAB_BY_REQUEST_KEY))
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, 'body' | 'headers' | 'history'> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && (v === 'body' || v === 'headers' || v === 'history')) out[k] = v
    }
    return out
  })
  const [historyByRequestId, setHistoryByRequestId] = useState<Record<string, RequestHistoryItem[]>>(() => loadRequestHistoryByRequestId())
  const [applyDraftState, setApplyDraftState] = useState<{ requestId: string, token: string, draft: RequestDraft } | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const {
    updateBusy,
    updateTask,
    updateHint,
    hasPendingUpdate,
    updateDownloaded,
    updateDownloadPct,
    showUpdateToast,
    onCheckUpdates,
    onUpdateNow,
    onRestartToUpdate,
    onUpdateLater,
  } = useAppUpdater()

  function openSettings() {
    settingsDialogRef.current?.showModal()
  }

  function closeSettings() {
    settingsDialogRef.current?.close()
  }

  useEffect(() => {
    saveAppSettings({ validateCertificates })
  }, [validateCertificates])

  useEffect(() => {
    if (!isTauri()) return
    void (async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app')
        setAppVersion(await getVersion())
      } catch {
        setAppVersion(null)
      }
    })()
  }, [])

  function onRequestSendStart(requestId: string) {
    setInFlightCountByRequestId(prev => ({ ...prev, [requestId]: (prev[requestId] ?? 0) + 1 }))
  }

  function onRequestSendEnd(requestId: string) {
    setInFlightCountByRequestId(prev => {
      const next = { ...prev }
      const n = (next[requestId] ?? 0) - 1
      if (n <= 0) delete next[requestId]
      else next[requestId] = n
      return next
    })
  }

  function onRequestResult(requestId: string, result: RunResult) {
    setResultByRequestId(prev => ({ ...prev, [requestId]: result }))
  }

  function onRequestBeforeSend(requestId: string, item: RequestHistoryItem) {
    setHistoryByRequestId(prev => {
      const next = appendRequestHistoryItem({ historyByRequestId: prev, requestId, item })
      saveRequestHistoryByRequestId(next)
      return next
    })
  }

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  useEffect(() => {
    editorWidthRef.current = editorWidth
  }, [editorWidth])

  useEffect(() => {
    function onResize() {
      const viewportWidthPx = getViewportWidthPx()
      const prevViewportWidthPx = viewportWidthRef.current || viewportWidthPx
      const isShrinking = viewportWidthPx < prevViewportWidthPx
      const sidebarMaxByViewport = Math.min(
        SIDEBAR_MAX_PX,
        Math.max(SIDEBAR_MIN_PX, viewportWidthPx - RESIZER_GUTTER_PX - LAYOUT_MAIN_MIN_PX),
      )
      const nextSidebar = clamp(sidebarWidthRef.current, SIDEBAR_MIN_PX, sidebarMaxByViewport)
      if (nextSidebar !== sidebarWidthRef.current) setSidebarWidth(nextSidebar)
      viewportWidthRef.current = viewportWidthPx

      const el = panelRef.current
      if (!el) return
      if (!editorWidthRef.current) return
      const panelWidthPx = el.getBoundingClientRect().width
      const { min, max, usable } = getPanelPaneConstraints(panelWidthPx)
      const desiredPct = viewportWidthPx < 900 ? PANEL_EDITOR_NARROW_PCT : PANEL_EDITOR_BASE_PCT
      const desiredEditor = Math.round(usable * desiredPct)
      const baseEditor = isShrinking ? Math.max(editorWidthRef.current, desiredEditor) : editorWidthRef.current
      const nextEditor = clamp(baseEditor, min, max)
      if (nextEditor !== editorWidthRef.current) setEditorWidth(nextEditor)
    }

    const onResizeRaf = () => requestAnimationFrame(onResize)
    window.addEventListener('resize', onResizeRaf)
    onResize()
    return () => window.removeEventListener('resize', onResizeRaf)
  }, [])

  const activeRequestId = useMemo(() => active?.req.id, [active])
  const activeResponseTab = useMemo(() => {
    if (!activeRequestId) return 'body' as const
    return responseTabByRequest[activeRequestId] ?? 'body'
  }, [activeRequestId, responseTabByRequest])
  const activeHistory = useMemo(() => {
    if (!activeRequestId) return []
    return historyByRequestId[activeRequestId] ?? []
  }, [activeRequestId, historyByRequestId])
  const envModalCollection = useMemo(() => {
    if (!envModalCollectionId) return null
    return collections.find(c => c.id === envModalCollectionId) ?? null
  }, [collections, envModalCollectionId])
  const reloadFromFileCollection = useMemo(() => {
    if (!reloadFromFileCollectionId) return null
    return collections.find(c => c.id === reloadFromFileCollectionId) ?? null
  }, [collections, reloadFromFileCollectionId])

  useEffect(() => {
    if (!active) return
    const found = findRequestByIds(collections, active.col.id, active.req.id)
    if (!found) {
      setActive(null)
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
      const seededVariables = {
        ...DEFAULT_ENVIRONMENT.variables,
        ...(col.variables ?? {}),
        [DEFAULT_ENVIRONMENT.baseUrlKey]: seededBaseUrl || (col.variables?.[DEFAULT_ENVIRONMENT.baseUrlKey] ?? ''),
      }
      const nextEnvs = { ...prev, [col.id]: { ...DEFAULT_ENVIRONMENT, variables: seededVariables } }
      saveEnvironmentsByCollection(nextEnvs)
      return nextEnvs
    }
    )
  }

  async function updateCollectionFromUrl(collectionId: string) {
    const existingNow = collections.find(c => c.id === collectionId)
    const rawUrl = existingNow?.sourceUrl?.trim() || ''
    if (!existingNow || !rawUrl) return

    try {
      const u = new URL(rawUrl)
      const res = await fetchWithProxyFallback(u.toString(), undefined, { insecureTls: !validateCertificates })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const text = await res.text()
      if (!text.trim()) throw new Error('Response is empty.')

      const incoming = await buildImportedCollectionFromText({ text, name: existingNow.name, sourceOrigin: u.origin })
      const normalizedUrl = u.toString()

      setCollections(prev => {
        const existing = prev.find(c => c.id === collectionId)
        if (!existing) return prev
        const merged = syncCollectionKeepingIds({
          existing,
          incoming: { ...incoming, sourceUrl: normalizedUrl, sourceType: 'url' },
        })
        const next = prev.map(c => (c.id === collectionId ? merged : c))
        saveCollections(next)
        return next
      })
    } catch (e: any) {
      alert(e?.message || 'Failed to update from URL.')
    }
  }

  function openReloadFromFile(collectionId: string) {
    setReloadFromFileCollectionId(collectionId)
    setReloadFromFileError(null)
    setReloadFromFilePending(null)
    setReloadFromFileSummary(null)
    setReloadFromFileSelectedName('')
    reloadFromFileDialogRef.current?.showModal()
  }

  function closeReloadFromFile() {
    reloadFromFileDialogRef.current?.close()
    setReloadFromFileCollectionId(null)
    setReloadFromFileError(null)
    setReloadFromFilePending(null)
    setReloadFromFileSummary(null)
    setReloadFromFileSelectedName('')
  }

  function chooseReloadFromFile() {
    setReloadFromFileError(null)
    reloadFromFileInputRef.current?.click()
  }

  async function onReloadFromFileSelected(e: ChangeEvent<HTMLInputElement>) {
    setReloadFromFileError(null)
    const file = e.target.files?.[0]
    if (!file) return

    const collectionId = reloadFromFileCollectionId
    if (!collectionId) return

    const existingNow = collections.find(c => c.id === collectionId)
    if (!existingNow) return

    try {
      const text = await file.text()
      const imported = await buildImportedCollectionFromText({ text, name: existingNow.name })
      const incoming = { ...imported, sourceType: 'file' as const, sourceFileName: file.name }
      setReloadFromFilePending(incoming)
      setReloadFromFileSummary(summarizeCollectionDiff(existingNow, incoming))
      setReloadFromFileSelectedName(file.name)
    } catch (err: any) {
      setReloadFromFilePending(null)
      setReloadFromFileSummary(null)
      setReloadFromFileSelectedName('')
      setReloadFromFileError(err?.message || 'Failed to import file.')
    } finally {
      e.target.value = ''
    }
  }

  function applyReloadFromFile() {
    const collectionId = reloadFromFileCollectionId
    const incoming = reloadFromFilePending
    if (!collectionId || !incoming) return

    setCollections(prev => {
      const existing = prev.find(c => c.id === collectionId)
      if (!existing) return prev
      const merged = syncCollectionKeepingIds({ existing, incoming })
      const next = prev.map(c => (c.id === collectionId ? merged : c))
      saveCollections(next)
      return next
    })

    closeReloadFromFile()
  }

  function pick(req: RequestItem, col: Collection) {
    setActive({ req, col })
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

  function renameFolder(collectionId: string, folderId: string, name: string) {
    const nextName = name.trim()
    if (!nextName) return

    setCollections(prev => {
      function renameInFolders(folders: any[]): { folders: any[], changed: boolean } {
        let changed = false
        const nextFolders = folders.map(f => {
          if (!f) return f
          if (f.id === folderId) {
            changed = true
            return { ...f, name: nextName }
          }
          const hasNested = Array.isArray(f.folders)
          if (!hasNested || f.folders.length === 0) return f
          const child = renameInFolders(f.folders)
          if (!child.changed) return f
          changed = true
          return { ...f, folders: child.folders }
        })
        return { folders: nextFolders, changed }
      }

      let didChange = false
      const next = prev.map(c => {
        if (c.id !== collectionId) return c
        const res = renameInFolders(c.folders as any)
        if (!res.changed) return c
        didChange = true
        return { ...c, folders: res.folders }
      })
      if (!didChange) return prev
      saveCollections(next)
      return next
    })
  }

  function renameRequest(collectionId: string, requestId: string, name: string) {
    const nextName = name.trim()
    if (!nextName) return

    setCollections(prev => {
      let didChange = false

      function renameInFolders(folders: any[]): { folders: any[], changed: boolean } {
        let changed = false
        const nextFolders = folders.map(f => {
          if (!f) return f
          let folderChanged = false

          const requests = Array.isArray(f.requests) ? f.requests : []
          const nextRequests = requests.map((r: any) => {
            if (r?.id !== requestId) return r
            folderChanged = true
            return { ...r, name: nextName }
          })

          const hasNested = Array.isArray(f.folders)
          const nested = hasNested ? f.folders : []
          const child = hasNested && nested.length ? renameInFolders(nested) : { folders: nested, changed: false }
          if (child.changed) folderChanged = true

          if (!folderChanged) return f
          changed = true
          return { ...f, requests: nextRequests, ...(hasNested ? { folders: child.folders } : {}) }
        })
        return { folders: nextFolders, changed }
      }

      const next = prev.map(c => {
        if (c.id !== collectionId) return c

        const nextRequests = (c.requests ?? []).map(r => (r.id === requestId ? { ...r, name: nextName } : r))
        const changedDirect = (c.requests ?? []).some(r => r.id === requestId && r.name !== nextName)
        const res = renameInFolders(c.folders as any)
        if (!changedDirect && !res.changed) return c
        didChange = true
        return { ...c, requests: nextRequests, folders: res.folders }
      })
      if (!didChange) return prev
      saveCollections(next)
      return next
    })
  }

  function setRequestMethod(collectionId: string, requestId: string, method: HttpMethod) {
    const nextMethod = method
    setCollections(prev => {
      let didChange = false

      function setInFolders(folders: any[]): { folders: any[], changed: boolean } {
        let changed = false
        const nextFolders = folders.map(f => {
          if (!f) return f
          let folderChanged = false

          const requests = Array.isArray(f.requests) ? f.requests : []
          const nextRequests = requests.map((r: any) => {
            if (r?.id !== requestId) return r
            if (r?.method === nextMethod) return r
            folderChanged = true
            return { ...r, method: nextMethod }
          })

          const hasNested = Array.isArray(f.folders)
          const nested = hasNested ? f.folders : []
          const child = hasNested && nested.length ? setInFolders(nested) : { folders: nested, changed: false }
          if (child.changed) folderChanged = true

          if (!folderChanged) return f
          changed = true
          return { ...f, requests: nextRequests, ...(hasNested ? { folders: child.folders } : {}) }
        })
        return { folders: nextFolders, changed }
      }

      const next = prev.map(c => {
        if (c.id !== collectionId) return c

        const nextRequests = (c.requests ?? []).map(r => (r.id === requestId ? { ...r, method: nextMethod } : r))
        const changedDirect = (c.requests ?? []).some(r => r.id === requestId && r.method !== nextMethod)
        const res = setInFolders(c.folders as any)
        if (!changedDirect && !res.changed) return c
        didChange = true
        return { ...c, requests: nextRequests, folders: res.folders }
      })
      if (!didChange) return prev
      saveCollections(next)
      return next
    })
  }

  function addRequestToCollection(collectionId: string) {
    const req: RequestItem = {
      id: uid('req'),
      name: 'New Request',
      method: 'GET',
      path: '/',
      urlTemplate: '{{baseUrl}}/',
      params: [],
      headers: {},
    }

    setCollections(prev => {
      let createdInCol: Collection | null = null
      const next: Collection[] = []

      for (const c of prev) {
        if (c.id !== collectionId) {
          next.push(c)
          continue
        }
        createdInCol = { ...c, requests: [...(c.requests ?? []), req] }
        next.push(createdInCol)
      }

      saveCollections(next)

      if (createdInCol) {
        setActive({ col: createdInCol, req })
        saveActiveSelection({ collectionId: createdInCol.id, requestId: req.id })
      }

      return next
    })
  }

  function addFolderToCollection(collectionId: string) {
    const folder = { id: uid('folder'), name: 'New Folder', requests: [], folders: [] }
    setCollections(prev => {
      const next = prev.map(c => (c.id === collectionId ? { ...c, folders: [folder, ...c.folders] } : c))
      saveCollections(next)
      return next
    })
  }

  function addRequestToFolder(collectionId: string, folderId: string) {
    const req: RequestItem = {
      id: uid('req'),
      name: 'New Request',
      method: 'GET',
      path: '/',
      urlTemplate: '{{baseUrl}}/',
      params: [],
      headers: {},
    }

    setCollections(prev => {
      function addToFolders(folders: any[]): { folders: any[], changed: boolean } {
        let changed = false
        const nextFolders = folders.map(f => {
          if (!f) return f
          if (f.id === folderId) {
            changed = true
            const requests = Array.isArray(f.requests) ? f.requests : []
            return { ...f, requests: [...requests, req] }
          }
          const nested = Array.isArray(f.folders) ? f.folders : []
          if (!nested.length) return f
          const child = addToFolders(nested)
          if (!child.changed) return f
          changed = true
          return { ...f, folders: child.folders }
        })
        return { folders: nextFolders, changed }
      }

      let createdInCol: Collection | null = null
      let didAdd = false
      const next: Collection[] = []

      for (const c of prev) {
        if (c.id !== collectionId) {
          next.push(c)
          continue
        }
        const res = addToFolders(c.folders as any)
        if (!res.changed) {
          next.push(c)
          continue
        }
        didAdd = true
        createdInCol = { ...c, folders: res.folders }
        next.push(createdInCol)
      }

      if (!didAdd || !createdInCol) return prev
      saveCollections(next)

      setActive({ col: createdInCol, req })
      saveActiveSelection({ collectionId: createdInCol.id, requestId: req.id })

      return next
    })
  }

  function addFolderToFolder(collectionId: string, parentFolderId: string) {
    const newFolder = { id: uid('folder'), name: 'New Folder', requests: [], folders: [] }

    setCollections(prev => {
      function addToFolders(folders: any[]): { folders: any[], changed: boolean } {
        let changed = false
        const nextFolders = folders.map(f => {
          if (!f) return f
          if (f.id === parentFolderId) {
            changed = true
            const nested = Array.isArray(f.folders) ? f.folders : []
            return { ...f, folders: [newFolder, ...nested] }
          }
          const nested = Array.isArray(f.folders) ? f.folders : []
          if (!nested.length) return f
          const child = addToFolders(nested)
          if (!child.changed) return f
          changed = true
          return { ...f, folders: child.folders }
        })
        return { folders: nextFolders, changed }
      }

      let didAdd = false
      const next = prev.map(c => {
        if (c.id !== collectionId) return c
        const res = addToFolders(c.folders as any)
        if (!res.changed) return c
        didAdd = true
        return { ...c, folders: res.folders }
      })

      if (!didAdd) return prev
      saveCollections(next)
      return next
    })
  }

  function deleteFolder(collectionId: string, folderId: string) {
    setCollections(prev => {
      const next = prev.map(c => {
        if (c.id !== collectionId) return c

        function removeFolder(folders: any[]): { folders: any[], removed: boolean } {
          let removed = false
          const nextFolders: any[] = []

          for (const f of folders) {
            if (f?.id === folderId) {
              removed = true
              continue
            }
            const nested = Array.isArray(f?.folders) ? f.folders : []
            if (nested.length) {
              const child = removeFolder(nested)
              if (child.removed) {
                removed = true
                nextFolders.push({ ...f, folders: child.folders })
                continue
              }
            }
            nextFolders.push(f)
          }

          return { folders: nextFolders, removed }
        }

        const res = removeFolder(c.folders as any)
        if (!res.removed) return c
        return { ...c, folders: res.folders }
      })
      saveCollections(next)
      return next
    })
  }

  function deleteRequest(collectionId: string, requestId: string) {
    setCollections(prev => {
      let didRemove = false

      function removeFromFolders(folders: any[]): any[] {
        return folders.map(f => {
          const reqs = Array.isArray(f?.requests) ? f.requests : []
          const nextReqs = reqs.filter((r: any) => r?.id !== requestId)
          if (nextReqs.length !== reqs.length) didRemove = true

          const nested = Array.isArray(f?.folders) ? f.folders : []
          const nextNested = nested.length ? removeFromFolders(nested) : nested
          if (nextNested !== nested) didRemove = true

          if (nextReqs === reqs && nextNested === nested) return f
          return { ...f, requests: nextReqs, folders: nextNested }
        })
      }

      const next = prev.map(c => {
        if (c.id !== collectionId) return c
        const direct = c.requests ?? []
        const nextDirect = direct.filter(r => r.id !== requestId)
        if (nextDirect.length !== direct.length) didRemove = true

        const nextFolders = removeFromFolders(c.folders as any)
        return { ...c, requests: nextDirect, folders: nextFolders }
      })

      if (!didRemove) return prev
      saveCollections(next)

      if (active?.req.id === requestId && active.col.id === collectionId) {
        setActive(null)
        clearActiveSelection()
      }

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

  function moveRequest(collectionId: string, requestId: string, targetFolderId: string | null) {
    setCollections(prev => {
      let didMove = false
      let movedReq: RequestItem | null = null
      let updatedCol: Collection | null = null

      function findInFolders(folders: any[]): { req: RequestItem, folderId: string } | null {
        for (const f of folders) {
          const reqs: RequestItem[] = Array.isArray(f?.requests) ? f.requests : []
          const found = reqs.find(r => r?.id === requestId)
          if (found) return { req: found, folderId: f.id }
          const nested = Array.isArray(f?.folders) ? f.folders : []
          const inner = nested.length ? findInFolders(nested) : null
          if (inner) return inner
        }
        return null
      }

      function removeFromFolders(folders: any[]): { folders: any[], removed: boolean } {
        let didRemove = false
        let nextFolders: any[] | null = null

        for (let i = 0; i < folders.length; i++) {
          const f = folders[i]
          if (!f) {
            if (nextFolders) nextFolders.push(f)
            continue
          }

          let nextFolder = f

          const reqs: RequestItem[] = Array.isArray(f.requests) ? f.requests : []
          const idx = reqs.findIndex(r => r?.id === requestId)
          if (idx >= 0) {
            didRemove = true
            const nextReqs = [...reqs.slice(0, idx), ...reqs.slice(idx + 1)]
            nextFolder = { ...nextFolder, requests: nextReqs }
          }

          const nested = Array.isArray(f.folders) ? f.folders : []
          const nestedRes = nested.length ? removeFromFolders(nested) : { folders: nested, removed: false }
          if (nestedRes.removed) {
            didRemove = true
            nextFolder = { ...nextFolder, folders: nestedRes.folders }
          }

          if (!nextFolders) {
            if (nextFolder !== f) {
              nextFolders = folders.slice(0, i)
              nextFolders.push(nextFolder)
            }
          } else {
            nextFolders.push(nextFolder)
          }
        }

        if (!didRemove) return { folders, removed: false }
        return { folders: nextFolders ?? folders, removed: true }
      }

      function insertIntoFolders(folders: any[], folderId: string, req: RequestItem): { folders: any[], inserted: boolean } {
        let inserted = false
        let nextFolders: any[] | null = null

        for (let i = 0; i < folders.length; i++) {
          const f = folders[i]
          if (!f) {
            if (nextFolders) nextFolders.push(f)
            continue
          }

          let nextFolder = f
          if (!inserted && f.id === folderId) {
            inserted = true
            const reqs: RequestItem[] = Array.isArray(f.requests) ? f.requests : []
            nextFolder = { ...f, requests: [...reqs, req] }
          } else if (!inserted) {
            const nested = Array.isArray(f.folders) ? f.folders : []
            if (nested.length) {
              const child = insertIntoFolders(nested, folderId, req)
              if (child.inserted) {
                inserted = true
                nextFolder = { ...f, folders: child.folders }
              }
            }
          }

          if (!nextFolders) {
            if (nextFolder !== f) {
              nextFolders = folders.slice(0, i)
              nextFolders.push(nextFolder)
            }
          } else {
            nextFolders.push(nextFolder)
          }
        }

        if (!inserted) return { folders, inserted: false }
        return { folders: nextFolders ?? folders, inserted: true }
      }

      const next = prev.map(c => {
        if (c.id !== collectionId) return c

        const direct = c.requests ?? []
        const directFound = direct.find(r => r.id === requestId) ?? null
        const folderFound = directFound ? null : findInFolders(c.folders as any)

        const originFolderId = directFound ? null : (folderFound?.folderId ?? null)
        movedReq = directFound ?? folderFound?.req ?? null
        if (!movedReq) return c
        if (originFolderId === targetFolderId) return c

        let nextDirect = directFound ? direct.filter(r => r.id !== requestId) : direct
        let nextFolders = c.folders as any

        if (!directFound) {
          const removed = removeFromFolders(c.folders as any)
          nextFolders = removed.removed ? removed.folders : nextFolders
        }

        if (!targetFolderId) {
          nextDirect = [...nextDirect, movedReq]
        } else {
          const inserted = insertIntoFolders(nextFolders, targetFolderId, movedReq)
          nextFolders = inserted.folders
          if (!inserted.inserted) nextDirect = [...nextDirect, movedReq]
        }

        didMove = true
        updatedCol = { ...c, requests: nextDirect, folders: nextFolders }
        return updatedCol
      })

      if (!didMove || !updatedCol || !movedReq) return prev
      saveCollections(next)

      if (active?.req.id === requestId && active.col.id === collectionId) {
        setActive({ col: updatedCol, req: movedReq })
      }

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

    setWorkspace(prev => {
      function removeCollectionFromWorkspaceFolders(folders: WorkspaceFolder[]): { folders: WorkspaceFolder[], changed: boolean } {
        let changed = false
        const nextFolders = folders.map(f => {
          const filtered = f.collectionIds.filter(id => id !== collectionId)
          const childRes = f.folders?.length ? removeCollectionFromWorkspaceFolders(f.folders) : null
          const nextFoldersInner = childRes ? childRes.folders : f.folders
          if (childRes?.changed) changed = true
          const didChangeHere = filtered.length !== f.collectionIds.length
          if (didChangeHere) changed = true
          if (!didChangeHere && !childRes?.changed) return f
          return nextFoldersInner?.length
            ? { ...f, collectionIds: filtered, folders: nextFoldersInner }
            : { ...f, collectionIds: filtered, folders: undefined }
        })
        return { folders: nextFolders, changed }
      }

      const res = removeCollectionFromWorkspaceFolders(prev.folders)
      const next: Workspace = { ...prev, folders: res.folders }
      saveWorkspace(next)
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

  function openCreateWorkspaceFolder() {
    setWorkspaceFolderError(null)
    setWorkspaceFolderName('New Folder')
    createWorkspaceFolderDialogRef.current?.showModal()
  }

  function closeCreateWorkspaceFolder() {
    createWorkspaceFolderDialogRef.current?.close()
  }

  function createWorkspaceFolder() {
    setWorkspaceFolderError(null)
    const base = workspaceFolderName.trim()
    if (!base) {
      setWorkspaceFolderError('Введите имя папки.')
      return
    }

    setWorkspace(prev => {
      const existing = new Set<string>()
      const visit = (folders: WorkspaceFolder[]) => {
        for (const f of folders) {
          existing.add(f.name)
          if (f.folders?.length) visit(f.folders)
        }
      }
      visit(prev.folders)
      let name = base
      for (let i = 2; existing.has(name); i++) name = `${base} ${i}`

      const next: Workspace = {
        ...prev,
        folders: [{ id: uid('wfolder'), name, collectionIds: [], folders: [] }, ...prev.folders],
      }
      saveWorkspace(next)
      return next
    })

    closeCreateWorkspaceFolder()
  }

  function addWorkspaceFolderToFolder(parentFolderId: string) {
    const base = 'New Folder'
    const newId = uid('wfolder')

    setWorkspace(prev => {
      const existing = new Set<string>()
      const visit = (folders: WorkspaceFolder[]) => {
        for (const f of folders) {
          existing.add(f.name)
          if (f.folders?.length) visit(f.folders)
        }
      }
      visit(prev.folders)

      let name = base
      for (let i = 2; existing.has(name); i++) name = `${base} ${i}`
      const newFolder: WorkspaceFolder = { id: newId, name, collectionIds: [], folders: [] }

      function addToFolders(folders: WorkspaceFolder[]): { folders: WorkspaceFolder[], added: boolean } {
        let added = false
        const nextFolders = folders.map(f => {
          if (f.id === parentFolderId) {
            added = true
            const nested = f.folders ?? []
            return { ...f, folders: [newFolder, ...nested] }
          }
          const nested = f.folders ?? []
          if (!nested.length) return f
          const child = addToFolders(nested)
          if (!child.added) return f
          added = true
          return { ...f, folders: child.folders }
        })
        return { folders: nextFolders, added }
      }

      const res = addToFolders(prev.folders)
      if (!res.added) return prev
      const next: Workspace = { ...prev, folders: res.folders }
      saveWorkspace(next)
      return next
    })
  }

  function moveCollectionToWorkspaceFolder(collectionId: string, workspaceFolderId: string | null) {
    setWorkspace(prev => {
      function moveInFolders(folders: WorkspaceFolder[]): { folders: WorkspaceFolder[], changed: boolean } {
        let changed = false
        const nextFolders = folders.map(f => {
          const filtered = f.collectionIds.filter(id => id !== collectionId)
          const shouldAddHere = workspaceFolderId && f.id === workspaceFolderId
          const collectionIds = shouldAddHere
            ? (filtered.includes(collectionId) ? filtered : [...filtered, collectionId])
            : filtered

          const childRes = f.folders?.length ? moveInFolders(f.folders) : null
          const nextChildFolders = childRes ? childRes.folders : f.folders

          const didChangeHere = collectionIds.length !== f.collectionIds.length || collectionIds.some((v, i) => v !== f.collectionIds[i])
          if (didChangeHere || childRes?.changed) changed = true
          if (!didChangeHere && !childRes?.changed) return f
          return nextChildFolders?.length
            ? { ...f, collectionIds, folders: nextChildFolders }
            : { ...f, collectionIds, folders: undefined }
        })
        return { folders: nextFolders, changed }
      }

      const res = moveInFolders(prev.folders)
      if (!res.changed) return prev
      const next: Workspace = { ...prev, folders: res.folders }
      saveWorkspace(next)
      return next
    })
  }

  function renameWorkspaceFolder(workspaceFolderId: string, name: string) {
    const nextName = name.trim()
    if (!nextName) return
    setWorkspace(prev => {
      function renameInFolders(folders: WorkspaceFolder[]): { folders: WorkspaceFolder[], changed: boolean } {
        let changed = false
        const nextFolders = folders.map(f => {
          const didRename = f.id === workspaceFolderId && f.name !== nextName
          const childRes = f.folders?.length ? renameInFolders(f.folders) : null
          const nextChildFolders = childRes ? childRes.folders : f.folders
          if (didRename || childRes?.changed) changed = true
          if (!didRename && !childRes?.changed) return f
          const renamed = didRename ? { ...f, name: nextName } : f
          return nextChildFolders?.length
            ? { ...renamed, folders: nextChildFolders }
            : { ...renamed, folders: undefined }
        })
        return { folders: nextFolders, changed }
      }

      const res = renameInFolders(prev.folders)
      if (!res.changed) return prev
      const next: Workspace = { ...prev, folders: res.folders }
      saveWorkspace(next)
      return next
    })
  }

  function deleteWorkspaceFolder(workspaceFolderId: string) {
    setWorkspace(prev => {
      function removeFolder(folders: WorkspaceFolder[]): { folders: WorkspaceFolder[], removed: boolean } {
        let removed = false
        const nextFolders: WorkspaceFolder[] = []
        for (const f of folders) {
          if (f.id === workspaceFolderId) {
            removed = true
            continue
          }
          const nested = f.folders ?? []
          if (nested.length) {
            const child = removeFolder(nested)
            if (child.removed) {
              removed = true
              nextFolders.push(child.folders.length ? { ...f, folders: child.folders } : { ...f, folders: undefined })
              continue
            }
          }
          nextFolders.push(f)
        }
        return { folders: nextFolders, removed }
      }

      const res = removeFolder(prev.folders)
      if (!res.removed) return prev
      const next: Workspace = { ...prev, folders: res.folders }
      saveWorkspace(next)
      return next
    })
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
      setProjectError('Введите имя коллекции.')
      return
    }

    const req: RequestItem = {
      id: uid('req'),
      name: 'New Request',
      method: 'GET',
      path: '/',
      urlTemplate: '{{baseUrl}}/',
      params: [],
      headers: {},
    }

    const col: Collection = {
      id: uid('col'),
      name,
      baseUrl: undefined,
      requests: [req],
      folders: [],
    }

    addCollection(col)
    setActive({ col, req })
    saveActiveSelection({ collectionId: col.id, requestId: req.id })
    closeCreateProject()
  }

  useEffect(() => {
    if (editorWidth) return
    const el = panelRef.current
    if (!el) return
    const w = el.getBoundingClientRect().width
    if (w <= 0) return
    setEditorWidth(getDefaultEditorWidthPx(w))
  }, [editorWidth])

  function onSidebarResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth
    ;(e.currentTarget as any).setPointerCapture?.(e.pointerId)

    function onMove(ev: PointerEvent) {
      const viewportWidthPx = getViewportWidthPx()
      const sidebarMaxByViewport = Math.min(
        SIDEBAR_MAX_PX,
        Math.max(SIDEBAR_MIN_PX, viewportWidthPx - RESIZER_GUTTER_PX - LAYOUT_MAIN_MIN_PX),
      )
      const next = clamp(startW + (ev.clientX - startX), SIDEBAR_MIN_PX, sidebarMaxByViewport)
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

  function onSidebarResizerDoubleClick() {
    const next = getDefaultSidebarWidthPx()
    setSidebarWidth(next)
    localStorage.setItem('ruf_sidebar_width_v1', String(next))
  }

  function onPanelResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const { min, max } = getPanelPaneConstraints(rect.width)
    const startX = e.clientX
    const startW = editorWidth || Math.round(rect.width / 2)
    ;(e.currentTarget as any).setPointerCapture?.(e.pointerId)

    function onMove(ev: PointerEvent) {
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

  function onPanelResizerDoubleClick() {
    const el = panelRef.current
    if (!el) {
      setEditorWidth(0)
      localStorage.removeItem('ruf_editor_width_v1')
      return
    }
    const rect = el.getBoundingClientRect()
    const next = getDefaultEditorWidthPx(rect.width)
    setEditorWidth(next)
    localStorage.setItem('ruf_editor_width_v1', String(next))
  }

  return (
    <div className="layout" style={{ gridTemplateColumns: `${sidebarWidth}px 8px 1fr` }}>
      <aside className="sidebar">
        <div className="sidebarBrand">
          <div className="sidebarBrandRow">
            <span className="appTitle">Ruf</span> <span className="small">API Platofrm</span>
            <SidebarCreateMenu
              onImport={() => importOpenRef.current?.()}
              onCreateCollection={openCreateProject}
              onCreateFolder={openCreateWorkspaceFolder}
            />
            <ImportFab onImported={addCollection} openRef={importOpenRef} showTrigger={false} />
            <button
              className="iconBtn"
              style={{ marginLeft: 'auto' }}
              onClick={openSettings}
              aria-label="Settings"
              title="Настройки"
            >
              ⚙
            </button>
          </div>
        </div>
        <div className="sidebarTreeWrap">
          <WorkspaceTree
            workspace={workspace}
            collections={collections}
            environmentsByCollection={envByCollection}
            activeRequestId={activeRequestId}
            inFlightCountByRequestId={inFlightCountByRequestId}
            onPickRequest={pick}
            onOpenEnv={setEnvModalCollectionId}
            onUpdateCollectionFromUrl={updateCollectionFromUrl}
            onReloadCollectionFromFile={openReloadFromFile}
            onAddRequest={addRequestToCollection}
            onAddFolder={addFolderToCollection}
            onAddRequestToFolder={addRequestToFolder}
            onAddFolderToFolder={addFolderToFolder}
            onRenameCollection={renameCollection}
            onRenameFolder={renameFolder}
            onRenameRequest={renameRequest}
            onMoveFolder={moveFolder}
            onMoveRequest={moveRequest}
            onDeleteFolder={deleteFolder}
            onDeleteRequest={deleteRequest}
            onDeleteCollection={requestDeleteCollection}
            onMoveCollectionToWorkspaceFolder={moveCollectionToWorkspaceFolder}
            onAddWorkspaceFolderToFolder={addWorkspaceFolderToFolder}
            onRenameWorkspaceFolder={renameWorkspaceFolder}
            onDeleteWorkspaceFolder={deleteWorkspaceFolder}
          />
        </div>

        <div className="sidebarBottom">
          <button
            className="iconBtn settingsBtn"
            onClick={openSettings}
            aria-label="Settings"
            title="Settings"
          >
            <span className="iconGlyph">&#9881;</span>
          </button>
          <div className="sidebarVersion mono">
            v{appVersion ?? '—'}
          </div>
        </div>
      </aside>
      <div
        className="resizer"
        onPointerDown={onSidebarResizePointerDown}
        onDoubleClick={onSidebarResizerDoubleClick}
      />

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
              ? (
                  <RequestEditor
                    environment={envByCollection[active.col.id] ?? DEFAULT_ENVIRONMENT}
                    collection={active.col}
                    request={active.req}
                    inFlightCount={inFlightCountByRequestId[active.req.id] ?? 0}
                    onBeforeSend={(requestId, item) => onRequestBeforeSend(requestId, item)}
                    onSendStart={requestId => onRequestSendStart(requestId)}
                    onSendEnd={requestId => onRequestSendEnd(requestId)}
                    onResult={(requestId, result) => onRequestResult(requestId, result)}
                    onChangeMethod={m => setRequestMethod(active.col.id, active.req.id, m)}
                    applyDraft={
                      applyDraftState && applyDraftState.requestId === active.req.id
                        ? { token: applyDraftState.token, draft: applyDraftState.draft }
                        : null
                    }
                  />
                )
              : <div className="small">Import collection or choose the request from the left.</div>
            }
          </section>

          <div
            className="resizer"
            onPointerDown={onPanelResizePointerDown}
            onDoubleClick={onPanelResizerDoubleClick}
          />

          <section className="card" style={{ overflow: 'hidden' }}>
            <ResponseViewer
              result={activeRequestId ? (resultByRequestId[activeRequestId] ?? null) : null}
              inFlightCount={activeRequestId ? (inFlightCountByRequestId[activeRequestId] ?? 0) : 0}
              tab={activeResponseTab}
              historyItems={activeHistory}
              onSelectHistoryItem={item => {
                if (!activeRequestId) return
                setApplyDraftState({ requestId: activeRequestId, token: uid('apply'), draft: item.draft })
              }}
              onDeleteHistoryItem={item => {
                const requestId = activeRequestId
                if (!requestId) return
                setHistoryByRequestId(prev => {
                  const prevItems = prev[requestId] ?? []
                  const nextItems = prevItems.filter(x => x.id !== item.id)
                  const next = { ...prev, [requestId]: nextItems }
                  if (!nextItems.length) delete (next as any)[requestId]
                  saveRequestHistoryByRequestId(next)
                  return next
                })
              }}
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
        className="modal modalSmall"
        onClose={() => {
          setProjectError(null)
          setProjectName('')
        }}
      >
        <div className="modalHeader">
          <b>Create Collection</b>
          <button className="iconBtn" onClick={closeCreateProject} aria-label="Close">✕</button>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr', gap:10}}>
          <div className="small">Имя</div>
          <input style={{ width: '100%' }} value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="My API" />
        </div>

        {projectError && <div className="small" style={{color:'#ff9a9a', marginTop: 8}}>{projectError}</div>}

        <div className="modalActions">
          <button onClick={createProject}>Create</button>
        </div>
      </dialog>

      <dialog
        ref={createWorkspaceFolderDialogRef}
        className="modal modalSmall"
        onClose={() => {
          setWorkspaceFolderError(null)
          setWorkspaceFolderName('New Folder')
        }}
      >
        <div className="modalHeader">
          <b>Create Folder</b>
          <button className="iconBtn" onClick={closeCreateWorkspaceFolder} aria-label="Close">✕</button>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr', gap:10}}>
          <div className="small">Имя</div>
          <input
            style={{ width: '100%' }}
            value={workspaceFolderName}
            onChange={e => setWorkspaceFolderName(e.target.value)}
            onFocus={e => e.currentTarget.select()}
            autoFocus
            placeholder="New Folder"
          />
        </div>

        {workspaceFolderError && <div className="small" style={{color:'#ff9a9a', marginTop: 8}}>{workspaceFolderError}</div>}

        <div className="modalActions">
          <button onClick={createWorkspaceFolder}>Create</button>
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

      <dialog
        ref={reloadFromFileDialogRef}
        className="modal modalSmall"
        onClose={() => {
          setReloadFromFileCollectionId(null)
          setReloadFromFileError(null)
          setReloadFromFilePending(null)
          setReloadFromFileSummary(null)
          setReloadFromFileSelectedName('')
        }}
      >
        <div className="modalHeader">
          <b>Reload From File</b>
          <button className="iconBtn" onClick={closeReloadFromFile} aria-label="Close">✕</button>
        </div>

        <input
          ref={reloadFromFileInputRef}
          type="file"
          accept=".json,.yaml,.yml"
          style={{ display: 'none' }}
          onChange={onReloadFromFileSelected}
        />

        <div className="small">
          {reloadFromFileCollection ? `Collection: ${reloadFromFileCollection.name}` : 'Collection not found.'}
        </div>

        {(reloadFromFileCollection?.sourceFileName || reloadFromFileSelectedName) ? (
          <div className="small" style={{ marginTop: 8, opacity: 0.8 }}>
            {reloadFromFileCollection?.sourceFileName ? (
              <div>
                Current file: <span className="mono">{reloadFromFileCollection.sourceFileName}</span>
              </div>
            ) : null}
            {reloadFromFileSelectedName ? (
              <div>
                Selected file: <span className="mono">{reloadFromFileSelectedName}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="modalActions" style={{ justifyContent: 'flex-start' }}>
          <button onClick={chooseReloadFromFile}>Choose File</button>
        </div>

        {reloadFromFileSummary ? (
          <div className="small">
            Folders: +{reloadFromFileSummary.addedFolders} / -{reloadFromFileSummary.removedFolders},{' '}
            Requests: +{reloadFromFileSummary.addedRequests} / -{reloadFromFileSummary.removedRequests}
          </div>
        ) : null}

        {reloadFromFileError ? (
          <div className="small" style={{ color: '#ff9a9a', marginTop: 8 }}>
            {reloadFromFileError}
          </div>
        ) : null}

        <div className="modalActions">
          <button onClick={closeReloadFromFile}>Cancel</button>
          <button onClick={applyReloadFromFile} disabled={!reloadFromFilePending}>Update</button>
        </div>
      </dialog>

      <dialog
        ref={settingsDialogRef}
        className="modal modalSmall"
      >
        <div className="modalHeader" style={{ marginBottom: 0 }}>
          <b>Settings</b>
          <button className="iconBtn" onClick={closeSettings} aria-label="Close" title="Close">✕</button>
        </div>
        <hr className="modalDivider" />

        <label className="checkRow">
          <input
            type="checkbox"
            className="checkInput"
            checked={validateCertificates}
            onChange={e => setValidateCertificates(e.target.checked)}
          />
          <span className="checkBox" aria-hidden="true" />
          <span className="checkText">Validate certificates</span>
        </label>

        <div className="modalActions" style={{ justifyContent: 'space-between', marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {hasPendingUpdate ? (
              updateDownloaded ? (
                <>
                  <button onClick={onRestartToUpdate} disabled={updateBusy}>
                    {updateTask === 'installing' ? 'Restarting…' : 'Restart'}
                  </button>
                  <button onClick={onUpdateLater} disabled={updateBusy}>Not now</button>
                </>
              ) : (
                <button onClick={onUpdateNow} disabled={updateBusy}>
                  {updateTask === 'downloading' ? 'Downloading…' : 'Update'}
                </button>
              )
            ) : (
              <button onClick={onCheckUpdates} disabled={updateBusy}>
                {updateTask === 'checking' ? 'Checking…' : 'Check Updates'}
              </button>
            )}
            {updateHint ? (
              <div
                className="small"
                style={{
                  opacity: 0.85,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  color: hasPendingUpdate ? '#6ee7a8' : undefined,
                }}
              >
                {updateHint}
              </div>
            ) : null}
          </div>
          <button onClick={closeSettings}>Save</button>
        </div>
      </dialog>

      {showUpdateToast && hasPendingUpdate ? (
        <div className="updateToast" role="dialog" aria-label="Update available">
          <div className="updateToastTitle">
            {updateDownloaded
              ? 'Download complete. Restart the app to install?'
              : updateTask === 'downloading'
                ? `Downloading update${typeof updateDownloadPct === 'number' ? ` (${updateDownloadPct}%)` : ''}…`
                : 'New version is available!'}
          </div>
          {updateTask === 'downloading' && typeof updateDownloadPct === 'number' ? (
            <div className="small" style={{ opacity: 0.85, marginTop: 4 }}>
              {updateDownloadPct}%
            </div>
          ) : null}
          <div className="updateToastActions">
            {updateDownloaded ? (
              <>
                <button onClick={onRestartToUpdate} disabled={updateBusy}>Restart</button>
                <button onClick={onUpdateLater} disabled={updateBusy}>Not now</button>
              </>
            ) : (
              <>
                <button onClick={onUpdateNow} disabled={updateBusy}>Update</button>
                <button onClick={onUpdateLater} disabled={updateBusy}>Later</button>
              </>
            )}
          </div>
        </div>
      ) : null}

    </div>
  )
}
