import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CloseIcon } from '../../../shared/icons'
import { copyText } from '../../../shared/utils/clipboard'
import { logWarn } from '../../../shared/utils/logger'
import type { Collection } from '../../collectionTree'
import {
  listLocalMockAdditionalServers,
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

type ServerTab = {
  id: string
  port: number
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
  const [primaryStatus, setPrimaryStatus] = useState<{
    running: boolean
    port: number
    baseUrl: string
    routesCount: number
  } | null>(null)
  const [additionalStatuses, setAdditionalStatuses] = useState<Array<{
    running: boolean
    port: number
    baseUrl: string
    routesCount: number
  }>>([])
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [snippetCopied, setSnippetCopied] = useState(false)
  const [routes, setRoutes] = useState<LocalMockRouteItem[]>([])
  const [routesLoading, setRoutesLoading] = useState(false)
  const [deletingRouteKey, setDeletingRouteKey] = useState<string | null>(null)
  const [serverTabs, setServerTabs] = useState<ServerTab[]>([{ id: 'server-1', port: 7777 }])
  const [activeTabId, setActiveTabId] = useState<string>('server-1')
  const [targetOriginByPort, setTargetOriginByPort] = useState<Record<number, string>>(() => ({
    7777: getLocalMockTargetOrigin(),
  }))
  const [logs, setLogs] = useState<string[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const collectionTargetOrigins = useMemo(
    () => collectCollectionTargetOrigins(props.collections),
    [props.collections],
  )
  const serverStatusByPort = useMemo(() => {
    const map = new Map<number, {
      running: boolean
      port: number
      baseUrl: string
      routesCount: number
    }>()
    if (primaryStatus) map.set(primaryStatus.port, primaryStatus)
    for (const status of additionalStatuses) map.set(status.port, status)
    return map
  }, [primaryStatus, additionalStatuses])
  const activeTab = useMemo(() => (
    serverTabs.find(tab => tab.id === activeTabId) ?? serverTabs[0]
  ), [activeTabId, serverTabs])
  const activePort = activeTab?.port ?? 7777
  const activeServerStatus = serverStatusByPort.get(activePort) ?? null
  const activeTargetOrigin = targetOriginByPort[activePort] || ''
  const targetOriginOptions = useMemo(() => {
    const out = new Set<string>(collectionTargetOrigins)
    if (activeTargetOrigin) out.add(activeTargetOrigin)
    return Array.from(out)
  }, [activeTargetOrigin, collectionTargetOrigins])

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
        if (!byPort.has(7777)) byPort.set(7777, { id: 'server-1', port: 7777 })
        for (const status of nextAdditionalStatuses) {
          if (status.port === 7777) continue
          if (!byPort.has(status.port)) {
            byPort.set(status.port, { id: `server-${status.port}`, port: status.port })
          }
        }
        return Array.from(byPort.values()).sort((a, b) => a.port - b.port)
      })

      if (!nextPrimaryStatus.running) {
        setRoutes([])
        setLogs([])
        setError('')
        return
      }
      setRoutesLoading(true)
      setLogsLoading(true)
      const nextRoutes = await listLocalMockRoutes()
      const nextLogs = await getLocalMockServerLogs()
      setRoutes(nextRoutes)
      setLogs(nextLogs)
      setError('')
    } catch (e) {
      setError((e as Error | null)?.message || 'Failed to refresh local mock server state')
    } finally {
      setRoutesLoading(false)
      setLogsLoading(false)
    }
  }

  async function refreshLogs() {
    if (!primaryStatus?.running) {
      setLogs([])
      return
    }
    setLogsLoading(true)
    try {
      const next = await getLocalMockServerLogs()
      setLogs(next)
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
      7777: getLocalMockTargetOrigin(),
    }))
  }, [open])

  useEffect(() => {
    return onLocalMockServerUpdated(() => {
      if (!open) return
      void refreshAll()
    })
  }, [open])

  useEffect(() => {
    if (!open || !primaryStatus?.running) return
    void refreshLogs()
    const timer = window.setInterval(() => {
      void refreshLogs()
    }, 1000)
    return () => window.clearInterval(timer)
  }, [open, primaryStatus?.running])

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
    if (port === 7777) setLocalMockTargetOrigin(normalized)
  }

  function addServerTab() {
    setServerTabs(prev => {
      const usedPorts = new Set(prev.map(tab => tab.port))
      let candidate = 7778
      while (usedPorts.has(candidate) && candidate < 65535) candidate += 1
      if (candidate > 65535) return prev
      const nextTab = { id: `server-${candidate}`, port: candidate }
      setActiveTabId(nextTab.id)
      setTargetOriginByPort(prevTarget => {
        if (prevTarget[candidate]) return prevTarget
        const fallback = collectionTargetOrigins[0] || ''
        return { ...prevTarget, [candidate]: fallback }
      })
      return [...prev, nextTab]
    })
  }

  async function startActiveServer() {
    if (!activeTab) return
    setLoading(true)
    setInfo('')
    setError('')
    try {
      const next = activeTab.port === 7777
        ? await startLocalMockServer(activeTab.port)
        : await startLocalMockAdditionalServer(activeTab.port)
      setInfo(`Local server started: ${next.baseUrl}`)
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
    setInfo('')
    setError('')
    try {
      if (activeTab.port === 7777) {
        await stopLocalMockServer()
      } else {
        await stopLocalMockAdditionalServer(activeTab.port)
      }
      setInfo(`Local server stopped: http://127.0.0.1:${activeTab.port}`)
      await refreshAll()
    } catch (e) {
      setError((e as Error | null)?.message || 'Failed to stop local server')
    } finally {
      setLoading(false)
    }
  }

  const devtoolsSnippet = useMemo(() => {
    const base = activeServerStatus?.baseUrl || `http://127.0.0.1:${activePort || 7777}`
    const target = activeTargetOrigin || 'https://api.example.com'
    return `(() => {\n  const TARGET_ORIGIN = '${target}';\n  const MOCK_ORIGIN = '${base}';\n  const orig = window.fetch.bind(window);\n  const isMiss = async (res) => {\n    if (res.headers.get('x-ruf-local-mock-miss') === '1') return true;\n    const ct = (res.headers.get('content-type') || '').toLowerCase();\n    if (!ct.includes('application/json')) return false;\n    try {\n      const data = await res.clone().json();\n      return String(data?.error || '').toLowerCase() === 'mock route not found';\n    } catch {\n      return false;\n    }\n  };\n  window.fetch = async (input, init) => {\n    const url = typeof input === 'string' ? input : input.url;\n    if (!url.startsWith(TARGET_ORIGIN + '/')) return orig(input, init);\n    const redirected = url.replace(TARGET_ORIGIN, MOCK_ORIGIN);\n    const res = await orig(redirected, init);\n    if (await isMiss(res)) return orig(input, init);\n    return res;\n  };\n  console.log('[Ruf] Local mock redirect is enabled for', TARGET_ORIGIN);\n})();`
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
        className={open ? 'terminalBackdrop terminalBackdropOpen' : 'terminalBackdrop'}
        onClick={onClose}
      />
      <section
        className={open ? 'terminalDrawer terminalDrawerOpen' : 'terminalDrawer'}
        aria-hidden={!open}
        style={drawerHeightPx != null ? { height: `${drawerHeightPx}px`, maxHeight: `${drawerMaxHeightPx}px` } : { maxHeight: `${drawerMaxHeightPx}px` }}
      >
        <div className="terminalResizeHandle" onPointerDown={onResizeHandlePointerDown} onDoubleClick={onResizeHandleDoubleClick} />
        <header className="terminalHeader">
          <div className="terminalTitle mono">Local Mock Server</div>
          <div className="terminalHeaderActions">
            <button type="button" className="iconBtn headerDeleteBtn terminalCloseBtn" onClick={onClose} aria-label="Close" title="Close">
              <CloseIcon size={18} />
            </button>
          </div>
        </header>

        <div className="terminalOutput">
          <div className="section" style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
              {serverTabs.map((tab, i) => {
                const tabStatus = serverStatusByPort.get(tab.port)
                const running = !!tabStatus?.running
                const active = tab.id === activeTabId
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTabId(tab.id)}
                    style={{
                      minHeight: 26,
                      height: 26,
                      padding: '0 9px',
                      borderRadius: 8,
                      border: active ? '1px solid rgba(120,220,160,.65)' : '1px solid rgba(255,255,255,.18)',
                      background: active ? 'rgba(120,220,160,.14)' : 'rgba(255,255,255,.04)',
                      color: running ? '#9fe7b6' : undefined,
                    }}
                    title={`Port ${tab.port}`}
                  >
                    {`Server ${i + 1}`}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={addServerTab}
                style={{ minHeight: 26, height: 26, padding: '0 10px', borderRadius: 8 }}
                title="Add server tab"
              >
                +
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={loading || !!activeServerStatus?.running}
                onClick={() => {
                  void startActiveServer()
                }}
              >
                Start
              </button>
              <button
                type="button"
                disabled={loading || !activeServerStatus?.running}
                onClick={() => {
                  void stopActiveServer()
                }}
              >
                Stop
              </button>
            </div>

            <div className="small" style={{ opacity: 0.85 }}>
              Port: <span className="mono">{activePort}</span>
              {' / '}
              Status: <span className="mono">{activeServerStatus?.running ? `RUNNING ${activeServerStatus.baseUrl}` : 'STOPPED'}</span>
              {activePort === 7777 && primaryStatus?.running ? <span> / routes: <span className="mono">{primaryStatus.routesCount}</span></span> : null}
            </div>

            {info ? <div className="small" style={{ color: '#9ad19a' }}>{info}</div> : null}
            {error ? <div className="small" style={{ color: '#ff9a9a' }}>{error}</div> : null}

            <div style={{ display: 'grid', gap: 6 }}>
              <div className="small" style={{ opacity: 0.82 }}>Target origin:</div>
              <select
                className="mono"
                value={activeTargetOrigin}
                onChange={e => setTargetOriginForPort(activePort, e.target.value)}
              >
                <option value="">not selected (fallback: https://api.example.com)</option>
                {targetOriginOptions.map(origin => (
                  <option key={origin} value={origin}>{origin}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <div className="small" style={{ opacity: 0.82 }}>
                Routes (primary server):
              </div>
              {activePort !== 7777 ? (
                <div className="small" style={{ opacity: 0.7 }}>
                  Switch to Server 1 to view/manage routes.
                </div>
              ) : routesLoading ? (
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
                          gridTemplateColumns: '80px 1fr 64px 76px',
                          gap: 8,
                          alignItems: 'center',
                          border: '1px solid rgba(255,255,255,.12)',
                          borderRadius: 10,
                          padding: '8px 10px',
                        }}
                      >
                        <div className="mono small">{route.method}</div>
                        <div className="mono small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={route.path}>
                          {route.path}
                        </div>
                        <div className="mono small" style={{ opacity: 0.85 }}>{route.status}</div>
                        <button
                          type="button"
                          disabled={deleting || loading || !primaryStatus?.running}
                          onClick={async () => {
                            setDeletingRouteKey(key)
                            setInfo('')
                            setError('')
                            try {
                              const nextStatus = await deleteLocalMockRoute({
                                method: route.method,
                                path: route.path,
                              })
                              setPrimaryStatus(nextStatus)
                              setInfo(`Route deleted: ${route.method} ${route.path}`)
                            } catch (e) {
                              setError((e as Error | null)?.message || 'Failed to delete route')
                            } finally {
                              setDeletingRouteKey(null)
                            }
                          }}
                          style={{ minHeight: 28, height: 28, padding: '0 8px' }}
                        >
                          {deleting ? '...' : 'Delete'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

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

            <div className="small" style={{ opacity: 0.82 }}>Server logs (primary server):</div>
            {activePort !== 7777 ? (
              <div className="small" style={{ opacity: 0.7 }}>Switch to Server 1 to view logs.</div>
            ) : (
              <>
                {logsLoading && !logs.length ? (
                  <div className="small" style={{ opacity: 0.75 }}>Loading logs...</div>
                ) : null}
                <textarea
                  className="mono"
                  rows={8}
                  readOnly
                  value={logs.length ? logs.join('\n') : 'No logs yet.'}
                  style={{ width: '100%', boxSizing: 'border-box', opacity: 0.9 }}
                />
              </>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
