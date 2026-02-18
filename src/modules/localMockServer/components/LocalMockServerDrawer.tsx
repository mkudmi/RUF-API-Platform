import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CloseIcon, PencilIcon, TrashIcon } from '../../../shared/icons'
import { ValueHistorySelect } from '../../../shared/components/ValueHistorySelect'
import { copyText } from '../../../shared/utils/clipboard'
import { logWarn } from '../../../shared/utils/logger'
import type { VariableSuggestion } from '../../../shared/utils/variables'
import type { Collection } from '../../collectionTree'
import { JsonCodeEditor } from '../../requestEditor/components/JsonCodeEditor'
import {
  applyPreparedLocalMockRoutes,
  addPreparedLocalMockRoute,
  addConfiguredLocalMockAdditionalPort,
  clearPreparedLocalMockRoutes,
  getLocalMockServerBaseUrl,
  listPreparedLocalMockRoutes,
  listLocalMockAdditionalServers,
  listConfiguredLocalMockAdditionalPorts,
  LOCAL_MOCK_METHOD_OPTIONS,
  LOCAL_MOCK_PRIMARY_PORT,
  normalizeLocalMockHttpStatus,
  normalizeLocalMockRouteBodyToJson,
  normalizeLocalMockRoutePath,
  removePreparedLocalMockRoute,
  removeConfiguredLocalMockAdditionalPort,
  setLocalMockRoute,
  startLocalMockAdditionalServer,
  stopLocalMockAdditionalServer,
  setLocalMockTargetOrigin,
  getLocalMockTargetOrigin,
  deleteLocalMockRoute,
  getLocalMockServerLogs,
  getLocalMockServerStatus,
  listLocalMockRoutes,
  onLocalMockServerUpdated,
  startLocalMockServer,
  stopLocalMockServer,
  type LocalMockServerStatus,
  type LocalMockRouteItem,
} from '../../requestEditor/utils/localMockServer'

type LocalMockServerDrawerProps = {
  open: boolean
  onClose: () => void
  collections: Collection[]
}

const LOCAL_MOCK_SERVER_HEIGHT_KEY = 'ruf_local_mock_server_height_v1'
const LOCAL_MOCK_SERVER_MIN_HEIGHT_PX = 220
const WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX = 38
const EMPTY_VARIABLE_SUGGESTIONS: VariableSuggestion[] = []

type ServerTab = {
  id: string
  port: number
}

type DrawerRouteItem = LocalMockRouteItem & { queued?: boolean }
type RouteEditState = {
  originalMethod: string
  originalPath: string
  method: string
  path: string
  status: string
  body: string
}

function normalizeAbsoluteOrigin(raw: string): string {
  const value = (raw || '').trim()
  if (!value) return ''
  if (!/^https?:\/\//i.test(value)) return ''
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function collectCollectionTargetOrigins(collections: Collection[]): string[] {
  const out = new Set<string>()
  for (const col of collections) {
    const fromBase = normalizeAbsoluteOrigin(col.baseUrl || '')
    if (fromBase) out.add(fromBase)
    const fromSource = normalizeAbsoluteOrigin(col.sourceUrl || '')
    if (fromSource) out.add(fromSource)
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b))
}

function getWindowTitlebarHeightPx() {
  if (typeof document === 'undefined') return WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX
  const el = document.querySelector<HTMLElement>('.windowTitlebar')
  const measured = el?.getBoundingClientRect().height ?? WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX
  return Math.max(0, Math.round(measured)) || WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX
}

function getLocalMockServerMaxHeightPx() {
  if (typeof window === 'undefined') return 420
  const topReserved = getWindowTitlebarHeightPx()
  return Math.max(LOCAL_MOCK_SERVER_MIN_HEIGHT_PX, Math.floor(window.innerHeight - topReserved))
}

function getLocalMockServerBaseHeightPx() {
  if (typeof window === 'undefined') return 420
  const max = getLocalMockServerMaxHeightPx()
  return Math.round(Math.min(window.innerHeight * 0.38, max))
}

export function LocalMockServerDrawer(props: LocalMockServerDrawerProps) {
  const { open, onClose } = props
  const [loading, setLoading] = useState(false)
  const [heightPx, setHeightPx] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_MOCK_SERVER_HEIGHT_KEY)
      if (!raw) return null
      const n = Number(raw)
      return Number.isFinite(n) && n > 0 ? n : null
    } catch {
      return null
    }
  })
  const [primaryStatus, setPrimaryStatus] = useState<LocalMockServerStatus | null>(null)
  const [additionalStatuses, setAdditionalStatuses] = useState<LocalMockServerStatus[]>([])
  const [error, setError] = useState('')
  const [snippetCopied, setSnippetCopied] = useState(false)
  const [routes, setRoutes] = useState<DrawerRouteItem[]>([])
  const [routesLoading, setRoutesLoading] = useState(false)
  const [deletingRouteKey, setDeletingRouteKey] = useState<string | null>(null)
  const [serverTabs, setServerTabs] = useState<ServerTab[]>(() => {
    const configured = listConfiguredLocalMockAdditionalPorts()
    const tabs: ServerTab[] = [{ id: 'server-1', port: LOCAL_MOCK_PRIMARY_PORT }]
    for (const port of configured) tabs.push({ id: `server-${port}`, port })
    return tabs.sort((a, b) => a.port - b.port)
  })
  const [activeTabId, setActiveTabId] = useState<string>('server-1')
  const [targetOriginByPort, setTargetOriginByPort] = useState<Record<number, string>>(() => ({
    [LOCAL_MOCK_PRIMARY_PORT]: getLocalMockTargetOrigin(),
  }))
  const [logsByPort, setLogsByPort] = useState<Record<number, string[]>>({})
  const [logsLoading, setLogsLoading] = useState(false)
  const [routeEditState, setRouteEditState] = useState<RouteEditState | null>(null)
  const routeEditDialogRef = useRef<HTMLDialogElement | null>(null)
  const collectionTargetOrigins = useMemo(
    () => collectCollectionTargetOrigins(props.collections),
    [props.collections],
  )
  const serverStatusByPort = useMemo(() => {
    const map = new Map<number, LocalMockServerStatus>()
    if (primaryStatus) map.set(primaryStatus.port, primaryStatus)
    for (const status of additionalStatuses) map.set(status.port, status)
    return map
  }, [primaryStatus, additionalStatuses])
  const activeTab = useMemo(() => (
    serverTabs.find(tab => tab.id === activeTabId) ?? serverTabs[0]
  ), [activeTabId, serverTabs])
  const activePort = activeTab?.port ?? LOCAL_MOCK_PRIMARY_PORT
  const activeServerStatus = serverStatusByPort.get(activePort) ?? null
  const activeServerUrl = getLocalMockServerBaseUrl(activePort, activeServerStatus?.baseUrl)
  const activeLogs = logsByPort[activePort] ?? []
  const activeTargetOrigin = targetOriginByPort[activePort] || ''
  const targetOriginOptions = useMemo(() => {
    const out = new Set<string>(collectionTargetOrigins)
    if (activeTargetOrigin) out.add(activeTargetOrigin)
    return Array.from(out)
  }, [activeTargetOrigin, collectionTargetOrigins])
  const targetOriginLabel = activeTargetOrigin || 'not selected (fallback: https://api.example.com)'
  const onRouteEditBodyChange = useCallback((next: string) => {
    setRouteEditState(prev => (prev ? { ...prev, body: next } : prev))
  }, [])

  useEffect(() => {
    if (!serverTabs.length) return
    if (serverTabs.some(tab => tab.id === activeTabId)) return
    setActiveTabId(serverTabs[0].id)
  }, [activeTabId, serverTabs])

  async function refreshAll() {
    try {
      const [nextPrimaryStatus, nextAdditionalStatuses] = await Promise.all([
        getLocalMockServerStatus(),
        listLocalMockAdditionalServers(),
      ])
      setPrimaryStatus(nextPrimaryStatus)
      setAdditionalStatuses(nextAdditionalStatuses)
      setServerTabs(prev => {
        const byPort = new Map<number, ServerTab>()
        for (const tab of prev) byPort.set(tab.port, tab)
        if (!byPort.has(LOCAL_MOCK_PRIMARY_PORT)) {
          byPort.set(LOCAL_MOCK_PRIMARY_PORT, { id: 'server-1', port: LOCAL_MOCK_PRIMARY_PORT })
        }
        for (const port of listConfiguredLocalMockAdditionalPorts()) {
          if (port === LOCAL_MOCK_PRIMARY_PORT) continue
          if (!byPort.has(port)) byPort.set(port, { id: `server-${port}`, port })
        }
        for (const status of nextAdditionalStatuses) {
          if (status.port === LOCAL_MOCK_PRIMARY_PORT) continue
          if (!byPort.has(status.port)) {
            byPort.set(status.port, { id: `server-${status.port}`, port: status.port })
          }
        }
        return Array.from(byPort.values()).sort((a, b) => a.port - b.port)
      })

      setRoutesLoading(true)
      setLogsLoading(true)
      const activePortCandidate = activeTab?.port ?? LOCAL_MOCK_PRIMARY_PORT
      const activeStatusCandidate = activePortCandidate === LOCAL_MOCK_PRIMARY_PORT
        ? nextPrimaryStatus
        : (nextAdditionalStatuses.find(x => x.port === activePortCandidate) ?? null)
      const nextRoutes = activeStatusCandidate?.running
        ? await listLocalMockRoutes(activePortCandidate)
        : []
      const preparedRoutes = listPreparedLocalMockRoutes(activePortCandidate)
      const mergedRoutes: DrawerRouteItem[] = nextRoutes.map(route => ({ ...route, queued: false }))
      for (const prepared of preparedRoutes) {
        if (mergedRoutes.some(route => route.method === prepared.method && route.path === prepared.path)) continue
        mergedRoutes.push({
          method: prepared.method,
          path: prepared.path,
          status: prepared.status,
          queued: true,
        })
      }
      const nextLogs = activeStatusCandidate?.running
        ? await getLocalMockServerLogs(activePortCandidate)
        : null
      setRoutes(mergedRoutes)
      if (nextLogs) {
        setLogsByPort(prev => ({ ...prev, [activePortCandidate]: nextLogs }))
      }
      setError('')
    } catch (e) {
      setError((e as Error | null)?.message || 'Failed to refresh local mock server state')
    } finally {
      setRoutesLoading(false)
      setLogsLoading(false)
    }
  }

  async function refreshLogs() {
    if (!activeServerStatus?.running) return
    setLogsLoading(true)
    try {
      const next = await getLocalMockServerLogs(activePort)
      setLogsByPort(prev => ({ ...prev, [activePort]: next }))
    } catch {
      // ignore transient log polling errors
    } finally {
      setLogsLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    void refreshAll()
    setTargetOriginByPort(prev => ({
      ...prev,
      [LOCAL_MOCK_PRIMARY_PORT]: getLocalMockTargetOrigin(),
    }))
  }, [open])

  useEffect(() => {
    if (!open) return
    void refreshAll()
  }, [open, activePort])

  useEffect(() => {
    return onLocalMockServerUpdated(() => {
      if (!open) return
      void refreshAll()
    })
  }, [open])

  useEffect(() => {
    if (!open || !activeServerStatus?.running) return
    void refreshLogs()
    const timer = window.setInterval(() => {
      void refreshLogs()
    }, 1000)
    return () => window.clearInterval(timer)
  }, [open, activePort, activeServerStatus?.running])

  useEffect(() => {
    const dialog = routeEditDialogRef.current
    if (!dialog) return
    if (routeEditState) {
      if (!dialog.open) dialog.showModal()
    } else if (dialog.open) {
      dialog.close()
    }
  }, [routeEditState])

  useEffect(() => {
    if (heightPx == null) return
    try {
      localStorage.setItem(LOCAL_MOCK_SERVER_HEIGHT_KEY, String(heightPx))
    } catch {
      // Ignore storage write failures.
    }
  }, [heightPx])

  useEffect(() => {
    if (!open) return

    function clampToViewport() {
      const max = getLocalMockServerMaxHeightPx()
      setHeightPx(prev => {
        if (prev == null) return prev
        return Math.min(prev, max)
      })
    }

    clampToViewport()
    window.addEventListener('resize', clampToViewport)
    return () => window.removeEventListener('resize', clampToViewport)
  }, [open])

  function setTargetOriginForPort(port: number, originRaw: string) {
    const normalized = normalizeAbsoluteOrigin(originRaw)
    setTargetOriginByPort(prev => ({
      ...prev,
      [port]: normalized,
    }))
    if (port === LOCAL_MOCK_PRIMARY_PORT) setLocalMockTargetOrigin(normalized)
  }

  function openRouteEditor(route: DrawerRouteItem) {
    const prepared = listPreparedLocalMockRoutes(activePort).find(
      item => item.method === route.method && item.path === route.path,
    )
    setRouteEditState({
      originalMethod: route.method,
      originalPath: route.path,
      method: (prepared?.method ?? route.method ?? 'GET').toUpperCase(),
      path: prepared?.path ?? route.path ?? '/',
      status: String(prepared?.status ?? route.status ?? 200),
      body: prepared?.body ?? '{}',
    })
  }

  async function saveRouteEditor() {
    if (!routeEditState) return
    const method = (routeEditState.method || 'GET').trim().toUpperCase() || 'GET'
    const path = normalizeLocalMockRoutePath(routeEditState.path)
    const status = normalizeLocalMockHttpStatus(routeEditState.status, 200)
    const body = normalizeLocalMockRouteBodyToJson(routeEditState.body)

    const preparedBefore = listPreparedLocalMockRoutes(activePort).find(
      item => item.method === routeEditState.originalMethod && item.path === routeEditState.originalPath,
    )
    const headers = preparedBefore?.headers?.length
      ? preparedBefore.headers
      : [['Content-Type', 'application/json']] as Array<[string, string]>

    setLoading(true)
    setError('')
    try {
      removePreparedLocalMockRoute({
        port: activePort,
        method: routeEditState.originalMethod,
        path: routeEditState.originalPath,
      })
      const payload = { method, path, port: activePort, status, headers, body }
      addPreparedLocalMockRoute(payload)

      if (activeServerStatus?.running) {
        if (routeEditState.originalMethod !== method || routeEditState.originalPath !== path) {
          try {
            await deleteLocalMockRoute({
              method: routeEditState.originalMethod,
              path: routeEditState.originalPath,
              port: activePort,
            })
          } catch {
            // Ignore old-route delete failures; next upsert still applies edited route.
          }
        }
        await setLocalMockRoute(payload)
      }

      setRouteEditState(null)
      await refreshAll()
    } catch (e) {
      setError((e as Error | null)?.message || 'Failed to update route')
    } finally {
      setLoading(false)
    }
  }

  function addServerTab() {
    const usedPorts = new Set(serverTabs.map(tab => tab.port))
    let candidate = LOCAL_MOCK_PRIMARY_PORT + 1
    while (usedPorts.has(candidate) && candidate < 65535) candidate += 1
    if (candidate > 65535) {
      setError('No free port available for additional mock server')
      return
    }
    addConfiguredLocalMockAdditionalPort(candidate)
    setError('')
    setServerTabs(prev => {
      if (prev.some(tab => tab.port === candidate)) return prev
      return [...prev, { id: `server-${candidate}`, port: candidate }].sort((a, b) => a.port - b.port)
    })
    setActiveTabId(`server-${candidate}`)
    setTargetOriginByPort(prev => {
      if (prev[candidate]) return prev
      const fallback = collectionTargetOrigins[0] || ''
      return { ...prev, [candidate]: fallback }
    })
  }

  async function removeServerTab(tabId: string) {
    const tab = serverTabs.find(x => x.id === tabId)
    if (!tab) return
    if (tab.port === LOCAL_MOCK_PRIMARY_PORT) return

    setLoading(true)
    setError('')
    try {
      const status = serverStatusByPort.get(tab.port)
      if (status?.running) await stopLocalMockAdditionalServer(tab.port)
      removeConfiguredLocalMockAdditionalPort(tab.port)
      clearPreparedLocalMockRoutes(tab.port)
      setTargetOriginByPort(prev => {
        const next = { ...prev }
        delete next[tab.port]
        return next
      })
      setLogsByPort(prev => {
        const next = { ...prev }
        delete next[tab.port]
        return next
      })
      setServerTabs(prev => {
        const idx = prev.findIndex(x => x.id === tabId)
        if (idx < 0) return prev
        const next = [...prev.slice(0, idx), ...prev.slice(idx + 1)]
        if (activeTabId === tabId) {
          const fallback = next[idx - 1] ?? next[idx] ?? next[0] ?? null
          setActiveTabId(fallback?.id ?? 'server-1')
        }
        return next
      })
      await refreshAll()
    } catch (e) {
      setError((e as Error | null)?.message || 'Failed to remove local server')
    } finally {
      setLoading(false)
    }
  }

  async function startActiveServer() {
    if (!activeTab) return
    setLoading(true)
    setError('')
    try {
      if (activeTab.port === LOCAL_MOCK_PRIMARY_PORT) {
        await startLocalMockServer(activeTab.port)
      } else {
        await startLocalMockAdditionalServer(activeTab.port)
      }
      await applyPreparedLocalMockRoutes(activeTab.port)
      await refreshAll()
    } catch (e) {
      setError((e as Error | null)?.message || 'Failed to start local server')
    } finally {
      setLoading(false)
    }
  }

  async function stopActiveServer() {
    if (!activeTab) return
    setLoading(true)
    setError('')
    try {
      if (activeTab.port === LOCAL_MOCK_PRIMARY_PORT) {
        await stopLocalMockServer()
      } else {
        await stopLocalMockAdditionalServer(activeTab.port)
      }
      await refreshAll()
    } catch (e) {
      setError((e as Error | null)?.message || 'Failed to stop local server')
    } finally {
      setLoading(false)
    }
  }

  const devtoolsSnippet = useMemo(() => {
    const base = getLocalMockServerBaseUrl(activePort || LOCAL_MOCK_PRIMARY_PORT, activeServerStatus?.baseUrl)
    const target = activeTargetOrigin || 'https://api.example.com'
    return `(() => {\n  const TARGET_ORIGIN = '${target}';\n  const MOCK_ORIGIN = '${base}';\n\n  // Prevent wrapper stacking when snippet is executed multiple times.\n  if (!window.__rufOrigFetch) window.__rufOrigFetch = window.fetch.bind(window);\n  const origFetch = window.__rufOrigFetch;\n\n  const isMiss = async (res) => {\n    if (res.headers.get('x-ruf-local-mock-miss') === '1') return true;\n    if (res.status !== 404) return false;\n    try {\n      const data = await res.clone().json();\n      return String(data?.error || '').toLowerCase() === 'mock route not found';\n    } catch {\n      return false;\n    }\n  };\n\n  window.fetch = async (input, init) => {\n    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;\n    if (!url.startsWith(TARGET_ORIGIN + '/')) return origFetch(input, init);\n\n    try {\n      const mockedUrl = url.replace(TARGET_ORIGIN, MOCK_ORIGIN);\n      const mockInput = input instanceof Request ? new Request(mockedUrl, input) : mockedUrl;\n      const res = await origFetch(mockInput, init);\n      if (await isMiss(res)) return origFetch(input, init);\n      return res;\n    } catch {\n      return origFetch(input, init);\n    }\n  };\n\n  console.log('[Ruf] Local mock redirect enabled:', TARGET_ORIGIN, '->', MOCK_ORIGIN);\n})();`
  }, [activePort, activeServerStatus?.baseUrl, activeTargetOrigin])

  function onResizeHandlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!open) return
    e.preventDefault()
    const handle = e.currentTarget
    const pointerId = e.pointerId
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    const startY = e.clientY
    const max = getLocalMockServerMaxHeightPx()
    const startHeight = heightPx ?? Math.round(Math.min(window.innerHeight * 0.38, max))
    const min = LOCAL_MOCK_SERVER_MIN_HEIGHT_PX

    function clamp(n: number) {
      return Math.max(min, Math.min(max, n))
    }

    function onMove(ev: PointerEvent) {
      if ((ev.buttons & 1) === 0) {
        cleanup()
        return
      }
      const dy = ev.clientY - startY
      const next = clamp(Math.round(startHeight - dy))
      setHeightPx(next)
    }

    function cleanup() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('blur', onCancel)
      handle.removeEventListener('lostpointercapture', onCancel)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      } catch (error) {
        logWarn('LocalMockServerDrawer.releasePointerCapture', 'Failed to release pointer capture', { error })
      }
    }

    function onUp() {
      cleanup()
    }

    function onCancel() {
      cleanup()
    }

    try {
      handle.setPointerCapture(pointerId)
    } catch (error) {
      logWarn('LocalMockServerDrawer.setPointerCapture', 'Failed to set pointer capture', { error })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('blur', onCancel)
    handle.addEventListener('lostpointercapture', onCancel)
  }

  function onResizeHandleDoubleClick() {
    const max = getLocalMockServerMaxHeightPx()
    const base = getLocalMockServerBaseHeightPx()
    const current = heightPx ?? base
    const isMaximized = Math.abs(current - max) <= 2
    setHeightPx(isMaximized ? base : max)
  }

  const drawerMaxHeightPx = getLocalMockServerMaxHeightPx()
  const drawerHeightPx = heightPx == null ? null : Math.min(heightPx, drawerMaxHeightPx)

  return (
    <>
      <div
        className={open ? 'terminalBackdrop terminalBackdropOpen localMockBackdrop' : 'terminalBackdrop localMockBackdrop'}
        onClick={onClose}
      />
      <section
        className={open ? 'terminalDrawer terminalDrawerOpen localMockServerDrawer' : 'terminalDrawer localMockServerDrawer'}
        aria-hidden={!open}
        style={drawerHeightPx != null ? { height: `${drawerHeightPx}px`, maxHeight: `${drawerMaxHeightPx}px` } : { maxHeight: `${drawerMaxHeightPx}px` }}
      >
        <div className="terminalResizeHandle" onPointerDown={onResizeHandlePointerDown} onDoubleClick={onResizeHandleDoubleClick} />
        <header className="terminalHeader">
          <div className="terminalTitle mono">
            Local Mock Server
            <div className="terminalTabs" role="tablist" aria-label="Local mock server tabs">
              {serverTabs.map((tab, i) => {
                const tabStatus = serverStatusByPort.get(tab.port)
                const running = !!tabStatus?.running
                const active = tab.id === activeTabId
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={active ? 'terminalTab terminalTabActive' : 'terminalTab'}
                    onClick={() => setActiveTabId(tab.id)}
                    disabled={loading}
                    role="tab"
                    aria-selected={active}
                    title={`Port ${tab.port}`}
                  >
                    <span className="terminalTabLabel">{`Server ${i + 1}`}</span>
                    {running ? <span className="localMockStatusDot localMockStatusDotRunning" aria-hidden="true" style={{ flex: '0 0 auto' }} /> : null}
                    {tab.port !== LOCAL_MOCK_PRIMARY_PORT ? (
                      <span
                        className="terminalTabClose"
                        role="button"
                        aria-label="Delete server"
                        onClick={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          void removeServerTab(tab.id)
                        }}
                      >
                        ✕
                      </span>
                    ) : null}
                  </button>
                )
              })}
              <button
                type="button"
                className="terminalAddBtn"
                onClick={addServerTab}
                disabled={loading}
                aria-label="Add server tab"
                title="Add server tab"
              >
                +
              </button>
            </div>
          </div>
          <div className="terminalHeaderActions">
            <button type="button" className="iconBtn headerDeleteBtn terminalCloseBtn" onClick={onClose} aria-label="Close" title="Close">
              <CloseIcon size={18} />
            </button>
          </div>
        </header>

        <div className="terminalOutput">
          <div className="section" style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'grid', gap: 6, minWidth: 0, flex: 1 }}>
                <div style={{ display: 'grid', gap: 6, minWidth: 0, maxWidth: 560 }}>
                  <ValueHistorySelect
                    value={activeTargetOrigin}
                    valueLabel={targetOriginLabel}
                    ariaLabel="Select target origin"
                    title="Select target origin"
                    options={[
                      { value: '', label: 'not selected (fallback: https://api.example.com)' },
                      ...targetOriginOptions.map(origin => ({ value: origin, label: origin })),
                    ]}
                    onChange={next => setTargetOriginForPort(activePort, next)}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span className={`localMockStatusDot ${activeServerStatus?.running ? 'localMockStatusDotRunning' : 'localMockStatusDotStopped'}`} aria-hidden="true" />
                <div className="mono small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }} title={activeServerUrl}>
                  {activeServerUrl}
                </div>
                <button
                  type="button"
                  disabled={loading || !activeTab}
                  onClick={() => {
                    if (!activeTab) return
                    if (activeServerStatus?.running) {
                      void stopActiveServer()
                    } else {
                      void startActiveServer()
                    }
                  }}
                  title={activeServerStatus?.running ? 'Stop active server' : 'Start active server'}
                >
                  {loading ? '...' : (activeServerStatus?.running ? 'Stop' : 'Start')}
                </button>
              </div>
            </div>

            {error ? <div className="small" style={{ color: '#ff9a9a' }}>{error}</div> : null}

            <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
                <div className="small" style={{ opacity: 0.82 }}>
                  Routes:
                </div>
                {routesLoading ? (
                  <div className="small" style={{ opacity: 0.75 }}>Loading routes...</div>
                ) : routes.length === 0 ? (
                  <div className="small" style={{ opacity: 0.75 }}>No routes published.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {routes.map(route => {
                      const key = `${route.method} ${route.path}`
                      const deleting = deletingRouteKey === key
                      return (
                        <div
                          key={key}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '64px minmax(0, 1fr) max-content auto',
                            gap: 4,
                            alignItems: 'center',
                            border: '1px solid rgba(255,255,255,.12)',
                            borderRadius: 8,
                            padding: '4px 4px 4px 6px',
                            minHeight: 30,
                          }}
                        >
                          <div className="mono" style={{ fontSize: 12 }}>{route.method}</div>
                          <div className="mono" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={route.path}>
                            {route.path}
                          </div>
                          <div className="mono" style={{ fontSize: 12, opacity: 0.85, whiteSpace: 'nowrap' }}>
                            {route.status}{route.queued ? ' / QUEUED' : ''}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifySelf: 'end', gap: 8, marginLeft: 14 }}>
                            <button
                              type="button"
                              className="iconBtn historyDeleteBtn"
                              aria-label="Edit route"
                              title="Edit route"
                              disabled={loading}
                              onClick={() => openRouteEditor(route)}
                            >
                              <PencilIcon size={13} />
                            </button>
                            <button
                              type="button"
                              className="iconBtn historyDeleteBtn"
                              aria-label={route.queued ? 'Delete queued route' : 'Delete route'}
                              title={route.queued ? 'Delete queued route' : 'Delete route'}
                              disabled={deleting || loading}
                              onClick={async () => {
                                setDeletingRouteKey(key)
                                setError('')
                                try {
                                  removePreparedLocalMockRoute({
                                    port: activePort,
                                    method: route.method,
                                    path: route.path,
                                  })
                                  if (route.queued) {
                                    setRoutes(prev => prev.filter(x => !(x.method === route.method && x.path === route.path && !!x.queued)))
                                  } else {
                                    const nextStatus = await deleteLocalMockRoute({
                                      method: route.method,
                                      path: route.path,
                                      port: activePort,
                                    })
                                    if (activePort === LOCAL_MOCK_PRIMARY_PORT) {
                                      setPrimaryStatus(nextStatus)
                                    } else {
                                      setAdditionalStatuses(prev => prev.map(s => (s.port === activePort ? nextStatus : s)))
                                    }
                                    setRoutes(prev => prev.filter(x => !(x.method === route.method && x.path === route.path && !x.queued)))
                                  }
                                } catch (e) {
                                  setError((e as Error | null)?.message || 'Failed to delete route')
                                } finally {
                                  setDeletingRouteKey(null)
                                }
                              }}
                            >
                              {deleting ? '...' : <TrashIcon size={14} />}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10 }}>
              <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div className="small" style={{ opacity: 0.82 }}>DevTools snippet for external frontend URL rewrite:</div>
                  <button
                    type="button"
                    onClick={async () => {
                      await copyText(devtoolsSnippet)
                      setSnippetCopied(true)
                      window.setTimeout(() => setSnippetCopied(false), 900)
                    }}
                    style={{ height: 28, minHeight: 28, padding: '0 10px' }}
                  >
                    {snippetCopied ? 'Copied' : 'Copy Snippet'}
                  </button>
                </div>
                <textarea className="mono" rows={8} readOnly value={devtoolsSnippet} style={{ width: '100%', boxSizing: 'border-box', opacity: 0.9 }} />
              </div>

              <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
                <div className="small" style={{ opacity: 0.82 }}>Server logs:</div>
                {logsLoading && !activeLogs.length ? (
                  <div className="small" style={{ opacity: 0.75 }}>Loading logs...</div>
                ) : null}
                <textarea
                  className="mono"
                  rows={8}
                  readOnly
                  value={activeLogs.length ? activeLogs.join('\n') : 'No logs yet.'}
                  style={{ width: '100%', boxSizing: 'border-box', opacity: 0.9 }}
                />
              </div>
            </div>
          </div>
        </div>

        <dialog
          ref={routeEditDialogRef}
          className="modal modalSmall localMockRouteEditDialog"
          onClose={() => setRouteEditState(null)}
        >
          <div className="modalHeader">
            <b>Edit Route</b>
            <button
              type="button"
              className="iconBtn"
              onClick={() => setRouteEditState(null)}
              aria-label="Close"
              title="Close"
            >
              <CloseIcon />
            </button>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            <div className="small" style={{ opacity: 0.82 }}>Method</div>
            <ValueHistorySelect
              value={routeEditState?.method ?? 'GET'}
              valueLabel={routeEditState?.method ?? 'GET'}
              ariaLabel="Select route method"
              title="Select route method"
              options={LOCAL_MOCK_METHOD_OPTIONS.map(option => ({ value: option, label: option }))}
              onChange={next => setRouteEditState(prev => (prev ? { ...prev, method: next } : prev))}
            />

            <div className="small" style={{ opacity: 0.82 }}>Path</div>
            <input
              className="mono"
              value={routeEditState?.path ?? '/'}
              onChange={e => setRouteEditState(prev => (prev ? { ...prev, path: e.target.value } : prev))}
              placeholder="/api/v3/pet/2"
            />

            <div className="small" style={{ opacity: 0.82 }}>Status</div>
            <input
              className="mono"
              value={routeEditState?.status ?? '200'}
              onChange={e => setRouteEditState(prev => (prev ? { ...prev, status: e.target.value } : prev))}
              placeholder="200"
            />

            <div className="small" style={{ opacity: 0.82 }}>Body (JSON)</div>
            <JsonCodeEditor
              value={routeEditState?.body ?? '{}'}
              onChangeValue={onRouteEditBodyChange}
              variableSuggestions={EMPTY_VARIABLE_SUGGESTIONS}
            />
          </div>

          <div className="modalActions">
            <button type="button" onClick={() => setRouteEditState(null)}>
              Cancel
            </button>
            <button type="button" onClick={() => { void saveRouteEditor() }} disabled={!routeEditState || loading}>
              Save
            </button>
          </div>
        </dialog>
      </section>
    </>
  )
}
