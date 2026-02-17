import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CloseIcon } from '../../../shared/icons'
import { copyText } from '../../../shared/utils/clipboard'
import { logWarn } from '../../../shared/utils/logger'
import {
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
}

const LOCAL_MOCK_SERVER_HEIGHT_KEY = 'ruf_local_mock_server_height_v1'
const LOCAL_MOCK_SERVER_MIN_HEIGHT_PX = 220
const WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX = 38

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
  const [status, setStatus] = useState<{
    running: boolean
    port: number
    baseUrl: string
    routesCount: number
  } | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [snippetCopied, setSnippetCopied] = useState(false)
  const [routes, setRoutes] = useState<LocalMockRouteItem[]>([])
  const [routesLoading, setRoutesLoading] = useState(false)
  const [deletingRouteKey, setDeletingRouteKey] = useState<string | null>(null)
  const [targetOrigin, setTargetOrigin] = useState<string>(() => getLocalMockTargetOrigin())
  const [logs, setLogs] = useState<string[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  async function refreshAll() {
    try {
      const nextStatus = await getLocalMockServerStatus()
      setStatus(nextStatus)
      if (!nextStatus.running) {
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
    if (!status?.running) {
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
    setTargetOrigin(getLocalMockTargetOrigin())
  }, [open])

  useEffect(() => {
    return onLocalMockServerUpdated(() => {
      if (!open) return
      void refreshAll()
    })
  }, [open])

  useEffect(() => {
    if (!open || !status?.running) return
    void refreshLogs()
    const timer = window.setInterval(() => {
      void refreshLogs()
    }, 1000)
    return () => window.clearInterval(timer)
  }, [open, status?.running])

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

  const devtoolsSnippet = useMemo(() => {
    const base = status?.baseUrl || 'http://127.0.0.1:7777'
    const target = targetOrigin || 'https://api.example.com'
    return `(() => {\n  const TARGET_ORIGIN = '${target}';\n  const MOCK_ORIGIN = '${base}';\n  const orig = window.fetch.bind(window);\n  const isMiss = async (res) => {\n    if (res.headers.get('x-ruf-local-mock-miss') === '1') return true;\n    const ct = (res.headers.get('content-type') || '').toLowerCase();\n    if (!ct.includes('application/json')) return false;\n    try {\n      const data = await res.clone().json();\n      return String(data?.error || '').toLowerCase() === 'mock route not found';\n    } catch {\n      return false;\n    }\n  };\n  window.fetch = async (input, init) => {\n    const url = typeof input === 'string' ? input : input.url;\n    if (!url.startsWith(TARGET_ORIGIN + '/')) return orig(input, init);\n    const redirected = url.replace(TARGET_ORIGIN, MOCK_ORIGIN);\n    const res = await orig(redirected, init);\n    if (await isMiss(res)) return orig(input, init);\n    return res;\n  };\n  console.log('[Ruf] Local mock redirect is enabled for', TARGET_ORIGIN);\n})();`
  }, [status?.baseUrl, targetOrigin])

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
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={loading || !!status?.running}
                onClick={async () => {
                  setLoading(true)
                  setInfo('')
                  setError('')
                  try {
                    const next = await startLocalMockServer(7777)
                    setStatus(next)
                    setInfo(`Local server started: ${next.baseUrl}`)
                  } catch (e) {
                    setError((e as Error | null)?.message || 'Failed to start local server')
                  } finally {
                    setLoading(false)
                  }
                }}
              >
                Start
              </button>
              <button
                type="button"
                disabled={loading || !status?.running}
                onClick={async () => {
                  setLoading(true)
                  setInfo('')
                  setError('')
                  try {
                    const next = await stopLocalMockServer()
                    setStatus(next)
                    setRoutes([])
                    setLogs([])
                    setInfo('Local server stopped')
                  } catch (e) {
                    setError((e as Error | null)?.message || 'Failed to stop local server')
                  } finally {
                    setLoading(false)
                  }
                }}
              >
                Stop
              </button>
            </div>

            <div className="small" style={{ opacity: 0.85 }}>
              Status: <span className="mono">{status?.running ? `RUNNING ${status.baseUrl}` : 'STOPPED'}</span>
              {status?.running ? <span> / routes: <span className="mono">{status.routesCount}</span></span> : null}
            </div>

            {info ? <div className="small" style={{ color: '#9ad19a' }}>{info}</div> : null}
            {error ? <div className="small" style={{ color: '#ff9a9a' }}>{error}</div> : null}

            <div style={{ display: 'grid', gap: 8 }}>
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
                          disabled={deleting || loading || !status?.running}
                          onClick={async () => {
                            setDeletingRouteKey(key)
                            setInfo('')
                            setError('')
                            try {
                              const nextStatus = await deleteLocalMockRoute({
                                method: route.method,
                                path: route.path,
                              })
                              setStatus(nextStatus)
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
            <div className="small" style={{ opacity: 0.75 }}>
              Target origin: <span className="mono">{targetOrigin || 'not detected (fallback: https://api.example.com)'}</span>
            </div>
            <textarea className="mono" rows={8} readOnly value={devtoolsSnippet} style={{ width: '100%', boxSizing: 'border-box', opacity: 0.9 }} />

            <div className="small" style={{ opacity: 0.82 }}>Server logs:</div>
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
          </div>
        </div>
      </section>
    </>
  )
}
