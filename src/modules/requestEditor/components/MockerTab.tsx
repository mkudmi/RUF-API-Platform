import { useEffect, useMemo, useState } from 'react'
import {
  getLocalMockServerStatus,
  listLocalMockAdditionalServers,
  onLocalMockServerUpdated,
  setLocalMockTargetOrigin,
  setLocalMockRoute,
} from '../utils/localMockServer'

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

type MockerTabProps = {
  requestId: string
  routeMethodDefault: string
  routePathDefault: string
  targetOriginDefault: string
}

type ServerOption = {
  port: number
  label: string
  baseUrl: string
  running: boolean
}

export function MockerTab(props: MockerTabProps) {
  const [localServerLoading, setLocalServerLoading] = useState(false)
  const [localRouteMethod, setLocalRouteMethod] = useState((props.routeMethodDefault || 'GET').toUpperCase())
  const [localRoutePath, setLocalRoutePath] = useState(props.routePathDefault || '/')
  const [localRouteStatus, setLocalRouteStatus] = useState('200')
  const [localRouteBody, setLocalRouteBody] = useState('{}')
  const [localServerError, setLocalServerError] = useState('')
  const [localServerInfo, setLocalServerInfo] = useState('')
  const [serverOptions, setServerOptions] = useState<ServerOption[]>([
    { port: 7777, label: 'Server 1', baseUrl: 'http://127.0.0.1:7777', running: false },
  ])
  const [selectedServerPort, setSelectedServerPort] = useState(7777)

  async function refreshMockServersState() {
    try {
      const [status, additional] = await Promise.all([
        getLocalMockServerStatus(),
        listLocalMockAdditionalServers(),
      ])

      const primaryPort = status.port > 0 ? status.port : 7777
      const primaryOption: ServerOption = {
        port: primaryPort,
        label: 'Server 1',
        baseUrl: status.baseUrl || `http://127.0.0.1:${primaryPort}`,
        running: !!status.running,
      }
      const additionalOptions: ServerOption[] = additional.map(server => ({
        port: server.port,
        label: `Server ${server.port}`,
        baseUrl: server.baseUrl,
        running: !!server.running,
      }))

      const nextOptions = [primaryOption, ...additionalOptions]
        .reduce<ServerOption[]>((acc, item) => {
          if (acc.some(x => x.port === item.port)) return acc
          acc.push(item)
          return acc
        }, [])
        .sort((a, b) => a.port - b.port)

      setServerOptions(nextOptions)
      setSelectedServerPort(prev => (
        nextOptions.some(x => x.port === prev)
          ? prev
          : (nextOptions.find(x => x.running)?.port ?? nextOptions[0]?.port ?? 7777)
      ))
      setLocalServerError('')
    } catch (error) {
      setLocalServerError((error as Error | null)?.message || 'Failed to read local mock server state')
    }
  }

  useEffect(() => {
    void refreshMockServersState()
  }, [])

  useEffect(() => {
    return onLocalMockServerUpdated(() => {
      void refreshMockServersState()
    })
  }, [])

  useEffect(() => {
    setLocalRouteMethod((props.routeMethodDefault || 'GET').toUpperCase())
    setLocalRoutePath(props.routePathDefault || '/')
  }, [props.requestId, props.routeMethodDefault, props.routePathDefault])

  useEffect(() => {
    setLocalMockTargetOrigin(props.targetOriginDefault || '')
  }, [props.requestId, props.targetOriginDefault])

  const selectedServer = useMemo(
    () => serverOptions.find(s => s.port === selectedServerPort) ?? null,
    [selectedServerPort, serverOptions],
  )

  return (
    <div className="accordion">
      <div className="section" style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontWeight: 600, opacity: 0.95 }}>Local Mock Server</div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div className="small" style={{ opacity: 0.78 }}>Server</div>
          <select
            className="mono"
            value={String(selectedServerPort)}
            onChange={e => setSelectedServerPort(Number.parseInt(e.target.value, 10) || 7777)}
          >
            {serverOptions.map(server => (
              <option key={server.port} value={String(server.port)}>
                {server.running ? '🟢 ' : ''}{server.label} ({server.port})
              </option>
            ))}
          </select>
          <div className="small" style={{ opacity: 0.72 }}>
            {selectedServer?.baseUrl || 'http://127.0.0.1:7777'}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, alignItems: 'center' }}>
          <div className="small" style={{ opacity: 0.78 }}>Route Method</div>
          <select className="mono" value={localRouteMethod} onChange={e => setLocalRouteMethod(e.target.value.toUpperCase())}>
            {METHOD_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
          </select>

          <div className="small" style={{ opacity: 0.78 }}>Route Path</div>
          <input className="mono" value={localRoutePath} onChange={e => setLocalRoutePath(e.target.value)} placeholder="/api/v3/pet/2" />

          <div className="small" style={{ opacity: 0.78 }}>Status</div>
          <input className="mono" value={localRouteStatus} onChange={e => setLocalRouteStatus(e.target.value)} placeholder="200" />
        </div>

        <textarea
          className="mono"
          rows={8}
          value={localRouteBody}
          onChange={e => setLocalRouteBody(e.target.value)}
          placeholder="JSON body for localhost route"
          spellCheck={false}
          style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            disabled={localServerLoading || !selectedServer?.running}
            onClick={async () => {
              setLocalServerLoading(true)
              setLocalServerInfo('')
              setLocalServerError('')
              try {
                await setLocalMockRoute({
                  method: localRouteMethod,
                  path: localRoutePath,
                  port: selectedServerPort,
                  status: (() => {
                    const parsed = Number.parseInt(localRouteStatus.trim(), 10)
                    if (!Number.isFinite(parsed)) return 200
                    return Math.max(100, Math.min(599, parsed))
                  })(),
                  headers: [['Content-Type', 'application/json']],
                  body: localRouteBody,
                })
                setLocalServerInfo(`Route published to port ${selectedServerPort}: ${localRouteMethod} ${localRoutePath}`)
                await refreshMockServersState()
              } catch (error) {
                setLocalServerError((error as Error | null)?.message || 'Failed to publish route')
              } finally {
                setLocalServerLoading(false)
              }
            }}
          >
            Publish Route
          </button>
          {!selectedServer?.running ? (
            <div className="small" style={{ opacity: 0.72, alignSelf: 'center' }}>
              Selected server is stopped
            </div>
          ) : null}
        </div>

        {localServerInfo ? <div className="small" style={{ color: '#9ad19a' }}>{localServerInfo}</div> : null}
        {localServerError ? <div className="small" style={{ color: '#ff9a9a' }}>{localServerError}</div> : null}
      </div>
    </div>
  )
}
