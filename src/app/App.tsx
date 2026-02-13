import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { CloseIcon, FoldersCollapseIcon, FoldersExpandIcon, MaximizeIcon, MinimizeIcon, SortAscIcon, SortDescIcon, SortNeutralIcon } from '../shared/icons'
import { SidebarCreateMenu } from '../shared/components/SidebarCreateMenu'
import { WorkspaceTree, syncCollectionKeepingIds, summarizeCollectionDiff, type Collection, type Folder, type HttpMethod, type RequestItem, type TreeSortMode } from '../modules/collectionTree'
import { RequestEditor } from '../modules/requestEditor'
import { ResponseViewer } from '../modules/responseViewer'
import { ImportFab, buildImportedCollectionFromText } from '../modules/import'
import { parseJsonOrYaml } from '../modules/import/openapi/openapiLoader'
import { EnvironmentSettings } from '../modules/environment'
import {
  buildDbConnectionString,
  getDbConnectionStringPreview,
  parseDbConnectionString,
  runDbConnectionTest,
  type DbType,
  type PgSslMode,
} from '../modules/environment'
import {
  addGlobalSqlConnectionItem,
  createInitialGlobalSqlConnections,
  getPrimaryGlobalSqlSettings,
  removeGlobalSqlConnectionItem,
  setConnectionTypeAndMaybeDefaultPort as setConnectionTypeAndMaybeDefaultPortItem,
  updateGlobalSqlConnectionItem,
} from '../modules/environment/utils/globalSqlConnections'
import type { Environment, GlobalSqlConnectionItem, GlobalSqlConnectionSettings } from '../shared/types/environment'
import { DEFAULT_ENVIRONMENT, DEFAULT_GLOBAL_SQL_CONNECTION_SETTINGS } from '../shared/types/environment'
import { loadCollections, loadEnvironmentsByCollection, saveCollections, saveEnvironmentsByCollection } from '../shared/utils/storage'
import type { Workspace, WorkspaceFolder } from '../shared/types/workspace'
import { loadWorkspace, saveWorkspace } from '../shared/utils/workspaceStorage'
import type { RunResult } from '../modules/requestRunner/runRequest'
import { uid } from '../shared/utils/id'
import type { RequestDraft, RequestHistoryItem } from '../shared/types/requestHistory'
import { appendRequestHistoryItem, loadRequestHistoryByRequestId, saveRequestHistoryByRequestId } from '../shared/utils/requestHistory'
import { loadAppSettings, saveAppSettings, type CaCertificate } from '../shared/utils/appSettings'
import { platformFetch } from '../shared/utils/platformFetch'
import { isAbsoluteUrl } from '../shared/utils/url'
import { tauriInvoke } from '../shared/utils/tauri'
import { useAppUpdater } from './useAppUpdater'
import { extractPemCertificates, formatSha256Fingerprint, pemToDerBytes, sha256Hex } from '../shared/utils/certificates'
import { buildSidebarToolExtensions } from './extensions'
import { buildSettingsTabExtensions } from './settingsExtensions'
import { useDismissibleLayer } from '../shared/hooks/useDismissibleLayer'
import { safeParseJson } from '../shared/utils/json'
import { findRequestByIds } from '../core/services/appBootstrapService'
import { loadLocalStorageJson, saveLocalStorageJson } from '../shared/utils/localStorageJson'
import { logError, logWarn } from '../shared/utils/logger'

//TODO:
// Double-click the bottom border of the body editor to expand to text height; make the entire bottom border resizable
// "Reload" button: restore headers/params from the initial import; re-add missing ones
// On reload from URL/file, also restore headers/params if they are missing
// Undo after deleting a param/header via Ctrl+Z
// Response search history: is it recorded after every change?? mouse clicks??
// Send a series of requests with an iteration count input??
// Структура хранения данных приложения

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

const ACTIVE_SELECTION_KEY = 'ruf_active_request_v1'
const RESPONSE_TAB_BY_REQUEST_KEY = 'ruf_response_tab_by_request_v1'
const TREE_SORT_MODE_KEY = 'ruf_tree_sort_mode_v1'
const APP_CACHE_KEYS = [
  ACTIVE_SELECTION_KEY,
  RESPONSE_TAB_BY_REQUEST_KEY,
  TREE_SORT_MODE_KEY,
  'ruf_sidebar_width_v1',
  'ruf_editor_width_v1',
  'ruf_tree_open_state_v1',
  'ruf_workspace_open_state_v1',
  'ruf_terminal_height_v1',
  'ruf_sql_terminal_height_v1',
  'ruf_sql_terminal_selected_conn_v1',
  'ruf_sql_terminal_sql_v1',
  'ruf_sql_terminal_split_v1',
  'ruf_sql_terminal_schema_v1',
  'ruf_sql_terminal_position_v1',
  'ruf_sql_terminal_width_v1',
  'ruf_request_history_v1',
  'ruf_request_drafts_v1',
  'ruf_value_history_v1',
  'ruf_response_search_history_v1',
  'ruf.update.toastSuppress',
] as const

function utf8ByteLength(value: string) {
  try {
    return new TextEncoder().encode(value).length
  } catch {
    return value.length
  }
}

function getLocalStorageCacheSizeBytes() {
  let total = 0
  for (const key of APP_CACHE_KEYS) {
    const value = localStorage.getItem(key)
    if (typeof value !== 'string') continue
    total += utf8ByteLength(key) + utf8ByteLength(value)
  }
  return total
}

function formatMegabytes(bytes: number) {
  return `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(2)} MB`
}

type SavedActiveSelection = { collectionId: string, requestId: string }

type TreeToggleAction = 'expand' | 'collapse'
type RecentRequestVisit = { collectionId: string, requestId: string }
type RecentRequestTabResolved = RecentRequestVisit & {
  key: string
  collectionName: string
  requestName: string
  col: Collection
  req: RequestItem
}

function loadActiveSelection(): SavedActiveSelection | null {
  const parsed = loadLocalStorageJson<any>(ACTIVE_SELECTION_KEY, null)
  if (!parsed || typeof parsed !== 'object') return null
  const collectionId = typeof parsed.collectionId === 'string' ? parsed.collectionId : ''
  const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : ''
  if (!collectionId || !requestId) return null
  return { collectionId, requestId }
}

function saveActiveSelection(sel: SavedActiveSelection) {
  saveLocalStorageJson(ACTIVE_SELECTION_KEY, sel)
}

function clearActiveSelection() {
  localStorage.removeItem(ACTIVE_SELECTION_KEY)
}

function loadTreeSortMode(): TreeSortMode {
  const raw = loadLocalStorageJson<string | null>(TREE_SORT_MODE_KEY, null)
  return raw === 'asc' || raw === 'desc' || raw === 'none' ? raw : 'none'
}

function saveTreeSortMode(mode: TreeSortMode) {
  saveLocalStorageJson(TREE_SORT_MODE_KEY, mode)
}

function invertTreeToggleAction(action: TreeToggleAction): TreeToggleAction {
  return action === 'expand' ? 'collapse' : 'expand'
}

function toSwaggerOperationIdGuess(name: string, fallbackMethod: string, fallbackPath: string) {
  const raw = (name || '').trim()
  if (!raw) {
    const pathPart = fallbackPath
      .split('/')
      .filter(Boolean)
      .map(part => part.replaceAll(/[{}]/g, ''))
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('')
    return `${fallbackMethod.toLowerCase()}${pathPart || 'Operation'}`
  }
  const cleaned = raw
    .replaceAll(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim()
  if (!cleaned) return `${fallbackMethod.toLowerCase()}Operation`
  const words = cleaned.split(/\s+/g).filter(Boolean)
  return words
    .map((w, i) => {
      const lower = w.toLowerCase()
      return i === 0 ? lower : (lower.charAt(0).toUpperCase() + lower.slice(1))
    })
    .join('')
}

function toPathLikeOperationIdGuess(path: string) {
  const segments = (path || '')
    .split('/')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !(s.startsWith('{') && s.endsWith('}')))

  if (!segments.length) return ''

  const raw = segments[segments.length - 1] || ''
  const cleaned = raw.replaceAll(/[^\p{L}\p{N}_-]+/gu, ' ').trim()
  if (!cleaned) return ''

  const parts = cleaned.split(/[\s_-]+/g).filter(Boolean)
  if (!parts.length) return ''

  return parts
    .map((p, i) => {
      const lower = p.toLowerCase()
      return i === 0 ? lower : (lower.charAt(0).toUpperCase() + lower.slice(1))
    })
    .join('')
}

function getSwaggerTagFromPath(path: string) {
  const first = (path || '')
    .split('/')
    .map(x => x.trim())
    .find(Boolean)
  if (!first) return 'default'
  return first.replaceAll(/[{}]/g, '') || 'default'
}

function normalizePathTemplate(path: string) {
  const withLeading = (path || '').trim().startsWith('/') ? (path || '').trim() : `/${(path || '').trim()}`
  return withLeading.replaceAll(/\{[^}]+\}/g, '{}')
}

function trimTrailingSlash(path: string) {
  if (!path) return ''
  return path.replace(/\/+$/g, '')
}

function buildSwaggerUiBaseCandidates(args: { sourceUrl: string; serviceBaseUrl?: string }) {
  const out: string[] = []
  const push = (v: string) => {
    const normalized = v.trim()
    if (!normalized || out.includes(normalized)) return
    out.push(normalized)
  }

  try {
    if (args.serviceBaseUrl && isAbsoluteUrl(args.serviceBaseUrl)) {
      const su = new URL(args.serviceBaseUrl)
      const p = trimTrailingSlash(su.pathname || '')
      if (p.endsWith('/swagger-ui/index.html') || p.endsWith('/swagger-ui')) push(`${su.origin}${p}`)
      push(`${su.origin}/`)
      push(`${su.origin}/swagger-ui/index.html`)
      if (p && p !== '/' && !p.endsWith('/swagger-ui') && !p.endsWith('/swagger-ui/index.html')) {
        push(`${su.origin}${p}/swagger-ui/index.html`)
      }
    }
  } catch (error) {
    logWarn('buildSwaggerUiBaseCandidates.serviceBaseUrl', 'Failed to parse serviceBaseUrl while building Swagger UI candidates', {
      error,
      serviceBaseUrl: args.serviceBaseUrl,
    })
  }

  try {
    const u = new URL(args.sourceUrl)
    const p = u.pathname || ''
    push(`${u.origin}/`)
    push(`${u.origin}/swagger-ui/index.html`)
    const m = p.match(/^(.*?)(?:\/v[23]\/api-docs(?:\/.*)?|\/api-docs(?:\/.*)?|\/openapi\.json(?:\/.*)?)$/i)
    if (m) {
      const prefix = trimTrailingSlash(m[1] || '')
      if (prefix && prefix !== '/') push(`${u.origin}${prefix}/swagger-ui/index.html`)
    }
  } catch (error) {
    logWarn('buildSwaggerUiBaseCandidates.sourceUrl', 'Failed to parse sourceUrl while building Swagger UI candidates', {
      error,
      sourceUrl: args.sourceUrl,
    })
  }

  return out
}

function buildSwaggerUiUrl(args: { swaggerUiBase: string; tag: string; operationId: string }) {
  return `${args.swaggerUiBase}#/${encodeURIComponent(args.tag)}/${encodeURIComponent(args.operationId)}`
}

function isLikelySwaggerUiHtml(text: string) {
  const t = text.toLowerCase()
  return t.includes('swagger-ui') || t.includes('swagger ui') || t.includes('swagger')
}

function isLikelyOpenApiSourceUrl(url: string) {
  return /(?:swagger|openapi|api-docs)/i.test(url)
}

type SwaggerContext = {
  sourceUrl: string
  serviceBaseUrl: string
  method: string
  path: string
  fallbackTag: string
  fallbackOperationId: string
}

function buildSwaggerOpCacheKey(ctx: SwaggerContext) {
  return `${ctx.sourceUrl}::${ctx.method}::${normalizePathTemplate(ctx.path)}`
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: number | null = null
  try {
    const timeoutPromise = new Promise<null>(resolve => {
      timer = window.setTimeout(() => resolve(null), timeoutMs)
    })
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timer != null) window.clearTimeout(timer)
  }
}

function mergeHistoryItemsById(preferred: RequestHistoryItem[], fallback: RequestHistoryItem[]) {
  const seen = new Set<string>()
  const out: RequestHistoryItem[] = []
  for (const item of preferred) {
    if (!item?.id || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  for (const item of fallback) {
    if (!item?.id || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

export default function App() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''
  const platform = typeof navigator !== 'undefined' ? (navigator.platform || '').toLowerCase() : ''
  const isMac = platform.includes('mac') || ua.includes('mac os')

  const settingsDialogRef = useRef<HTMLDialogElement | null>(null)
  const settingsTabsRef = useRef<HTMLDivElement | null>(null)
  const importOpenRef = useRef<{
    openMenu: () => void
    openNameStep: (col: Collection) => void
  } | null>(null)
  const reloadFromFileDialogRef = useRef<HTMLDialogElement | null>(null)
  const reloadFromFileInputRef = useRef<HTMLInputElement | null>(null)
  const initialAppSettings = useMemo(() => loadAppSettings(), [])
  const [settingsTab, setSettingsTab] = useState('general')
  const [requestTimeoutSec, setRequestTimeoutSec] = useState<number | null>(() => (
    initialAppSettings.requestTimeoutSec > 0 ? initialAppSettings.requestTimeoutSec : null
  ))
  const [validateCertificates, setValidateCertificates] = useState<boolean>(() => initialAppSettings.validateCertificates)
  const [caCertificates, setCaCertificates] = useState<CaCertificate[]>(() => initialAppSettings.caCertificates)
  const [caCertInput, setCaCertInput] = useState('')
  const [caCertError, setCaCertError] = useState<string | null>(null)
  const [caCertBusy, setCaCertBusy] = useState(false)
  const [globalSqlConnections, setGlobalSqlConnections] = useState<GlobalSqlConnectionItem[]>(() => (
    createInitialGlobalSqlConnections(
      initialAppSettings.globalSqlConnections ?? [],
      initialAppSettings.globalSql,
      uid,
    )
  ))
  const [sqlConnTypeMenuOpenId, setSqlConnTypeMenuOpenId] = useState<string | null>(null)
  const [sqlConnSslMenuOpenId, setSqlConnSslMenuOpenId] = useState<string | null>(null)
  const [sqlConnDeleteArmedId, setSqlConnDeleteArmedId] = useState<string | null>(null)
  const [sqlConnUrlInputById, setSqlConnUrlInputById] = useState<Record<string, string>>({})
  const [sqlConnTestById, setSqlConnTestById] = useState<Record<string, { inFlight: boolean, error: string | null, log: string | null, okMs: number | null }>>({})
  const sqlConnTestTimerByIdRef = useRef<Record<string, number>>({})
  const sqlConnDeleteArmTimerRef = useRef<number | null>(null)
  const [reloadFromFileCollectionId, setReloadFromFileCollectionId] = useState<string | null>(null)
  const [reloadFromFileError, setReloadFromFileError] = useState<string | null>(null)
  const [reloadFromFilePending, setReloadFromFilePending] = useState<Collection | null>(null)
  const [reloadFromFileSummary, setReloadFromFileSummary] = useState<ReturnType<typeof summarizeCollectionDiff> | null>(null)
  const [reloadFromFileSelectedName, setReloadFromFileSelectedName] = useState('')

  const initialBootstrap = useMemo(() => {
    const collections = loadCollections()
    const workspace = loadWorkspace()
    const envByCollection = loadEnvironmentsByCollection()
    const saved = loadActiveSelection()
    const active = saved ? findRequestByIds(collections, saved.collectionId, saved.requestId) : null
    return { collections, workspace, envByCollection, active }
  }, [])

  const [collections, setCollections] = useState<Collection[]>(() => initialBootstrap.collections)
  const [workspace, setWorkspace] = useState<Workspace>(() => initialBootstrap.workspace)
  const [active, setActive] = useState<{ col: Collection, req: RequestItem } | null>(() => initialBootstrap.active)
  const [recentRequestVisits, setRecentRequestVisits] = useState<RecentRequestVisit[]>([])
  const previousActiveVisitRef = useRef<RecentRequestVisit | null>(
    initialBootstrap.active ? { collectionId: initialBootstrap.active.col.id, requestId: initialBootstrap.active.req.id } : null,
  )
  const [resultByRequestId, setResultByRequestId] = useState<Record<string, RunResult | null>>({})
  const [inFlightCountByRequestId, setInFlightCountByRequestId] = useState<Record<string, number>>({})
  const [envByCollection, setEnvByCollection] = useState<Record<string, Environment>>(() => initialBootstrap.envByCollection)
  const [envModalCollectionId, setEnvModalCollectionId] = useState<string | null>(null)
  const createProjectDialogRef = useRef<HTMLDialogElement | null>(null)
  const createProjectInputRef = useRef<HTMLInputElement | null>(null)
  const [projectName, setProjectName] = useState('')
  const [projectError, setProjectError] = useState<string | null>(null)
  const createWorkspaceFolderDialogRef = useRef<HTMLDialogElement | null>(null)
  const createWorkspaceFolderInputRef = useRef<HTMLInputElement | null>(null)
  const [workspaceFolderName, setWorkspaceFolderName] = useState('New Folder')
  const [workspaceFolderError, setWorkspaceFolderError] = useState<string | null>(null)
  const [workspaceFolderCreateParentId, setWorkspaceFolderCreateParentId] = useState<string | null>(null)
  const createCollectionSubfolderDialogRef = useRef<HTMLDialogElement | null>(null)
  const createCollectionSubfolderInputRef = useRef<HTMLInputElement | null>(null)
  const [collectionSubfolderName, setCollectionSubfolderName] = useState('New Folder')
  const [collectionSubfolderError, setCollectionSubfolderError] = useState<string | null>(null)
  const [collectionSubfolderTarget, setCollectionSubfolderTarget] = useState<{ collectionId: string, parentFolderId: string | null } | null>(null)
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
  const treeCommandNonceRef = useRef(0)
  const [responseTabByRequest, setResponseTabByRequest] = useState<Record<string, 'body' | 'headers' | 'history'>>(() => {
    const parsed = safeParseJson<any>(localStorage.getItem(RESPONSE_TAB_BY_REQUEST_KEY))
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, 'body' | 'headers' | 'history'> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && (v === 'body' || v === 'headers' || v === 'history')) out[k] = v
    }
    return out
  })
  const [historyByRequestId, setHistoryByRequestId] = useState<Record<string, RequestHistoryItem[]>>({})
  const [applyDraftState, setApplyDraftState] = useState<{ requestId: string, token: string, draft: RequestDraft } | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [cacheSizeBytes, setCacheSizeBytes] = useState(0)
  const [openDrawerId, setOpenDrawerId] = useState<string | null>(null)
  const [treeAllExpanded, setTreeAllExpanded] = useState(false)
  const [treeOpenCommand, setTreeOpenCommand] = useState<{ action: TreeToggleAction, nonce: number } | null>(null)
  const [treeSortMode, setTreeSortMode] = useState<TreeSortMode>(() => loadTreeSortMode())
  const nextTreeToggleAction: TreeToggleAction = treeOpenCommand
    ? invertTreeToggleAction(treeOpenCommand.action)
    : (treeAllExpanded ? 'collapse' : 'expand')
  const treeToggleWillCollapse = nextTreeToggleAction === 'collapse'
  const treeToggleLabel = treeToggleWillCollapse ? 'Collapse all folders' : 'Expand all folders'
  const {
    updateBusy,
    updateTask,
    updateHint,
    updateErrorLog,
    hasPendingUpdate,
    pendingUpdateVersion,
    updateDownloaded,
    updateDownloadPct,
    showUpdateToast,
    onCheckUpdates,
    onUpdateNow,
    onRestartToUpdate,
    onUpdateLater,
  } = useAppUpdater()

  const primaryGlobalSqlSettings = useMemo<GlobalSqlConnectionSettings | null>(
    () => getPrimaryGlobalSqlSettings(globalSqlConnections),
    [globalSqlConnections],
  )
  const sidebarToolExtensions = useMemo(() => buildSidebarToolExtensions(), [])
  const settingsTabExtensions = useMemo(() => buildSettingsTabExtensions(), [])
  const activeSettingsTabExtension = useMemo(
    () => settingsTabExtensions.find(tab => tab.id === settingsTab) ?? null,
    [settingsTab, settingsTabExtensions],
  )

  useEffect(() => {
    if (!settingsTabExtensions.some(tab => tab.id === settingsTab)) {
      setSettingsTab(settingsTabExtensions[0]?.id ?? 'general')
    }
  }, [settingsTab, settingsTabExtensions])

  function refreshCacheSize() {
    setCacheSizeBytes(getLocalStorageCacheSizeBytes())
  }

  useEffect(() => {
    if (settingsTab !== 'general') return
    refreshCacheSize()
  }, [settingsTab])

  function toggleDrawer(drawerId: string) {
    setOpenDrawerId(prev => (prev === drawerId ? null : drawerId))
  }

  function closeDrawer() {
    setOpenDrawerId(null)
  }

  function openSettings() {
    const defaultTabId = settingsTabExtensions.find(tab => tab.id === 'general')?.id ?? settingsTabExtensions[0]?.id ?? 'general'
    setSettingsTab(defaultTabId)
    if (defaultTabId === 'general') refreshCacheSize()
    settingsDialogRef.current?.showModal()
    requestAnimationFrame(() => {
      const activeTabButton = settingsTabsRef.current?.querySelector('button.tabActive') as HTMLButtonElement | null
      activeTabButton?.focus()
    })
  }

  function closeSettings() {
    settingsDialogRef.current?.close()
  }

  function clearAppCache() {
    for (const key of APP_CACHE_KEYS) {
      localStorage.removeItem(key)
    }
    setHistoryByRequestId({})
    setResponseTabByRequest({})
    setTreeSortMode('none')
    setApplyDraftState(null)
    swaggerUiBaseCacheRef.current = {}
    swaggerOperationCacheRef.current = {}
    refreshCacheSize()
  }

  function updateGlobalSqlConnection(connectionId: string, updater: (prev: GlobalSqlConnectionItem) => GlobalSqlConnectionItem) {
    setGlobalSqlConnections(prev => updateGlobalSqlConnectionItem(prev, connectionId, updater))
  }

  function addGlobalSqlConnection() {
    setGlobalSqlConnections(prev => addGlobalSqlConnectionItem(prev, uid))
  }

  function deleteGlobalSqlConnection(connectionId: string) {
    setGlobalSqlConnections(prev => removeGlobalSqlConnectionItem(prev, connectionId))
    setSqlConnUrlInputById(prev => {
      if (!(connectionId in prev)) return prev
      const next = { ...prev }
      delete next[connectionId]
      return next
    })
    setSqlConnTestById(prev => {
      if (!(connectionId in prev)) return prev
      const next = { ...prev }
      delete next[connectionId]
      return next
    })
    const t = sqlConnTestTimerByIdRef.current[connectionId]
    if (typeof t === 'number') {
      window.clearTimeout(t)
      delete sqlConnTestTimerByIdRef.current[connectionId]
    }
    if (sqlConnTypeMenuOpenId === connectionId) setSqlConnTypeMenuOpenId(null)
    if (sqlConnSslMenuOpenId === connectionId) setSqlConnSslMenuOpenId(null)
    if (sqlConnDeleteArmedId === connectionId) setSqlConnDeleteArmedId(null)
  }

  function setConnectionTypeAndMaybeDefaultPort(connectionId: string, nextType: DbType) {
    updateGlobalSqlConnection(connectionId, prev => setConnectionTypeAndMaybeDefaultPortItem(prev, nextType))
  }

  function onSqlConnectionDeleteClick(connectionId: string) {
    if (sqlConnDeleteArmedId === connectionId) {
      if (sqlConnDeleteArmTimerRef.current) {
        window.clearTimeout(sqlConnDeleteArmTimerRef.current)
        sqlConnDeleteArmTimerRef.current = null
      }
      setSqlConnDeleteArmedId(null)
      deleteGlobalSqlConnection(connectionId)
      return
    }
    setSqlConnDeleteArmedId(connectionId)
    if (sqlConnDeleteArmTimerRef.current) window.clearTimeout(sqlConnDeleteArmTimerRef.current)
    sqlConnDeleteArmTimerRef.current = window.setTimeout(() => {
      setSqlConnDeleteArmedId(prev => (prev === connectionId ? null : prev))
      sqlConnDeleteArmTimerRef.current = null
    }, 5500)
  }

  async function testSqlConnection(connectionId: string) {
    const conn = globalSqlConnections.find(x => x.id === connectionId)
    if (!conn) return

    setSqlConnTestById(prev => ({ ...prev, [connectionId]: { inFlight: false, error: null, log: null, okMs: null } }))
    const t = sqlConnTestTimerByIdRef.current[connectionId]
    if (typeof t === 'number') {
      window.clearTimeout(t)
      delete sqlConnTestTimerByIdRef.current[connectionId]
    }

    const connectionString = buildDbConnectionString(conn).trim()
    if (!connectionString) {
      setSqlConnTestById(prev => ({ ...prev, [connectionId]: { inFlight: false, error: 'Connection failed', log: 'Fill host/port/database/user/password to build connection string.', okMs: null } }))
      return
    }

    setSqlConnTestById(prev => ({ ...prev, [connectionId]: { inFlight: true, error: null, log: null, okMs: null } }))
    try {
      const { ok, message, durationMs } = await runDbConnectionTest({ type: conn.type, connectionString })
      if (ok) {
        setSqlConnTestById(prev => ({ ...prev, [connectionId]: { inFlight: false, error: null, log: null, okMs: durationMs } }))
        sqlConnTestTimerByIdRef.current[connectionId] = window.setTimeout(() => {
          setSqlConnTestById(prev => ({ ...prev, [connectionId]: { ...(prev[connectionId] ?? { inFlight: false, error: null, log: null, okMs: null }), okMs: null } }))
          delete sqlConnTestTimerByIdRef.current[connectionId]
        }, 2500)
      } else {
        setSqlConnTestById(prev => ({ ...prev, [connectionId]: { inFlight: false, error: 'Connection failed', log: message || null, okMs: null } }))
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error'
      setSqlConnTestById(prev => ({ ...prev, [connectionId]: { inFlight: false, error: 'Connection failed', log: message, okMs: null } }))
    }
  }

  async function addCaCertificatesFromInput() {
    setCaCertError(null)
    const blocks = extractPemCertificates(caCertInput)
    if (!blocks.length) {
      setCaCertError('Paste one or more PEM certificates (BEGIN CERTIFICATE / END CERTIFICATE).')
      return
    }

    setCaCertBusy(true)
    try {
      const existingBySha = new Set((caCertificates || []).map(c => (c.sha256 || '').toLowerCase()).filter(Boolean))
      const added: CaCertificate[] = []

      for (const pem of blocks) {
        let sha256 = ''
        try {
          sha256 = await sha256Hex(pemToDerBytes(pem))
        } catch (error) {
          logWarn('addCaCertificatesFromInput.sha256', 'Failed to compute certificate fingerprint', { error })
          sha256 = ''
        }
        if (sha256 && existingBySha.has(sha256.toLowerCase())) continue

        const base: CaCertificate = {
          id: uid(),
          pem,
          addedAt: Date.now(),
          ...(sha256 ? { sha256 } : {}),
        }

        try {
          const inspected = await tauriInvoke<{
            ok: boolean
            message?: string
            sha256?: string
            subject?: string
            issuer?: string
            notBefore?: string
            notAfter?: string
          }>('cert_inspect', { args: { pem } })

          if (inspected?.ok) {
            const next: CaCertificate = {
              ...base,
              ...(typeof inspected.sha256 === 'string' ? { sha256: inspected.sha256 } : null),
              ...(typeof inspected.subject === 'string' ? { subject: inspected.subject } : null),
              ...(typeof inspected.issuer === 'string' ? { issuer: inspected.issuer } : null),
              ...(typeof inspected.notBefore === 'string' ? { notBefore: inspected.notBefore } : null),
              ...(typeof inspected.notAfter === 'string' ? { notAfter: inspected.notAfter } : null),
            }
            added.push(next)
            if (next.sha256) existingBySha.add(next.sha256.toLowerCase())
            continue
          }
        } catch (error) {
          logError('addCaCertificatesFromInput.cert_inspect', error)
        }

        added.push(base)
        if (base.sha256) existingBySha.add(base.sha256.toLowerCase())
      }

      if (!added.length) {
        setCaCertError('No new certificates were added (duplicates or invalid input).')
        return
      }

      setCaCertificates(prev => [...(prev || []), ...added])
      setCaCertInput('')
    } finally {
      setCaCertBusy(false)
    }
  }

  function deleteCaCertificate(id: string) {
    setCaCertificates(prev => (prev || []).filter(c => c.id !== id))
  }

  useEffect(() => {
    saveAppSettings({
      requestTimeoutSec: requestTimeoutSec ?? 0,
      validateCertificates,
      caCertificates,
      globalSql: primaryGlobalSqlSettings ?? DEFAULT_GLOBAL_SQL_CONNECTION_SETTINGS,
      globalSqlConnections,
    })
  }, [caCertificates, globalSqlConnections, primaryGlobalSqlSettings, requestTimeoutSec, validateCertificates])

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(sqlConnTestTimerByIdRef.current)) {
        window.clearTimeout(timerId)
      }
      sqlConnTestTimerByIdRef.current = {}
      if (sqlConnDeleteArmTimerRef.current) {
        window.clearTimeout(sqlConnDeleteArmTimerRef.current)
        sqlConnDeleteArmTimerRef.current = null
      }
    }
  }, [])

  useDismissibleLayer({
    open: !!sqlConnTypeMenuOpenId,
    onDismiss: () => setSqlConnTypeMenuOpenId(null),
    isInsideTarget: target => {
      const el = target as HTMLElement | null
      return !!el?.closest(`[data-sql-type-wrap="${sqlConnTypeMenuOpenId}"]`)
    },
  })

  useDismissibleLayer({
    open: !!sqlConnSslMenuOpenId,
    onDismiss: () => setSqlConnSslMenuOpenId(null),
    isInsideTarget: target => {
      const el = target as HTMLElement | null
      return !!el?.closest(`[data-sql-ssl-wrap="${sqlConnSslMenuOpenId}"]`)
    },
  })

  useDismissibleLayer({
    open: !!sqlConnDeleteArmedId,
    onDismiss: () => {
      setSqlConnDeleteArmedId(null)
      if (sqlConnDeleteArmTimerRef.current) {
        window.clearTimeout(sqlConnDeleteArmTimerRef.current)
        sqlConnDeleteArmTimerRef.current = null
      }
    },
    isInsideTarget: target => {
      const el = target as HTMLElement | null
      return !!el?.closest(`[data-sql-delete-btn="${sqlConnDeleteArmedId}"]`)
    },
    capturePointerDown: true,
  })

  useEffect(() => {
    void (async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app')
        setAppVersion(await getVersion())
      } catch (error) {
        logError('App.getVersion', error)
        setAppVersion(null)
      }
    })()
  }, [])

  useEffect(() => {
    let cancelled = false
    let idleHandle: number | null = null
    let timeoutHandle: number | null = null

    const hydrateHistory = () => {
      if (cancelled) return
      const loaded = loadRequestHistoryByRequestId()
      setHistoryByRequestId(prev => {
        if (!Object.keys(prev).length) return loaded
        const next: Record<string, RequestHistoryItem[]> = { ...loaded }
        for (const [requestId, currentItems] of Object.entries(prev)) {
          const loadedItems = next[requestId] ?? []
          const merged = mergeHistoryItemsById(currentItems, loadedItems)
          if (merged.length) next[requestId] = merged
          else delete next[requestId]
        }
        return next
      })
    }

    const windowWithIdle = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    const requestIdle = windowWithIdle.requestIdleCallback
    if (typeof requestIdle === 'function') {
      idleHandle = requestIdle(hydrateHistory, { timeout: 1200 })
    } else {
      timeoutHandle = window.setTimeout(hydrateHistory, 0)
    }

    return () => {
      cancelled = true
      if (idleHandle !== null) {
        const cancelIdle = windowWithIdle.cancelIdleCallback
        if (typeof cancelIdle === 'function') cancelIdle(idleHandle)
      }
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle)
    }
  }, [])

  function onRequestSendStart(requestId: string) {
    setInFlightCountByRequestId(prev => ({ ...prev, [requestId]: (prev[requestId] ?? 0) + 1 }))
    setResultByRequestId(prev => ({ ...prev, [requestId]: null }))
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

  function onRequestResult(requestId: string, result: RunResult, runId: string) {
    setResultByRequestId(prev => ({ ...prev, [requestId]: result }))
    setHistoryByRequestId(prev => {
      const items = prev[requestId]
      if (!items?.length) return prev

      const idx = items.findIndex(item => item.runId === runId)
      if (idx < 0) return prev

      const current = items[idx]
      const nextItem: RequestHistoryItem = {
        ...current,
        responseStatus: result.status,
        responseStatusText: result.statusText,
      }
      const nextItems = [...items]
      nextItems[idx] = nextItem
      const next = { ...prev, [requestId]: nextItems }
      saveRequestHistoryByRequestId(next)
      return next
    })
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
  const activeVisit = useMemo<RecentRequestVisit | null>(() => {
    if (!active) return null
    return { collectionId: active.col.id, requestId: active.req.id }
  }, [active])
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
  const recentRequestTabs = useMemo<RecentRequestTabResolved[]>(
    () =>
      recentRequestVisits
        .map(visit => {
          const found = findRequestByIds(collections, visit.collectionId, visit.requestId)
          if (!found) return null
          return {
            key: `${visit.collectionId}:${visit.requestId}`,
            ...visit,
            collectionName: found.col.name || found.col.id,
            requestName: found.req.name || 'Untitled request',
            col: found.col,
            req: found.req,
          }
        })
        .filter((item): item is RecentRequestTabResolved => !!item),
    [collections, recentRequestVisits],
  )
  const previousRequestTab = recentRequestTabs[recentRequestTabs.length - 1] ?? null

  useEffect(() => {
    const prev = previousActiveVisitRef.current
    const current = activeVisit

    if (prev && (!current || prev.collectionId !== current.collectionId || prev.requestId !== current.requestId)) {
      setRecentRequestVisits(existing => {
        const withoutCurrent = existing.filter(item => !current || item.collectionId !== current.collectionId || item.requestId !== current.requestId)
        const withoutPrevDup = withoutCurrent.filter(item => item.collectionId !== prev.collectionId || item.requestId !== prev.requestId)
        return [...withoutPrevDup, prev].slice(-2)
      })
    }

    previousActiveVisitRef.current = current
  }, [activeVisit])

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
    const importedEnv = (col as unknown as { __rufEnvironment?: Environment }).__rufEnvironment

    setCollections(prev => {
      const next = [col, ...prev]
      saveCollections(next)
      return next
    })

    setEnvByCollection(prev => {
      if (prev[col.id]) return prev
      const seededBaseUrl = col.baseUrl && isAbsoluteUrl(col.baseUrl) ? col.baseUrl.trim() : ''
      const baseUrlKey = importedEnv?.baseUrlKey?.trim() || DEFAULT_ENVIRONMENT.baseUrlKey

      const seededVariables = {
        ...DEFAULT_ENVIRONMENT.variables,
        ...(col.variables ?? {}),
        ...(importedEnv?.variables ?? {}),
        [baseUrlKey]: seededBaseUrl || ((importedEnv?.variables ?? col.variables)?.[baseUrlKey] ?? ''),
      }
      const seededEnv: Environment = { baseUrlKey, variables: seededVariables, headers: DEFAULT_ENVIRONMENT.headers }
      const nextEnvs = { ...prev, [col.id]: seededEnv }
      saveEnvironmentsByCollection(nextEnvs)
      return nextEnvs
    }
    )
  }

  function isFileDrag(dt: DataTransfer | null) {
    if (!dt) return false
    return Array.from(dt.types).includes('Files')
  }

  function isSupportedImportFileName(name: string) {
    const lower = name.toLowerCase()
    return (
      lower.endsWith('.json') ||
      lower.endsWith('.yaml') ||
      lower.endsWith('.yml') ||
      lower.endsWith('.wsdl') ||
      lower.endsWith('.xml') ||
      lower.endsWith('.rufcollection') ||
      lower.endsWith('.ruf_collection')
    )
  }

  function fileBaseName(name: string) {
    return name.replace(/\\.[^/.]+$/u, '') || name
  }

  async function importDroppedFiles(files: FileList) {
    const list = Array.from(files)
    const supported = list.filter(f => isSupportedImportFileName(f.name))
    const file = supported[0]
    if (!file) return

    try {
      const text = await file.text()
      const imported = await buildImportedCollectionFromText({ text })
      const defaultName = (imported.name?.trim() || fileBaseName(file.name).trim() || 'Imported')
      importOpenRef.current?.openNameStep({ ...imported, name: defaultName, sourceType: 'file', sourceFileName: file.name })
    } catch (e: any) {
      alert(e?.message || `Failed to import dropped file: ${file.name}`)
    }
  }

  function onAppDragOver(e: DragEvent<HTMLDivElement>) {
    if (!isFileDrag(e.dataTransfer)) return
    e.preventDefault()
  }

  function onAppDrop(e: DragEvent<HTMLDivElement>) {
    if (!isFileDrag(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    void importDroppedFiles(e.dataTransfer.files)
  }

  async function updateCollectionFromUrl(collectionId: string) {
    const existingNow = collections.find(c => c.id === collectionId)
    const rawUrl = existingNow?.sourceUrl?.trim() || ''
    if (!existingNow || !rawUrl) return

    try {
      const u = new URL(rawUrl)
      const res = await platformFetch(u.toString(), undefined, { insecureTls: !validateCertificates, caCertsPem: caCertificates.map(c => c.pem) })
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

  function makeCopyName(name: string, existingNames: string[]): string {
    const base = `${name} (copy)`
    if (!existingNames.includes(base)) return base
    for (let i = 2; i < 10_000; i++) {
      const candidate = `${name} (copy ${i})`
      if (!existingNames.includes(candidate)) return candidate
    }
    return `${name} (copy ${Date.now()})`
  }

  function cloneBodyExample(example: any): any {
    try {
      if (typeof structuredClone === 'function') return structuredClone(example)
    } catch (error) {
      logWarn('cloneBodyExample.structuredClone', 'structuredClone failed, using JSON fallback', { error })
    }

    try {
      return JSON.parse(JSON.stringify(example))
    } catch (error) {
      logWarn('cloneBodyExample.jsonFallback', 'JSON deep clone failed, returning original value', { error })
      return example
    }
  }

  function cloneRequestWithNewId(req: RequestItem, name: string): RequestItem {
    return {
      ...req,
      id: uid('req'),
      name,
      params: Array.isArray(req.params) ? req.params.map(p => ({ ...p })) : [],
      headers: { ...(req.headers ?? {}) },
      body: req.body ? { ...req.body, example: cloneBodyExample(req.body.example) } : undefined,
    }
  }

  function cloneFolderDeep(folder: Folder, nameOverride?: string): Folder {
    return {
      id: uid('folder'),
      name: nameOverride ?? folder.name,
      requests: Array.isArray(folder.requests) ? folder.requests.map(r => cloneRequestWithNewId(r, r.name)) : [],
      ...(Array.isArray(folder.folders) ? { folders: folder.folders.map(f => cloneFolderDeep(f)) } : {}),
    }
  }

  function cloneCollectionDeep(collection: Collection, nameOverride: string, idOverride?: string): Collection {
    return {
      id: idOverride ?? uid('col'),
      name: nameOverride,
      baseUrl: collection.baseUrl,
      variables: collection.variables ? { ...collection.variables } : undefined,
      requests: Array.isArray(collection.requests) ? collection.requests.map(r => cloneRequestWithNewId(r, r.name)) : undefined,
      folders: Array.isArray(collection.folders) ? collection.folders.map(f => cloneFolderDeep(f)) : [],
      // Intentionally drop sourceUrl/sourceType/sourceFileName so the duplicate is a standalone copy.
    }
  }

  function insertCollectionIdAfterInWorkspaceFolder(folder: WorkspaceFolder, afterCollectionId: string, newCollectionId: string): { folder: WorkspaceFolder, inserted: boolean } {
    const idx = folder.collectionIds.indexOf(afterCollectionId)
    if (idx >= 0) {
      const nextIds = [...folder.collectionIds.slice(0, idx + 1), newCollectionId, ...folder.collectionIds.slice(idx + 1)]
      return { folder: { ...folder, collectionIds: nextIds }, inserted: true }
    }

    const nested = Array.isArray(folder.folders) ? folder.folders : []
    if (!nested.length) return { folder, inserted: false }

    for (let i = 0; i < nested.length; i++) {
      const child = nested[i]
      const res = insertCollectionIdAfterInWorkspaceFolder(child, afterCollectionId, newCollectionId)
      if (!res.inserted) continue
      const nextFolders = [...nested.slice(0, i), res.folder, ...nested.slice(i + 1)]
      return { folder: { ...folder, folders: nextFolders }, inserted: true }
    }

    return { folder, inserted: false }
  }

  function duplicateCollection(collectionId: string) {
    const duplicatedId = uid('col')
    setCollections(prev => {
      const idx = prev.findIndex(c => c.id === collectionId)
      if (idx < 0) return prev

      const original = prev[idx]
      const nextName = makeCopyName(original.name, prev.map(c => c.name))
      const copy = cloneCollectionDeep(original, nextName, duplicatedId)
      const next = [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)]
      saveCollections(next)
      return next
    })

    setWorkspace(prev => {
      let inserted = false
      const nextFolders = prev.folders.map(f => {
        if (inserted) return f
        const res = insertCollectionIdAfterInWorkspaceFolder(f, collectionId, duplicatedId)
        if (res.inserted) inserted = true
        return res.folder
      })

      if (!inserted) return prev
      const next: Workspace = { ...prev, folders: nextFolders }
      saveWorkspace(next)
      return next
    })
  }

  function duplicateFolder(collectionId: string, folderId: string) {
    setCollections(prev => {
      let didChange = false

      function duplicateInFolders(folders: Folder[]): { folders: Folder[], duplicated: boolean } {
        for (let i = 0; i < folders.length; i++) {
          const f = folders[i]
          if (f.id === folderId) {
            const siblingNames = folders.map(x => x.name)
            const nextName = makeCopyName(f.name, siblingNames)
            const copy = cloneFolderDeep(f, nextName)
            return { folders: [...folders.slice(0, i + 1), copy, ...folders.slice(i + 1)], duplicated: true }
          }

          const nested = Array.isArray(f.folders) ? f.folders : []
          if (!nested.length) continue
          const child = duplicateInFolders(nested)
          if (!child.duplicated) continue
          return { folders: [...folders.slice(0, i), { ...f, folders: child.folders }, ...folders.slice(i + 1)], duplicated: true }
        }
        return { folders, duplicated: false }
      }

      const next = prev.map(c => {
        if (c.id !== collectionId) return c
        const res = duplicateInFolders(c.folders)
        if (!res.duplicated) return c
        didChange = true
        return { ...c, folders: res.folders }
      })

      if (!didChange) return prev
      saveCollections(next)
      return next
    })
  }

  function duplicateRequest(collectionId: string, requestId: string) {
    setCollections(prev => {
      let didChange = false

      function duplicateInFolders(folders: Folder[]): { folders: Folder[], duplicated: boolean } {
        for (let i = 0; i < folders.length; i++) {
          const f = folders[i]
          const reqs = Array.isArray(f.requests) ? f.requests : []
          const idx = reqs.findIndex(r => r.id === requestId)
          if (idx >= 0) {
            const nextName = makeCopyName(reqs[idx].name, reqs.map(r => r.name))
            const copy = cloneRequestWithNewId(reqs[idx], nextName)
            const nextReqs = [...reqs.slice(0, idx + 1), copy, ...reqs.slice(idx + 1)]
            return { folders: [...folders.slice(0, i), { ...f, requests: nextReqs }, ...folders.slice(i + 1)], duplicated: true }
          }

          const nested = Array.isArray(f.folders) ? f.folders : []
          if (!nested.length) continue
          const child = duplicateInFolders(nested)
          if (!child.duplicated) continue
          return { folders: [...folders.slice(0, i), { ...f, folders: child.folders }, ...folders.slice(i + 1)], duplicated: true }
        }
        return { folders, duplicated: false }
      }

      const next = prev.map(c => {
        if (c.id !== collectionId) return c

        const directReqs = Array.isArray(c.requests) ? c.requests : null
        if (directReqs) {
          const idx = directReqs.findIndex(r => r.id === requestId)
          if (idx >= 0) {
            didChange = true
            const nextName = makeCopyName(directReqs[idx].name, directReqs.map(r => r.name))
            const copy = cloneRequestWithNewId(directReqs[idx], nextName)
            const nextReqs = [...directReqs.slice(0, idx + 1), copy, ...directReqs.slice(idx + 1)]
            return { ...c, requests: nextReqs }
          }
        }

        const res = duplicateInFolders(c.folders)
        if (!res.duplicated) return c
        didChange = true
        return { ...c, folders: res.folders }
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

  function addFolderToCollectionWithName(collectionId: string, name: string) {
    const nextName = name.trim()
    if (!nextName) return
    const folder = { id: uid('folder'), name: nextName, requests: [], folders: [] }
    setCollections(prev => {
      const next = prev.map(c => (c.id === collectionId ? { ...c, folders: [folder, ...c.folders] } : c))
      saveCollections(next)
      return next
    })
  }

  function openCreateCollectionSubfolderDialog(collectionId: string, parentFolderId: string | null) {
    setCollectionSubfolderError(null)
    setCollectionSubfolderName('New Folder')
    setCollectionSubfolderTarget({ collectionId, parentFolderId })
    createCollectionSubfolderDialogRef.current?.showModal()
    requestAnimationFrame(() => {
      const input = createCollectionSubfolderInputRef.current
      if (!input) return
      input.focus()
      input.select()
    })
  }

  function addFolderToCollection(collectionId: string) {
    openCreateCollectionSubfolderDialog(collectionId, null)
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

  function addFolderToFolderWithName(collectionId: string, parentFolderId: string, name: string) {
    const nextName = name.trim()
    if (!nextName) return
    const newFolder = { id: uid('folder'), name: nextName, requests: [], folders: [] }
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

  function addFolderToFolder(collectionId: string, parentFolderId: string) {
    openCreateCollectionSubfolderDialog(collectionId, parentFolderId)
  }

  function closeCreateCollectionSubfolder() {
    createCollectionSubfolderDialogRef.current?.close()
  }

  function createCollectionSubfolder() {
    setCollectionSubfolderError(null)
    const target = collectionSubfolderTarget
    if (!target) return
    const name = collectionSubfolderName.trim()
    if (!name) {
      setCollectionSubfolderError('Enter a folder name.')
      return
    }
    if (target.parentFolderId) addFolderToFolderWithName(target.collectionId, target.parentFolderId, name)
    else addFolderToCollectionWithName(target.collectionId, name)
    closeCreateCollectionSubfolder()
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

  function moveFolderToCollection(sourceCollectionId: string, folderId: string, targetCollectionId: string, targetParentFolderId: string | null) {
    if (sourceCollectionId === targetCollectionId) {
      moveFolder(sourceCollectionId, folderId, targetParentFolderId)
      return
    }

    setCollections(prev => {
      const source = prev.find(c => c.id === sourceCollectionId) ?? null
      const target = prev.find(c => c.id === targetCollectionId) ?? null
      if (!source || !target) return prev

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
          const child = nested.length ? removeFolder(nested) : { folders: nested, removed: null }
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

      function findRequestInFolder(folder: any, requestId: string): RequestItem | null {
        const reqs: RequestItem[] = Array.isArray(folder?.requests) ? folder.requests : []
        const found = reqs.find(r => r?.id === requestId) ?? null
        if (found) return found
        const nested = Array.isArray(folder?.folders) ? folder.folders : []
        for (const f of nested) {
          const inner = findRequestInFolder(f, requestId)
          if (inner) return inner
        }
        return null
      }

      const sourceRemoved = removeFolder(source.folders as any)
      const movedFolder = sourceRemoved.removed
      if (!movedFolder) return prev

      let nextTargetFolders: any[]
      if (!targetParentFolderId) {
        nextTargetFolders = [...(target.folders as any), movedFolder]
      } else {
        const inserted = insertFolder(target.folders as any, targetParentFolderId, movedFolder)
        nextTargetFolders = inserted.inserted ? inserted.folders : [...(target.folders as any), movedFolder]
      }

      const updatedSource: Collection = { ...source, folders: sourceRemoved.folders }
      const updatedTarget: Collection = { ...target, folders: nextTargetFolders }

      const next = prev.map(c => {
        if (c.id === sourceCollectionId) return updatedSource
        if (c.id === targetCollectionId) return updatedTarget
        return c
      })

      saveCollections(next)

      if (active?.col.id === sourceCollectionId) {
        const activeReqId = active.req.id
        const movedActive = findRequestInFolder(movedFolder, activeReqId)
        if (movedActive) setActive({ col: updatedTarget, req: movedActive })
      }

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

  function moveRequestToCollection(sourceCollectionId: string, requestId: string, targetCollectionId: string, targetFolderId: string | null) {
    if (sourceCollectionId === targetCollectionId) {
      moveRequest(sourceCollectionId, requestId, targetFolderId)
      return
    }

    setCollections(prev => {
      const source = prev.find(c => c.id === sourceCollectionId) ?? null
      const target = prev.find(c => c.id === targetCollectionId) ?? null
      if (!source || !target) return prev

      let movedReq: RequestItem | null = null

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
            movedReq = reqs[idx] ?? movedReq
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

      const direct = source.requests ?? []
      const directIndex = direct.findIndex(r => r?.id === requestId)
      const directFound = directIndex >= 0 ? (direct[directIndex] ?? null) : null
      const folderFound = directFound ? null : findInFolders(source.folders as any)

      movedReq = directFound ?? folderFound?.req ?? null
      if (!movedReq) return prev

      const nextSourceDirect = directFound ? [...direct.slice(0, directIndex), ...direct.slice(directIndex + 1)] : direct
      let nextSourceFolders = source.folders as any
      if (!directFound) {
        const removed = removeFromFolders(source.folders as any)
        nextSourceFolders = removed.removed ? removed.folders : nextSourceFolders
      }

      let nextTargetDirect = target.requests ?? []
      let nextTargetFolders = target.folders as any

      if (!targetFolderId) {
        nextTargetDirect = [...nextTargetDirect, movedReq]
      } else {
        const inserted = insertIntoFolders(nextTargetFolders, targetFolderId, movedReq)
        nextTargetFolders = inserted.folders
        if (!inserted.inserted) nextTargetDirect = [...nextTargetDirect, movedReq]
      }

      const updatedSource: Collection = { ...source, requests: nextSourceDirect, folders: nextSourceFolders }
      const updatedTarget: Collection = { ...target, requests: nextTargetDirect, folders: nextTargetFolders }

      const next = prev.map(c => {
        if (c.id === sourceCollectionId) return updatedSource
        if (c.id === targetCollectionId) return updatedTarget
        return c
      })

      saveCollections(next)

      if (active?.req.id === requestId && active.col.id === sourceCollectionId) {
        setActive({ col: updatedTarget, req: movedReq })
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

  function openCreateWorkspaceFolder(parentFolderId: string | null = null) {
    setWorkspaceFolderError(null)
    setWorkspaceFolderName('New Folder')
    setWorkspaceFolderCreateParentId(parentFolderId)
    createWorkspaceFolderDialogRef.current?.showModal()
    requestAnimationFrame(() => {
      const input = createWorkspaceFolderInputRef.current
      if (!input) return
      input.focus()
      input.select()
    })
  }

  function closeCreateWorkspaceFolder() {
    createWorkspaceFolderDialogRef.current?.close()
  }

  function createWorkspaceFolder() {
    setWorkspaceFolderError(null)
    const base = workspaceFolderName.trim()
    if (!base) {
      setWorkspaceFolderError('Enter a folder name.')
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

      const newFolder: WorkspaceFolder = { id: uid('wfolder'), name, collectionIds: [], folders: [] }
      const parentId = workspaceFolderCreateParentId

      if (!parentId) {
        const next: Workspace = {
          ...prev,
          folders: [newFolder, ...prev.folders],
        }
        saveWorkspace(next)
        return next
      }

      function addToFolders(folders: WorkspaceFolder[]): { folders: WorkspaceFolder[], added: boolean } {
        let added = false
        const nextFolders = folders.map(f => {
          if (f.id === parentId) {
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

    closeCreateWorkspaceFolder()
  }

  function addWorkspaceFolderToFolder(parentFolderId: string) {
    openCreateWorkspaceFolder(parentFolderId)
  }

  function moveWorkspaceFolder(workspaceFolderId: string, targetParentWorkspaceFolderId: string | null) {
    setWorkspace(prev => {
      function findInFolders(folders: WorkspaceFolder[], id: string): WorkspaceFolder | null {
        for (const f of folders) {
          if (f.id === id) return f
          const nested = f.folders ?? []
          if (!nested.length) continue
          const found = findInFolders(nested, id)
          if (found) return found
        }
        return null
      }

      const moving = findInFolders(prev.folders, workspaceFolderId)
      if (!moving) return prev

      if (targetParentWorkspaceFolderId) {
        if (targetParentWorkspaceFolderId === workspaceFolderId) return prev
        const inSubtree = findInFolders(moving.folders ?? [], targetParentWorkspaceFolderId)
        if (inSubtree) return prev
      }

      function removeFromFolders(folders: WorkspaceFolder[]): { folders: WorkspaceFolder[], removed: WorkspaceFolder | null, changed: boolean } {
        let removed: WorkspaceFolder | null = null
        let changed = false
        const nextFolders: WorkspaceFolder[] = []

        for (const f of folders) {
          if (f.id === workspaceFolderId) {
            removed = f
            changed = true
            continue
          }

          const nested = f.folders ?? []
          if (!nested.length) {
            nextFolders.push(f)
            continue
          }

          const childRes = removeFromFolders(nested)
          if (!childRes.changed) {
            nextFolders.push(f)
            continue
          }

          changed = true
          nextFolders.push(childRes.folders.length ? { ...f, folders: childRes.folders } : { ...f, folders: undefined })
          if (childRes.removed) removed = childRes.removed
        }

        return { folders: nextFolders, removed, changed }
      }

      const removedRes = removeFromFolders(prev.folders)
      const movedFolder = removedRes.removed
      if (!removedRes.changed || !movedFolder) return prev
      const movedFolderSafe: WorkspaceFolder = movedFolder

      function insertIntoFolders(folders: WorkspaceFolder[]): { folders: WorkspaceFolder[], inserted: boolean } {
        if (!targetParentWorkspaceFolderId) return { folders: [movedFolderSafe, ...folders], inserted: true }

        let inserted = false
        const nextFolders = folders.map(f => {
          if (f.id === targetParentWorkspaceFolderId) {
            inserted = true
            const nested = f.folders ?? []
            return { ...f, folders: [movedFolderSafe, ...nested] }
          }
          const nested = f.folders ?? []
          if (!nested.length) return f
          const childRes = insertIntoFolders(nested)
          if (!childRes.inserted) return f
          inserted = true
          return { ...f, folders: childRes.folders }
        })

        return { folders: nextFolders, inserted }
      }

      const insertRes = insertIntoFolders(removedRes.folders)
      const nextFolders = insertRes.inserted ? insertRes.folders : [movedFolderSafe, ...removedRes.folders]
      const next: Workspace = { ...prev, folders: nextFolders }
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
    setProjectName('New Collection')
    createProjectDialogRef.current?.showModal()
    requestAnimationFrame(() => {
      const input = createProjectInputRef.current
      if (!input) return
      input.focus()
      const end = input.value.length
      input.setSelectionRange(end, end)
    })
  }

  function closeCreateProject() {
    createProjectDialogRef.current?.close()
  }

  function createProject() {
    setProjectError(null)
    const name = projectName.trim()
    if (!name) {
      setProjectError('Enter a collection name.')
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

  const isWorkspaceEmpty = collections.length === 0 && workspace.folders.length === 0

  async function withCurrentWindow(action: (windowHandle: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<void>
    close: () => Promise<void>
    startDragging: () => Promise<void>
  }) => Promise<void>) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await action(getCurrentWindow())
  }

  async function minimizeWindow() {
    try {
      await withCurrentWindow(windowHandle => windowHandle.minimize())
    } catch (error) {
      logError('minimizeWindow', error)
    }
  }

  async function toggleWindowMaximize() {
    try {
      await withCurrentWindow(windowHandle => windowHandle.toggleMaximize())
    } catch (error) {
      logError('toggleWindowMaximize', error)
    }
  }

  async function closeWindow() {
    try {
      await withCurrentWindow(windowHandle => windowHandle.close())
    } catch (error) {
      logError('closeWindow', error)
    }
  }

  async function startWindowDragging() {
    try {
      await withCurrentWindow(windowHandle => windowHandle.startDragging())
    } catch (error) {
      logError('startWindowDragging', error)
    }
  }

  function onWindowTitlebarMouseDown(e: ReactMouseEvent<HTMLElement>) {
    if (e.button !== 0) return
    const target = e.target as HTMLElement | null
    if (!target) return
    if (target.closest('button, input, textarea, select, a, [role="button"], [data-no-window-drag]')) return
    void startWindowDragging()
  }

  const activeRequestName = active?.req.name ?? ''
  const activeRequestDescription = (active?.req.description ?? '').trim()
  const windowRequestText = activeRequestDescription
    ? `${activeRequestName} · ${activeRequestDescription}`
    : activeRequestName
  const activeSwaggerContext = useMemo<SwaggerContext | null>(() => {
    if (!active) return null
    if (active.col.sourceType !== 'url') return null
    const sourceUrl = (active.col.sourceUrl || '').trim()
    if (!sourceUrl || !isAbsoluteUrl(sourceUrl)) return null
    if (active.col.importFormat !== 'openapi' && !isLikelyOpenApiSourceUrl(sourceUrl)) return null

    const env = envByCollection[active.col.id] ?? DEFAULT_ENVIRONMENT
    const baseUrlKey = (env.baseUrlKey || DEFAULT_ENVIRONMENT.baseUrlKey).trim() || DEFAULT_ENVIRONMENT.baseUrlKey
    const serviceBaseUrl = (env.variables?.[baseUrlKey] ?? '').trim()
    const path = (active.req.path || '').trim()
    const method = (active.req.method || 'get').trim().toLowerCase()
    const fallbackTag = getSwaggerTagFromPath(path)
    const fromPath = toPathLikeOperationIdGuess(path)
    const fallbackOperationId = fromPath || toSwaggerOperationIdGuess(active.req.name || '', method, path)
    return { sourceUrl, serviceBaseUrl, method, path, fallbackTag, fallbackOperationId }
  }, [active, envByCollection])
  const swaggerUiBaseCacheRef = useRef<Record<string, string>>({})
  const swaggerOperationCacheRef = useRef<Record<string, { tag: string; operationId: string }>>({})
  const caCertificatesPem = useMemo(() => caCertificates.map(c => c.pem), [caCertificates])

  async function detectSwaggerUiBase(candidates: string[], requestTimeoutMs = 2500) {
    for (const candidate of candidates) {
      try {
        const res = await platformFetch(candidate, undefined, {
          insecureTls: !validateCertificates,
          caCertsPem: caCertificatesPem,
          timeoutMs: requestTimeoutMs,
        })
        if (!res.ok) continue
        const contentType = (res.headers.get('content-type') || '').toLowerCase()
        if (contentType.includes('text/html')) return candidate
        const body = await res.text()
        if (isLikelySwaggerUiHtml(body)) return candidate
      } catch {
        // try next
      }
    }
    return null
  }

  async function resolveOperationIdFromSource(args: { sourceUrl: string; method: string; path: string }) {
    try {
      const res = await platformFetch(args.sourceUrl, undefined, { insecureTls: !validateCertificates, caCertsPem: caCertificatesPem })
      if (!res.ok) return null
      const text = await res.text()
      const parsed = parseJsonOrYaml(text)
      const pathsObj = (parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).paths : null) as Record<string, unknown> | null
      if (!pathsObj || typeof pathsObj !== 'object') return null

      const methodKey = args.method.toLowerCase()
      const exact = pathsObj[args.path] ?? pathsObj[(args.path.startsWith('/') ? args.path : `/${args.path}`)]
      const normalizedTarget = normalizePathTemplate(args.path)

      const candidates: unknown[] = []
      if (exact) candidates.push(exact)
      for (const [k, v] of Object.entries(pathsObj)) {
        if (normalizePathTemplate(k) === normalizedTarget) candidates.push(v)
      }

      for (const item of candidates) {
        if (!item || typeof item !== 'object') continue
        const op = (item as Record<string, unknown>)[methodKey]
        if (!op || typeof op !== 'object') continue
        const opObj = op as Record<string, unknown>
        const operationId = typeof opObj.operationId === 'string' ? opObj.operationId.trim() : ''
        const tagFromSpec = Array.isArray(opObj.tags) ? String(opObj.tags[0] ?? '').trim() : ''
        if (operationId) {
          return { operationId, tag: tagFromSpec || getSwaggerTagFromPath(args.path) }
        }
      }
    } catch (error) {
      logWarn('resolveOperationIdFromSource', 'Failed to resolve operationId from source spec', { error, url: args.sourceUrl })
    }
    return null
  }

  async function getCachedOrResolvedSwaggerOperation(args: {
    cacheKey: string
    sourceUrl: string
    method: string
    path: string
    timeoutMs?: number
  }) {
    const cached = swaggerOperationCacheRef.current[args.cacheKey]
    if (cached) return cached
    const resolverPromise = resolveOperationIdFromSource({
      sourceUrl: args.sourceUrl,
      method: args.method,
      path: args.path,
    })
    const resolved = typeof args.timeoutMs === 'number'
      ? await withTimeout(resolverPromise, args.timeoutMs)
      : await resolverPromise
    if (!resolved?.operationId) return null
    const entry = { tag: resolved.tag, operationId: resolved.operationId }
    swaggerOperationCacheRef.current[args.cacheKey] = entry
    return entry
  }

  async function openActiveRequestSwagger() {
    const ctx = activeSwaggerContext
    if (!ctx) return

    const baseCandidates = buildSwaggerUiBaseCandidates({
      sourceUrl: ctx.sourceUrl,
      serviceBaseUrl: ctx.serviceBaseUrl,
    })
    const cachedBase = swaggerUiBaseCacheRef.current[ctx.sourceUrl]
    const quickDetectedBasePromise = cachedBase || baseCandidates.length <= 1
      ? Promise.resolve<string | null>(null)
      : withTimeout(detectSwaggerUiBase(baseCandidates, 450), 900)
    const opCacheKey = buildSwaggerOpCacheKey(ctx)
    const cachedOperation = swaggerOperationCacheRef.current[opCacheKey]
    const resolvedOperationPromise = getCachedOrResolvedSwaggerOperation({
      cacheKey: opCacheKey,
      sourceUrl: ctx.sourceUrl,
      method: ctx.method,
      path: ctx.path,
      timeoutMs: cachedOperation ? undefined : 1200,
    })
    const [quickDetectedBase, resolvedOperation] = await Promise.all([
      quickDetectedBasePromise,
      resolvedOperationPromise,
    ])
    if (quickDetectedBase) swaggerUiBaseCacheRef.current[ctx.sourceUrl] = quickDetectedBase
    const swaggerUiBase = cachedBase || quickDetectedBase || baseCandidates[0] || ctx.sourceUrl
    const initialTag = resolvedOperation?.tag || ctx.fallbackTag
    const initialOperationId = resolvedOperation?.operationId || ctx.fallbackOperationId
    const finalUrl = buildSwaggerUiUrl({ swaggerUiBase, tag: initialTag, operationId: initialOperationId })

    try {
      await tauriInvoke<void>('system_open_url', { args: { url: finalUrl } })
    } catch (error) {
      logError('openActiveRequestSwagger', error, { url: finalUrl })
      try {
        window.open(finalUrl, '_blank', 'noopener,noreferrer')
      } catch (fallbackError) {
        logError('openActiveRequestSwagger.fallback', fallbackError, { url: finalUrl })
      }
    }

    void (async () => {
      if (!cachedBase && !quickDetectedBase && baseCandidates.length > 1) {
        const detected = await detectSwaggerUiBase(baseCandidates)
        if (detected) swaggerUiBaseCacheRef.current[ctx.sourceUrl] = detected
      }
      if (!cachedOperation) {
        void getCachedOrResolvedSwaggerOperation({
          cacheKey: opCacheKey,
          sourceUrl: ctx.sourceUrl,
          method: ctx.method,
          path: ctx.path,
        })
      }
    })()
  }

  async function openCollectionSwagger(collectionId: string) {
    const collection = collections.find(c => c.id === collectionId)
    if (!collection || collection.sourceType !== 'url') return
    const sourceUrl = (collection.sourceUrl || '').trim()
    if (!sourceUrl || !isAbsoluteUrl(sourceUrl)) return
    if (collection.importFormat !== 'openapi' && !isLikelyOpenApiSourceUrl(sourceUrl)) return

    const env = envByCollection[collection.id] ?? DEFAULT_ENVIRONMENT
    const baseUrlKey = (env.baseUrlKey || DEFAULT_ENVIRONMENT.baseUrlKey).trim() || DEFAULT_ENVIRONMENT.baseUrlKey
    const serviceBaseUrl = (env.variables?.[baseUrlKey] ?? '').trim()

    const baseCandidates = buildSwaggerUiBaseCandidates({ sourceUrl, serviceBaseUrl })
    const cachedBase = swaggerUiBaseCacheRef.current[sourceUrl]
    const quickDetectedBase = cachedBase || baseCandidates.length <= 1
      ? null
      : await withTimeout(detectSwaggerUiBase(baseCandidates, 450), 900)
    if (quickDetectedBase) swaggerUiBaseCacheRef.current[sourceUrl] = quickDetectedBase
    const swaggerUiBase = cachedBase || quickDetectedBase || baseCandidates[0] || sourceUrl

    try {
      await tauriInvoke<void>('system_open_url', { args: { url: swaggerUiBase } })
    } catch (error) {
      logError('openCollectionSwagger', error, { url: swaggerUiBase, collectionId })
      try {
        window.open(swaggerUiBase, '_blank', 'noopener,noreferrer')
      } catch (fallbackError) {
        logError('openCollectionSwagger.fallback', fallbackError, { url: swaggerUiBase, collectionId })
      }
    }

    if (!cachedBase && !quickDetectedBase && baseCandidates.length > 1) {
      void (async () => {
        const detected = await detectSwaggerUiBase(baseCandidates)
        if (detected) swaggerUiBaseCacheRef.current[sourceUrl] = detected
      })()
    }
  }
  const windowControls = (
    <div className="windowControls">
      <button
        type="button"
        className="windowControlBtn windowControlBtnMinimize"
        onClick={() => { void minimizeWindow() }}
        aria-label="Minimize window"
        title="Minimize"
      >
        <MinimizeIcon size={14} />
      </button>
      <button
        type="button"
        className="windowControlBtn windowControlBtnMaximize"
        onClick={() => { void toggleWindowMaximize() }}
        aria-label="Toggle maximize window"
        title="Maximize / Restore"
      >
        <MaximizeIcon size={12} />
      </button>
      <button
        type="button"
        className="windowControlBtn windowControlBtnClose"
        onClick={() => { void closeWindow() }}
        aria-label="Close window"
        title="Close"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  )

  return (
    <div className="windowShell">
      <header className="windowTitlebar" data-tauri-drag-region onMouseDown={onWindowTitlebarMouseDown}>
        <div className="windowBrandArea">
          <div className="sidebarBrandRow">
            <span className="appTitle">Ruf</span>
            <SidebarCreateMenu
              onImport={() => importOpenRef.current?.openMenu()}
              onCreateCollection={openCreateProject}
              onCreateFolder={openCreateWorkspaceFolder}
            />
            <ImportFab onImported={addCollection} openRef={importOpenRef} showTrigger={false} />
            {recentRequestTabs.length ? (
              <div className="windowRecentTabs" data-no-window-drag>
                {recentRequestTabs.map(tab => (
                  <button
                    key={tab.key}
                    type="button"
                    className="windowRecentTab"
                    title={`${tab.requestName} · ${tab.collectionName}`}
                    onClick={() => pick(tab.req, tab.col)}
                  >
                    {tab.requestName}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="windowRequestCenter" data-no-window-drag tabIndex={0}>
          <button
            type="button"
            className="windowBackBtn"
            onClick={() => {
              if (!previousRequestTab) return
              pick(previousRequestTab.req, previousRequestTab.col)
            }}
            disabled={!previousRequestTab}
            aria-label="Back to previous request"
            title={previousRequestTab ? `Back: ${previousRequestTab.requestName}` : 'No previous request'}
          >
            ←
          </button>
          <div className="windowRequestName" title={windowRequestText}>
            {windowRequestText}
          </div>
          {activeSwaggerContext ? (
            <button
              type="button"
              className="windowSwaggerBtn"
              onClick={() => { void openActiveRequestSwagger() }}
              aria-label="Open Swagger for current request"
              title="Open Swagger for this endpoint"
            >
              Swagger
            </button>
          ) : null}
        </div>
        {!isMac ? windowControls : null}
      </header>
      <div
        className="layout"
        style={{ gridTemplateColumns: `${sidebarWidth}px 8px 1fr` }}
        onDragOver={onAppDragOver}
        onDrop={onAppDrop}
      >
        <aside className="sidebar">
          <div className="sidebarTreeWrap">
            {isWorkspaceEmpty ? (
              <div className="sidebarEmptyState">
                <SidebarCreateMenu
                  onImport={() => importOpenRef.current?.openMenu()}
                  onCreateCollection={openCreateProject}
                  onCreateFolder={openCreateWorkspaceFolder}
                  triggerLabel="Add"
                  triggerClassName="sidebarAddBtn"
                  wrapClassName="sidebarAddWrap"
                />
              </div>
            ) : (
              <WorkspaceTree
                workspace={workspace}
                collections={collections}
                sortMode={treeSortMode}
                environmentsByCollection={envByCollection}
                activeRequestId={activeRequestId}
                inFlightCountByRequestId={inFlightCountByRequestId}
                treeOpenCommand={treeOpenCommand}
                onTreeAllExpandedChange={setTreeAllExpanded}
                onPickRequest={pick}
                onOpenEnv={setEnvModalCollectionId}
                onUpdateCollectionFromUrl={updateCollectionFromUrl}
                onOpenCollectionSwagger={openCollectionSwagger}
                onReloadCollectionFromFile={openReloadFromFile}
                onAddRequest={addRequestToCollection}
                onAddFolder={addFolderToCollection}
                onAddRequestToFolder={addRequestToFolder}
                onAddFolderToFolder={addFolderToFolder}
                onRenameCollection={renameCollection}
                onRenameFolder={renameFolder}
                onRenameRequest={renameRequest}
                onDuplicateCollection={duplicateCollection}
                onDuplicateFolder={duplicateFolder}
                onDuplicateRequest={duplicateRequest}
                onMoveFolder={moveFolder}
                onMoveRequest={moveRequest}
                onMoveFolderToCollection={moveFolderToCollection}
                onMoveRequestToCollection={moveRequestToCollection}
                onDeleteFolder={deleteFolder}
                onDeleteRequest={deleteRequest}
                onDeleteCollection={requestDeleteCollection}
                onMoveCollectionToWorkspaceFolder={moveCollectionToWorkspaceFolder}
                onMoveWorkspaceFolder={moveWorkspaceFolder}
                onAddWorkspaceFolderToFolder={addWorkspaceFolderToFolder}
                onRenameWorkspaceFolder={renameWorkspaceFolder}
                onDeleteWorkspaceFolder={deleteWorkspaceFolder}
              />
            )}
          </div>

        <div className="sidebarBottom">
          <div className="sidebarBottomLeft">
            <button
              className="iconBtn settingsBtn"
              onClick={openSettings}
              aria-label="Settings"
              title="Settings"
            >
              <span className="iconGlyph">&#9881;</span>
            </button>
            {sidebarToolExtensions.map(tool => (
              <button
                key={tool.id}
                className={`iconBtn ${tool.buttonClassName ?? ''}`.trim()}
                onClick={() => toggleDrawer(tool.id)}
                aria-label={tool.label}
                title={tool.title}
                aria-pressed={openDrawerId === tool.id}
              >
                {tool.icon}
              </button>
            ))}
            <button
              className="iconBtn treeToggleBtn"
              onClick={() => {
                treeCommandNonceRef.current += 1
                setTreeAllExpanded(nextTreeToggleAction === 'expand')
                setTreeOpenCommand({ action: nextTreeToggleAction, nonce: treeCommandNonceRef.current })
              }}
              aria-label={treeToggleLabel}
              title={treeToggleLabel}
            >
              <span className="iconGlyph">
                {treeToggleWillCollapse ? <FoldersCollapseIcon size={16} /> : <FoldersExpandIcon size={16} />}
              </span>
            </button>
            <button
              className="iconBtn treeSortBtn"
              onClick={() => {
                setTreeSortMode(prev => {
                  const next = prev === 'none' ? 'asc' : prev === 'asc' ? 'desc' : 'none'
                  saveTreeSortMode(next)
                  return next
                })
              }}
              aria-label={treeSortMode === 'none' ? 'Sort folders and requests (A-Z)' : treeSortMode === 'asc' ? 'Sort folders and requests (Z-A)' : 'Turn off alphabetical sort'}
              title={treeSortMode === 'none' ? 'Sort A-Z' : treeSortMode === 'asc' ? 'Sort Z-A' : 'Sort off'}
            >
              <span className="iconGlyph" style={{ opacity: treeSortMode === 'none' ? 0.75 : 1 }}>
                {treeSortMode === 'none'
                  ? <SortNeutralIcon size={16} />
                  : treeSortMode === 'asc'
                    ? <SortAscIcon size={16} />
                    : <SortDescIcon size={16} />}
              </span>
            </button>
          </div>
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
          <b><span className="appTitle">Ruf</span> <span className="small">(desktop)</span></b>
          <span className="small">OpenAPI v2/v3 import + collections</span>
          <span className="small" style={{marginLeft:'auto'}}>
            Desktop mode: no CORS limitations
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
                    globalSqlConnections={globalSqlConnections}
                    collection={active.col}
                    request={active.req}
                    inFlightCount={inFlightCountByRequestId[active.req.id] ?? 0}
                    onBeforeSend={(requestId, item) => onRequestBeforeSend(requestId, item)}
                    onSendStart={requestId => onRequestSendStart(requestId)}
                    onSendEnd={requestId => onRequestSendEnd(requestId)}
                    onResult={(requestId, result, runId) => onRequestResult(requestId, result, runId)}
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
          setProjectName('New Collection')
        }}
      >
        <div className="modalHeader">
          <b>Create Collection</b>
          <button className="iconBtn headerDeleteBtn importCloseBtn" onClick={closeCreateProject} aria-label="Close" title="Close">
            <CloseIcon size={18} />
          </button>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr', gap:10}}>
          <div className="small">Name</div>
          <input ref={createProjectInputRef} style={{ width: '100%' }} value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="New Collection" />
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
          setWorkspaceFolderCreateParentId(null)
        }}
      >
        <div className="modalHeader">
          <b>Create Folder</b>
          <button className="iconBtn headerDeleteBtn importCloseBtn" onClick={closeCreateWorkspaceFolder} aria-label="Close" title="Close">
            <CloseIcon size={18} />
          </button>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr', gap:10}}>
          <div className="small">Name</div>
          <input
            ref={createWorkspaceFolderInputRef}
            style={{ width: '100%' }}
            value={workspaceFolderName}
            onChange={e => setWorkspaceFolderName(e.target.value)}
            autoFocus
            placeholder="New Folder"
          />
        </div>

        {workspaceFolderError && <div className="small" style={{color:'#ff9a9a', marginTop: 8}}>{workspaceFolderError}</div>}

        <div className="modalActions">
          <button onClick={createWorkspaceFolder}>Create</button>
        </div>
      </dialog>

      <dialog
        ref={createCollectionSubfolderDialogRef}
        className="modal modalSmall"
        onClose={() => {
          setCollectionSubfolderError(null)
          setCollectionSubfolderName('New Folder')
          setCollectionSubfolderTarget(null)
        }}
      >
        <div className="modalHeader">
          <b>Create Folder</b>
          <button className="iconBtn headerDeleteBtn importCloseBtn" onClick={closeCreateCollectionSubfolder} aria-label="Close" title="Close">
            <CloseIcon size={18} />
          </button>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr', gap:10}}>
          <div className="small">Name</div>
          <input
            ref={createCollectionSubfolderInputRef}
            style={{ width: '100%' }}
            value={collectionSubfolderName}
            onChange={e => setCollectionSubfolderName(e.target.value)}
            autoFocus
            placeholder="New Folder"
          />
        </div>

        {collectionSubfolderError && <div className="small" style={{color:'#ff9a9a', marginTop: 8}}>{collectionSubfolderError}</div>}

        <div className="modalActions">
          <button onClick={createCollectionSubfolder}>Create</button>
        </div>
      </dialog>

      <dialog ref={confirmDeleteDialogRef} className="modal modalSmall" onClose={cancelDeleteCollection}>
        <div className="modalHeader">
          <b>Delete collection?</b>
        </div>

        <div className="small">
          {confirmDeleteName ? `Collection: ${confirmDeleteName}` : 'This collection will be deleted.'}
        </div>

        <div className="modalActions">
          <button onClick={cancelDeleteCollection}>Cancel</button>
          <button className="deleteBtn" onClick={confirmDeleteCollection}>Delete</button>
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
        className="modal modalSmall modalSettings"
        onClick={e => {
          if (e.target === e.currentTarget) closeSettings()
        }}
      >
        <div className="modalHeader" style={{ marginBottom: 0 }}>
          <b>Settings</b>
          <button className="iconBtn" onClick={closeSettings} aria-label="Close" title="Close"><CloseIcon size={18} /></button>
        </div>
        <hr className="modalDivider" />

        <div ref={settingsTabsRef} className="tabs" style={{ marginTop: 2, marginBottom: 12 }}>
          {settingsTabExtensions.map(tab => (
            <button key={tab.id} className={`tab ${settingsTab === tab.id ? 'tabActive' : ''}`} onClick={() => setSettingsTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>

        {activeSettingsTabExtension?.render ? activeSettingsTabExtension.render({ closeSettings, appVersion }) : null}

        {!activeSettingsTabExtension?.render && settingsTab === 'general' ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="formRow">
              <div className="formLabel">Request timeout (seconds)</div>
              <input
                className="mono"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={3}
                placeholder="30s"
                value={requestTimeoutSec === null ? '' : String(requestTimeoutSec)}
                onChange={e => {
                  const raw = e.target.value
                  const digits = raw.replaceAll(/\D+/g, '').slice(0, 3)
                  if (!digits) {
                    setRequestTimeoutSec(null)
                    return
                  }
                  const n = Number(digits)
                  setRequestTimeoutSec(Math.max(1, Math.min(600, Math.round(n))))
                }}
              />
            </div>
            <div className="formRow">
              <div className="formLabel">Application cache</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="button" onClick={clearAppCache} disabled={cacheSizeBytes <= 0}>Clear cache</button>
                <span className="small mono">{formatMegabytes(cacheSizeBytes)}</span>
              </div>
            </div>
          </div>
        ) : null}

        {!activeSettingsTabExtension?.render && settingsTab === 'certificates' ? (
          <div style={{ display: 'grid', gap: 10 }}>
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

            <details className="accordion" open>
              <summary>
                <span style={{ flex: 1 }}>CA certificates</span>
                <span className="badge">{caCertificates.length}</span>
              </summary>
              <div className="section">
                <div style={{ display: 'grid', gap: 8 }}>
                  <div className="small">Paste PEM certificate(s)</div>
                  <textarea
                    className="mono"
                    value={caCertInput}
                    onChange={e => setCaCertInput(e.target.value)}
                    placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
                    spellCheck={false}
                    style={{
                      width: '100%',
                      minHeight: 120,
                      resize: 'vertical',
                      padding: 10,
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,.12)',
                      background: 'rgba(255,255,255,.04)',
                      color: 'inherit',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button onClick={addCaCertificatesFromInput} disabled={caCertBusy || !caCertInput.trim()}>
                      {caCertBusy ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                  {caCertError ? <div className="small" style={{ color: '#ff9a9a' }}>{caCertError}</div> : null}
                </div>

                {caCertificates.length ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {caCertificates.map(cert => {
                      const title = cert.subject || 'Certificate'
                      const fp = cert.sha256 ? formatSha256Fingerprint(cert.sha256) : ''
                      return (
                        <div
                          key={cert.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr auto',
                            gap: 10,
                            alignItems: 'center',
                            padding: 10,
                            borderRadius: 10,
                            border: '1px solid rgba(255,255,255,.12)',
                            background: 'rgba(255,255,255,.03)',
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
                            {fp ? <div className="mono small" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word', whiteSpace: 'normal' }}>{fp}</div> : null}
                            {cert.notAfter ? <div className="small">Not after: <span className="mono">{cert.notAfter}</span></div> : null}
                          </div>
                          <button
                            type="button"
                            className="headerDeleteBtn"
                            onClick={() => deleteCaCertificate(cert.id)}
                            aria-label="Delete certificate"
                            title="Delete"
                          >
                            <CloseIcon size={18} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="small" style={{ opacity: 0.7 }}>No custom CA certificates.</div>
                )}
              </div>
            </details>
          </div>
        ) : null}

        {!activeSettingsTabExtension?.render && settingsTab === 'update' ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="small">App version: <span className="mono">v{appVersion ?? '-'}</span></div>
            {pendingUpdateVersion ? <div className="small">Available: <span className="mono">v{pendingUpdateVersion}</span></div> : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              {hasPendingUpdate ? (
                updateDownloaded ? (
                  <>
                    <button onClick={onRestartToUpdate} disabled={updateBusy}>
                      {updateTask === 'installing' ? 'Restarting...' : 'Restart'}
                    </button>
                    <button onClick={onUpdateLater} disabled={updateBusy}>Not now</button>
                  </>
                ) : (
                  <button onClick={onUpdateNow} disabled={updateBusy}>
                    {updateTask === 'downloading' ? 'Downloading...' : 'Update'}
                  </button>
                )
              ) : (
                <button onClick={onCheckUpdates} disabled={updateBusy}>
                  {updateTask === 'checking' ? 'Checking...' : 'Check updates'}
                </button>
              )}
              {updateHint && !updateErrorLog ? (
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

            {updateErrorLog ? (
              <details open>
                <summary className="small" style={{ cursor: 'pointer', opacity: 0.9 }}>
                  Update error log
                </summary>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(updateErrorLog)}
                    disabled={!navigator.clipboard}
                  >
                    Copy log
                  </button>
                </div>
                <pre
                  className="mono small"
                  style={{
                    marginTop: 8,
                    maxHeight: 220,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    background: '#0b1220',
                    color: '#d1d5db',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10,
                    padding: '10px 12px',
                  }}
                >
                  {updateErrorLog}
                </pre>
              </details>
            ) : null}
          </div>
        ) : null}

        {!activeSettingsTabExtension?.render && settingsTab === 'sql' ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="small">SQL connections</div>

            {!globalSqlConnections.length ? (
              <div className="section">
                <button type="button" onClick={addGlobalSqlConnection}>Add Connection</button>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {globalSqlConnections.map((conn, idx) => {
                  const test = sqlConnTestById[conn.id] ?? { inFlight: false, error: null, log: null, okMs: null }
                  const connectionString = buildDbConnectionString(conn)
                  const connectionPreview = getDbConnectionStringPreview(connectionString)
                  const urlInput = sqlConnUrlInputById[conn.id] ?? connectionPreview
                  return (
                    <details key={conn.id} className="accordion">
                      <summary>
                        <span style={{ flex: 1 }}>{conn.name || `Connection ${idx + 1}`}</span>
                        <span className="small" style={{ opacity: 0.7 }}>{conn.type === 'mysql' ? 'MySQL' : 'PostgreSQL'}</span>
                        <button
                          type="button"
                          data-sql-delete-btn={conn.id}
                          className={`headerDeleteBtn ${sqlConnDeleteArmedId === conn.id ? 'confirmActionArmed' : ''}`.trim()}
                          style={{ width: 30, height: 30, marginLeft: 6 }}
                          onPointerDown={e => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onClick={e => {
                            e.preventDefault()
                            e.stopPropagation()
                            onSqlConnectionDeleteClick(conn.id)
                          }}
                          aria-label={sqlConnDeleteArmedId === conn.id ? `Confirm delete connection ${conn.name || idx + 1}` : `Delete connection ${conn.name || idx + 1}`}
                          title={sqlConnDeleteArmedId === conn.id ? 'Confirm delete' : 'Delete'}
                        >
                          {sqlConnDeleteArmedId === conn.id ? <span className="confirmActionGlyph">!</span> : <CloseIcon size={16} />}
                        </button>
                      </summary>
                      <div className="section">
                        <div className="formRow">
                          <div className="formLabel">Name</div>
                          <input
                            className="mono"
                            value={conn.name}
                            onChange={e => updateGlobalSqlConnection(conn.id, prev => ({ ...prev, name: e.target.value }))}
                            placeholder={`Connection ${idx + 1}`}
                          />
                        </div>

                        <div className="formRow">
                          <div className="formLabel">Type</div>
                          <div className="selectMenuWrap" data-sql-type-wrap={conn.id}>
                            <button
                              type="button"
                              className="selectMenuBtn"
                              onPointerDown={e => e.stopPropagation()}
                              onClick={e => {
                                e.preventDefault()
                                e.stopPropagation()
                                setSqlConnTypeMenuOpenId(prev => (prev === conn.id ? null : conn.id))
                              }}
                              aria-haspopup="menu"
                              aria-expanded={sqlConnTypeMenuOpenId === conn.id}
                              aria-label="Database type"
                              title="Database type"
                            >
                              {conn.type === 'mysql' ? 'MySQL' : 'PostgreSQL'}
                            </button>
                            {sqlConnTypeMenuOpenId === conn.id ? (
                              <div
                                className="selectMenuPanel"
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
                                  className={`selectMenuItem ${conn.type === 'postgres' ? 'selectMenuItemActive' : ''}`}
                                  role="menuitem"
                                  onClick={() => {
                                    setSqlConnTypeMenuOpenId(null)
                                    setConnectionTypeAndMaybeDefaultPort(conn.id, 'postgres')
                                  }}
                                >
                                  PostgreSQL
                                </button>
                                <button
                                  type="button"
                                  className={`selectMenuItem ${conn.type === 'mysql' ? 'selectMenuItemActive' : ''}`}
                                  role="menuitem"
                                  onClick={() => {
                                    setSqlConnTypeMenuOpenId(null)
                                    setConnectionTypeAndMaybeDefaultPort(conn.id, 'mysql')
                                  }}
                                >
                                  MySQL
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {conn.type === 'postgres' ? (
                          <div className="formRow">
                            <div className="formLabel">SSL mode</div>
                            <div className="selectMenuWrap" data-sql-ssl-wrap={conn.id}>
                              <button
                                type="button"
                                className="selectMenuBtn"
                                onPointerDown={e => e.stopPropagation()}
                                onClick={e => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setSqlConnSslMenuOpenId(prev => (prev === conn.id ? null : conn.id))
                                }}
                                aria-haspopup="menu"
                                aria-expanded={sqlConnSslMenuOpenId === conn.id}
                                aria-label="PostgreSQL SSL mode"
                                title="PostgreSQL SSL mode"
                              >
                                {conn.sslmode}
                              </button>
                              {sqlConnSslMenuOpenId === conn.id ? (
                                <div
                                  className="selectMenuPanel"
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
                                  {([
                                    { value: 'prefer', label: 'prefer (default)' },
                                    { value: 'require', label: 'require (encrypt, no verify)' },
                                    { value: 'verify-ca', label: 'verify-ca' },
                                    { value: 'verify-full', label: 'verify-full' },
                                    { value: 'disable', label: 'disable' },
                                    { value: 'allow', label: 'allow' },
                                  ] as Array<{ value: PgSslMode; label: string }>).map(o => (
                                    <button
                                      key={o.value}
                                      type="button"
                                      className={`selectMenuItem ${conn.sslmode === o.value ? 'selectMenuItemActive' : ''}`}
                                      role="menuitem"
                                      onClick={() => {
                                        setSqlConnSslMenuOpenId(null)
                                        updateGlobalSqlConnection(conn.id, prev => ({ ...prev, sslmode: o.value }))
                                      }}
                                    >
                                      {o.label}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}

                        <div className="formRow">
                          <div className="formLabel">Host</div>
                          <input className="mono" value={conn.host} onChange={e => updateGlobalSqlConnection(conn.id, prev => ({ ...prev, host: e.target.value }))} placeholder="localhost" />
                        </div>

                        <div className="formRow">
                          <div className="formLabel">Port</div>
                          <input
                            className="mono"
                            inputMode="numeric"
                            value={conn.port}
                            onChange={e => updateGlobalSqlConnection(conn.id, prev => ({ ...prev, port: e.target.value.replaceAll(/\s+/g, '') }))}
                            placeholder={conn.type === 'mysql' ? '3306' : '5432'}
                          />
                        </div>

                        <div className="formRow">
                          <div className="formLabel">Database</div>
                          <input className="mono" value={conn.database} onChange={e => updateGlobalSqlConnection(conn.id, prev => ({ ...prev, database: e.target.value }))} placeholder="mydb" />
                        </div>

                        <div className="formRow">
                          <div className="formLabel">Username</div>
                          <input
                            className="mono"
                            value={conn.username}
                            onChange={e => updateGlobalSqlConnection(conn.id, prev => ({ ...prev, username: e.target.value }))}
                            onCopy={e => e.preventDefault()}
                            onCut={e => e.preventDefault()}
                            placeholder="postgres"
                          />
                        </div>

                        <div className="formRow">
                          <div className="formLabel">Password</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, alignItems: 'center' }}>
                            <input
                              className="mono"
                              type="password"
                              value={conn.password}
                              onChange={e => updateGlobalSqlConnection(conn.id, prev => ({ ...prev, password: e.target.value }))}
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              onCopy={e => e.preventDefault()}
                              onCut={e => e.preventDefault()}
                              placeholder="********"
                            />
                          </div>
                        </div>

                        <div className="formRow">
                          <div className="formLabel">URL</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                            <input
                              className="mono"
                              type="text"
                              value={urlInput}
                              onChange={e => {
                                const next = e.target.value
                                setSqlConnUrlInputById(prev => ({ ...prev, [conn.id]: next }))
                                if (!next.trim()) {
                                  updateGlobalSqlConnection(conn.id, prev => ({
                                    ...prev,
                                    sslmode: 'prefer',
                                    host: '',
                                    port: '',
                                    database: '',
                                    username: '',
                                    password: '',
                                  }))
                                  return
                                }
                                const parsed = parseDbConnectionString(next)
                                if (!parsed) return
                                updateGlobalSqlConnection(conn.id, prev => ({
                                  ...prev,
                                  type: parsed.type,
                                  sslmode: parsed.sslmode,
                                  host: parsed.host,
                                  port: parsed.port,
                                  database: parsed.database,
                                  username: parsed.username,
                                  password: parsed.password,
                                }))
                              }}
                              onPaste={e => {
                                const pasted = e.clipboardData?.getData('text') ?? ''
                                if (!pasted.trim()) return
                                e.preventDefault()
                                setSqlConnUrlInputById(prev => ({ ...prev, [conn.id]: pasted }))
                                const parsed = parseDbConnectionString(pasted)
                                if (!parsed) return
                                updateGlobalSqlConnection(conn.id, prev => ({
                                  ...prev,
                                  type: parsed.type,
                                  sslmode: parsed.sslmode,
                                  host: parsed.host,
                                  port: parsed.port,
                                  database: parsed.database,
                                  username: parsed.username,
                                  password: parsed.password,
                                }))
                                setSqlConnUrlInputById(prev => {
                                  if (!(conn.id in prev)) return prev
                                  const nextState = { ...prev }
                                  delete nextState[conn.id]
                                  return nextState
                                })
                              }}
                              onBlur={e => {
                                const raw = e.target.value.trim()
                                if (!raw) {
                                  updateGlobalSqlConnection(conn.id, prev => ({
                                    ...prev,
                                    sslmode: 'prefer',
                                    host: '',
                                    port: '',
                                    database: '',
                                    username: '',
                                    password: '',
                                  }))
                                  setSqlConnUrlInputById(prev => ({ ...prev, [conn.id]: '' }))
                                  return
                                }
                                const parsed = parseDbConnectionString(raw)
                                if (!parsed) return
                                updateGlobalSqlConnection(conn.id, prev => ({
                                  ...prev,
                                  type: parsed.type,
                                  sslmode: parsed.sslmode,
                                  host: parsed.host,
                                  port: parsed.port,
                                  database: parsed.database,
                                  username: parsed.username,
                                  password: parsed.password,
                                }))
                                setSqlConnUrlInputById(prev => {
                                  if (!(conn.id in prev)) return prev
                                  const nextState = { ...prev }
                                  delete nextState[conn.id]
                                  return nextState
                                })
                              }}
                              onCopy={e => e.preventDefault()}
                              onCut={e => e.preventDefault()}
                              placeholder="Paste postgres://... or mysql://..."
                              style={{
                                fontSize: 12,
                                lineHeight: 1.25,
                                opacity: connectionPreview ? 1 : 0.7,
                                overflowWrap: 'anywhere',
                                wordBreak: 'break-word',
                                whiteSpace: 'normal',
                              }}
                            />
                            <button
                              type="button"
                              className="headerDeleteBtn"
                              style={test.okMs !== null ? { width: 64, justifySelf: 'end', background: 'rgba(80, 220, 140, .18)', borderColor: 'rgba(80, 220, 140, .45)', color: 'rgb(120, 255, 185)' } : { width: 64, justifySelf: 'end' }}
                              onClick={() => void testSqlConnection(conn.id)}
                              disabled={test.inFlight || !connectionString}
                            >
                              {test.inFlight ? 'Testing...' : test.okMs !== null ? `${test.okMs}ms` : 'Test'}
                            </button>
                          </div>
                        </div>

                        {test.error ? (
                          <div className="section" style={{ gap: 6 }}>
                            <div className="small" style={{ color: '#ff9a9a' }}>{test.error}</div>
                            {test.log ? (
                              <div
                                className="mono"
                                style={{
                                  fontSize: 12,
                                  lineHeight: 1.35,
                                  padding: 10,
                                  borderRadius: 10,
                                  border: '1px solid rgba(255,255,255,.12)',
                                  background: 'rgba(255,255,255,.04)',
                                  whiteSpace: 'pre-wrap',
                                  overflowWrap: 'anywhere',
                                }}
                              >
                                {test.log}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </details>
                  )
                })}
                <div className="section" style={{ marginTop: 2 }}>
                  <button type="button" onClick={addGlobalSqlConnection}>Add Connection</button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <div className="modalActions" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={closeSettings}>Save</button>
        </div>
      </dialog>

      {sidebarToolExtensions.map(tool => (
        <div key={tool.id}>
          {tool.render({
            openDrawerId,
            closeDrawer,
            collections,
            environmentsByCollection: envByCollection,
            globalSqlConnections,
          })}
        </div>
      ))}

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
    </div>
  )
}
