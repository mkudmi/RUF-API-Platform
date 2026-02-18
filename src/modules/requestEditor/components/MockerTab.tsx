import { useEffect, useMemo, useState } from 'react'
import type { VariableSuggestion } from '../../../shared/utils/variables'
import { ValueHistorySelect } from '../../../shared/components/ValueHistorySelect'
import { JsonCodeEditor } from './JsonCodeEditor'
import {
  addPreparedLocalMockRoute,
  getLocalMockServerBaseUrl,
  LOCAL_MOCK_METHOD_OPTIONS,
  LOCAL_MOCK_PRIMARY_PORT,
  normalizeLocalMockHttpStatus,
  normalizeLocalMockRouteBodyToJson,
  normalizeLocalMockRoutePath,
  getLocalMockServerStatus,
  listConfiguredLocalMockAdditionalPorts,
  listLocalMockAdditionalServers,
  onLocalMockServerUpdated,
  setLocalMockTargetOrigin,
  setLocalMockRoute,
} from '../utils/localMockServer'

const EMPTY_VARIABLE_SUGGESTIONS: VariableSuggestion[] = []

type MockerTabProps = {
  requestId: string
  routeMethodDefault: string
  routePathDefault: string
  targetOriginDefault: string
}

type ServerOption = {
  port: number
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
    { port: LOCAL_MOCK_PRIMARY_PORT, baseUrl: getLocalMockServerBaseUrl(LOCAL_MOCK_PRIMARY_PORT), running: false },
  ])
  const [selectedServerPort, setSelectedServerPort] = useState(LOCAL_MOCK_PRIMARY_PORT)

  async function refreshMockServersState() {
    const configuredAdditionalPorts = listConfiguredLocalMockAdditionalPorts()
    const [statusResult, additionalResult] = await Promise.allSettled([
      getLocalMockServerStatus(),
      listLocalMockAdditionalServers(),
    ])
    const status = statusResult.status === 'fulfilled'
      ? statusResult.value
      : { running: false, port: LOCAL_MOCK_PRIMARY_PORT, baseUrl: getLocalMockServerBaseUrl(LOCAL_MOCK_PRIMARY_PORT), routesCount: 0 }
    const additional = additionalResult.status === 'fulfilled'
      ? additionalResult.value
      : []

    try {
      const primaryPort = status.port > 0 ? status.port : LOCAL_MOCK_PRIMARY_PORT
      const primaryOption: ServerOption = {
        port: primaryPort,
        baseUrl: getLocalMockServerBaseUrl(primaryPort, status.baseUrl),
        running: !!status.running,
      }
      const additionalByPort = new Map<number, ServerOption>()
      for (const server of additional) {
        additionalByPort.set(server.port, {
          port: server.port,
          baseUrl: getLocalMockServerBaseUrl(server.port, server.baseUrl),
          running: !!server.running,
        })
      }
      for (const port of configuredAdditionalPorts) {
        if (additionalByPort.has(port)) continue
        additionalByPort.set(port, {
          port,
          baseUrl: getLocalMockServerBaseUrl(port),
          running: false,
        })
      }
      const additionalOptions = Array.from(additionalByPort.values())

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
          : (nextOptions.find(x => x.running)?.port ?? nextOptions[0]?.port ?? LOCAL_MOCK_PRIMARY_PORT)
      ))
      if (statusResult.status === 'rejected' || additionalResult.status === 'rejected') {
        setLocalServerError('Some local mock server data is temporarily unavailable')
      } else {
        setLocalServerError('')
      }
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
  const selectedServerLabel = selectedServer
    ? `${getLocalMockServerBaseUrl(selectedServer.port, selectedServer.baseUrl)}`
    : `Server (${selectedServerPort})`

  return (
    <div className="accordion">
      <div className="section" style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontWeight: 600, opacity: 0.95 }}>Local Mock Server</div>
          <div style={{ display: 'grid', gap: 6, width: 'min(360px, 50%)', minWidth: 220 }}>
            <ValueHistorySelect
              value={selectedServerPort}
              valueLabel={selectedServerLabel}
              ariaLabel="Select server"
              title="Select server"
              panelPosition="fixed"
              valueAdornment={selectedServer?.running ? <span className="localMockStatusDot localMockStatusDotRunning" /> : null}
              options={serverOptions.map(server => ({
                value: server.port,
                label: getLocalMockServerBaseUrl(server.port, server.baseUrl),
                right: server.running ? <span className="localMockStatusDot localMockStatusDotRunning" /> : undefined,
              }))}
              onChange={setSelectedServerPort}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, alignItems: 'center' }}>
          <div className="small" style={{ opacity: 0.78 }}>Route Method</div>
          <ValueHistorySelect
            value={localRouteMethod}
            valueLabel={localRouteMethod}
            ariaLabel="Select route method"
            title="Select route method"
            panelPosition="fixed"
            options={LOCAL_MOCK_METHOD_OPTIONS.map(option => ({ value: option, label: option }))}
            onChange={setLocalRouteMethod}
          />

          <div className="small" style={{ opacity: 0.78 }}>Route Path</div>
          <input className="mono" value={localRoutePath} onChange={e => setLocalRoutePath(e.target.value)} placeholder="/api/v3/pet/2" />

          <div className="small" style={{ opacity: 0.78 }}>Status</div>
          <input className="mono" value={localRouteStatus} onChange={e => setLocalRouteStatus(e.target.value)} placeholder="200" />
        </div>

        <JsonCodeEditor
          value={localRouteBody}
          onChangeValue={setLocalRouteBody}
          variableSuggestions={EMPTY_VARIABLE_SUGGESTIONS}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            disabled={localServerLoading}
            onClick={async () => {
              setLocalServerLoading(true)
              setLocalServerInfo('')
              setLocalServerError('')
              try {
                const normalizedJsonBody = normalizeLocalMockRouteBodyToJson(localRouteBody)
                const routePayload = {
                  method: localRouteMethod,
                  path: normalizeLocalMockRoutePath(localRoutePath),
                  port: selectedServerPort,
                  status: normalizeLocalMockHttpStatus(localRouteStatus, 200),
                  headers: [['Content-Type', 'application/json']] as Array<[string, string]>,
                  body: normalizedJsonBody,
                }
                if (normalizedJsonBody !== localRouteBody) setLocalRouteBody(normalizedJsonBody)
                if (selectedServer?.running) {
                  await setLocalMockRoute(routePayload)
                  addPreparedLocalMockRoute(routePayload)
                  setLocalServerInfo(`Route published to port ${selectedServerPort}: ${localRouteMethod} ${routePayload.path}`)
                  await refreshMockServersState()
                } else {
                  addPreparedLocalMockRoute(routePayload)
                  setLocalServerInfo(`Route queued for port ${selectedServerPort}: ${localRouteMethod} ${routePayload.path}`)
                }
              } catch (error) {
                setLocalServerError((error as Error | null)?.message || 'Failed to publish route')
              } finally {
                setLocalServerLoading(false)
              }
            }}
          >
            {selectedServer?.running ? 'Publish Route' : 'Queue Route'}
          </button>
        </div>

        {localServerInfo ? <div className="small" style={{ color: '#9ad19a' }}>{localServerInfo}</div> : null}
        {localServerError ? <div className="small" style={{ color: '#ff9a9a' }}>{localServerError}</div> : null}
      </div>
    </div>
  )
}
