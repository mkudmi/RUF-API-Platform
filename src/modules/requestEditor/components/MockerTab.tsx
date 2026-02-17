import { useEffect, useState } from 'react'
import {
  getLocalMockServerStatus,
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

export function MockerTab(props: MockerTabProps) {
  const [localServerLoading, setLocalServerLoading] = useState(false)
  const [localServerStatus, setLocalServerStatus] = useState<{
    running: boolean
    port: number
    baseUrl: string
    routesCount: number
  } | null>(null)
  const [localRouteMethod, setLocalRouteMethod] = useState((props.routeMethodDefault || 'GET').toUpperCase())
  const [localRoutePath, setLocalRoutePath] = useState(props.routePathDefault || '/')
  const [localRouteStatus, setLocalRouteStatus] = useState('200')
  const [localRouteBody, setLocalRouteBody] = useState('{}')
  const [localServerError, setLocalServerError] = useState('')
  const [localServerInfo, setLocalServerInfo] = useState('')

  async function refreshLocalServerStatus() {
    try {
      const status = await getLocalMockServerStatus()
      setLocalServerStatus(status)
      setLocalServerError('')
    } catch (error) {
      setLocalServerError((error as Error | null)?.message || 'Failed to read local mock server status')
    }
  }

  useEffect(() => {
    void refreshLocalServerStatus()
  }, [])

  useEffect(() => {
    return onLocalMockServerUpdated(() => {
      void refreshLocalServerStatus()
    })
  }, [])

  useEffect(() => {
    setLocalRouteMethod((props.routeMethodDefault || 'GET').toUpperCase())
    setLocalRoutePath(props.routePathDefault || '/')
  }, [props.requestId, props.routeMethodDefault, props.routePathDefault])

  useEffect(() => {
    setLocalMockTargetOrigin(props.targetOriginDefault || '')
  }, [props.requestId, props.targetOriginDefault])

  return (
    <div className="accordion">
      <div className="section" style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontWeight: 600, opacity: 0.95 }}>Local Mock Server</div>
        </div>

        <div className="small" style={{ opacity: 0.85 }}>
          Status: <span className="mono">{localServerStatus?.running ? `RUNNING ${localServerStatus.baseUrl}` : 'STOPPED'}</span>
          {localServerStatus?.running ? <span> / routes: <span className="mono">{localServerStatus.routesCount}</span></span> : null}
        </div>

        <div className="small" style={{ opacity: 0.78 }}>
          Start/stop server moved to sidebar tool "Local Mock Server". This tab only manages mock routes.
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
            disabled={localServerLoading || !localServerStatus?.running}
            onClick={async () => {
              setLocalServerLoading(true)
              setLocalServerInfo('')
              setLocalServerError('')
              try {
                const status = await setLocalMockRoute({
                  method: localRouteMethod,
                  path: localRoutePath,
                  status: (() => {
                    const parsed = Number.parseInt(localRouteStatus.trim(), 10)
                    if (!Number.isFinite(parsed)) return 200
                    return Math.max(100, Math.min(599, parsed))
                  })(),
                  headers: [['Content-Type', 'application/json']],
                  body: localRouteBody,
                })
                setLocalServerStatus(status)
                setLocalServerInfo(`Route published: ${localRouteMethod} ${localRoutePath}`)
              } catch (error) {
                setLocalServerError((error as Error | null)?.message || 'Failed to publish route')
              } finally {
                setLocalServerLoading(false)
              }
            }}
          >
            Publish Route
          </button>
        </div>

        {localServerInfo ? <div className="small" style={{ color: '#9ad19a' }}>{localServerInfo}</div> : null}
        {localServerError ? <div className="small" style={{ color: '#ff9a9a' }}>{localServerError}</div> : null}
      </div>
    </div>
  )
}
