import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { ImportFab } from './features/importSpec/ImportFab'
import { SidebarCreateMenu } from './components/SidebarCreateMenu'
import { buildImportedCollectionFromText } from './features/importSpec/buildImportedCollection'
import { WorkspaceTree } from './CollectionTree'
import { RequestEditor } from './RequestEditor'
import { ResponseViewer } from './ResponseViewer'
import { EnvironmentSettings } from './features/environment/EnvironmentSettings'
import type { Collection, HttpMethod, RequestItem } from './CollectionTree'
import type { Environment } from './shared/types/environment'
import { DEFAULT_ENVIRONMENT } from './shared/types/environment'
import { loadCollections, loadEnvironmentsByCollection, saveCollections, saveEnvironmentsByCollection } from './shared/utils/storage'
import type { Workspace } from './shared/types/workspace'
import { loadWorkspace, saveWorkspace } from './shared/utils/workspaceStorage'
import type { RunResult } from './features/requestRunner/runRequest'
import { uid } from './shared/utils/id'
import type { RequestDraft, RequestHistoryItem } from './shared/types/requestHistory'
import { appendRequestHistoryItem, loadRequestHistoryByRequestId, saveRequestHistoryByRequestId } from './shared/utils/requestHistory'
import { syncCollectionKeepingIds, summarizeCollectionDiff } from './CollectionTree'
import { loadAppSettings, saveAppSettings } from './shared/utils/appSettings'
import { fetchWithProxyFallback } from './shared/utils/proxyFetch'

//TODO:
// импорт soap
// поправить юай для ноутбуков и fullhd
// запаковать все в exe

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
  const SIDEBAR_BASE_PX = 420
  const SIDEBAR_MIN_PX = 190
  const SIDEBAR_MAX_PX = 720
  const PANEL_RIGHT_BASE_PX = 800
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const raw = localStorage.getItem('ruf_sidebar_width_v1')
    const n = raw ? Number(raw) : SIDEBAR_BASE_PX
    const base = Number.isFinite(n) && n > 0 ? n : SIDEBAR_BASE_PX
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

  function openSettings() {
    settingsDialogRef.current?.showModal()
  }

  function closeSettings() {
    settingsDialogRef.current?.close()
  }

  useEffect(() => {
    saveAppSettings({ validateCertificates })
  }, [validateCertificates])

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
      const next: Workspace = {
        ...prev,
        folders: prev.folders.map(f => ({ ...f, collectionIds: f.collectionIds.filter(id => id !== collectionId) })),
      }
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
      const existing = new Set(prev.folders.map(f => f.name))
      let name = base
      for (let i = 2; existing.has(name); i++) name = `${base} ${i}`

      const next: Workspace = {
        ...prev,
        folders: [{ id: uid('wfolder'), name, collectionIds: [] }, ...prev.folders],
      }
      saveWorkspace(next)
      return next
    })

    closeCreateWorkspaceFolder()
  }

  function moveCollectionToWorkspaceFolder(collectionId: string, workspaceFolderId: string | null) {
    setWorkspace(prev => {
      const nextFolders = prev.folders.map(f => {
        const filtered = f.collectionIds.filter(id => id !== collectionId)
        const shouldAddHere = workspaceFolderId && f.id === workspaceFolderId
        const collectionIds = shouldAddHere ? [...filtered, collectionId] : filtered
        return filtered.length === f.collectionIds.length && !shouldAddHere ? f : { ...f, collectionIds }
      })
      const next: Workspace = { ...prev, folders: nextFolders }
      saveWorkspace(next)
      return next
    })
  }

  function renameWorkspaceFolder(workspaceFolderId: string, name: string) {
    const nextName = name.trim()
    if (!nextName) return
    setWorkspace(prev => {
      const next: Workspace = {
        ...prev,
        folders: prev.folders.map(f => (f.id === workspaceFolderId ? { ...f, name: nextName } : f)),
      }
      saveWorkspace(next)
      return next
    })
  }

  function deleteWorkspaceFolder(workspaceFolderId: string) {
    setWorkspace(prev => {
      const next: Workspace = { ...prev, folders: prev.folders.filter(f => f.id !== workspaceFolderId) }
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
    const min = 320
    const max = Math.max(min, w - 320)
    const next = clamp(Math.round(w - 8 - PANEL_RIGHT_BASE_PX), min, max)
    setEditorWidth(next)
  }, [editorWidth])

  function onSidebarResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth
    ;(e.currentTarget as any).setPointerCapture?.(e.pointerId)

    function onMove(ev: PointerEvent) {
      const next = clamp(startW + (ev.clientX - startX), SIDEBAR_MIN_PX, SIDEBAR_MAX_PX)
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
    const next = clamp(SIDEBAR_BASE_PX, SIDEBAR_MIN_PX, SIDEBAR_MAX_PX)
    setSidebarWidth(next)
    localStorage.setItem('ruf_sidebar_width_v1', String(next))
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

  function onPanelResizerDoubleClick() {
    const el = panelRef.current
    if (!el) {
      setEditorWidth(0)
      localStorage.removeItem('ruf_editor_width_v1')
      return
    }
    const rect = el.getBoundingClientRect()
    const min = 320
    const max = Math.max(min, rect.width - 320)
    const next = clamp(Math.round(rect.width - 8 - PANEL_RIGHT_BASE_PX), min, max)
    setEditorWidth(next)
    localStorage.setItem('ruf_editor_width_v1', String(next))
  }

  return (
    <div className="layout" style={{ gridTemplateColumns: `${sidebarWidth}px 8px 1fr` }}>
      <aside className="sidebar">
        <div className="sidebarBrand">
          <div className="sidebarBrandRow">
            <span className="appTitle">Ruf</span> <span className="small">(web-only)</span>
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
          <div className="small sidebarTagline">API platform</div>
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
              : <div className="small">Импортируй OpenAPI или выбери запрос слева.</div>
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
        <div className="modalHeader">
          <b>Настройки</b>
          <button className="iconBtn" onClick={closeSettings} aria-label="Close" title="Close">✕</button>
        </div>

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

        <div className="modalActions">
          <button onClick={closeSettings}>Сохранить</button>
        </div>
      </dialog>
    </div>
  )
}
