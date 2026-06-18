import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_POSTGRES_MCP_SERVER_SETTINGS,
  type McpEnvEntry,
  type McpServerSettings,
} from '../../../shared/utils/appSettings'
import { CloseIcon, FoldersCollapseIcon, FoldersExpandIcon, PlayIcon, ReloadIcon } from '../../../shared/icons'
import { uid } from '../../../shared/utils/id'
import { getMcpServerStatus, listMcpServerTools, reconnectMcpServer, startMcpServer, stopMcpServer } from '../services/mcp'
import type { McpToolDescriptor } from '../types'

type Props = {
  value: McpServerSettings[]
  onChange: (next: McpServerSettings[] | ((prev: McpServerSettings[]) => McpServerSettings[])) => void
}

type ServerAction = 'start' | 'stop' | 'test' | 'reconnect'
type ActionIndicatorState = 'idle' | 'loading' | 'success' | 'error'

function createCustomServer(): McpServerSettings {
  return {
    id: uid('mcp'),
    name: 'Custom MCP Server',
    enabled: false,
    template: 'custom',
    command: '',
    args: [],
    env: {},
    envEntries: [],
    bugReportCloudId: '',
    bugReportProjectKey: '',
    bugReportIssueType: 'Bug',
  }
}

function createPostgresServer(): McpServerSettings {
  return {
    ...DEFAULT_POSTGRES_MCP_SERVER_SETTINGS,
    env: { ...DEFAULT_POSTGRES_MCP_SERVER_SETTINGS.env },
    args: [...DEFAULT_POSTGRES_MCP_SERVER_SETTINGS.args],
    envEntries: DEFAULT_POSTGRES_MCP_SERVER_SETTINGS.envEntries?.map(entry => ({ ...entry })) ?? [],
  }
}

function formatArgs(args: string[]) {
  return args.join('\n')
}

function parseArgs(value: string) {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function getEnvEntries(server: McpServerSettings): McpEnvEntry[] {
  if (Array.isArray(server.envEntries)) return server.envEntries
  return Object.entries(server.env).map(([key, value]) => ({ key, value }))
}

function toEnvRecord(entries: McpEnvEntry[]) {
  const out: Record<string, string> = {}
  for (const entry of entries) {
    const key = entry.key.trim()
    if (!key) continue
    out[key] = entry.value
  }
  return out
}

function syncEnv(entries: McpEnvEntry[]) {
  return {
    envEntries: entries,
    env: toEnvRecord(entries),
  } satisfies Pick<McpServerSettings, 'envEntries' | 'env'>
}

const POSTGRES_ENV_FIELDS = ['DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT', 'DB_NAME'] as const

function getEnvValue(server: McpServerSettings, key: string) {
  return getEnvEntries(server).find(entry => entry.key.trim() === key)?.value ?? ''
}

function updateNamedEnvEntry(server: McpServerSettings, key: string, value: string) {
  const entries = getEnvEntries(server)
  const index = entries.findIndex(entry => entry.key.trim() === key)
  if (index >= 0) {
    const nextEntries = entries.map((entry, entryIndex) => (entryIndex === index ? { key, value } : entry))
    return syncEnv(nextEntries)
  }
  return syncEnv([...entries, { key, value }])
}

export function McpSettingsTab(props: Props) {
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({})
  const [toolsMenuOpenById, setToolsMenuOpenById] = useState<Record<string, boolean>>({})
  const [busyActionById, setBusyActionById] = useState<Record<string, ServerAction | null>>({})
  const [messageById, setMessageById] = useState<Record<string, string | null>>({})
  const [errorById, setErrorById] = useState<Record<string, string | null>>({})
  const [actionStateByKey, setActionStateByKey] = useState<Record<string, ActionIndicatorState>>({})
  const [runningById, setRunningById] = useState<Record<string, boolean>>({})
  const [serverNameById, setServerNameById] = useState<Record<string, string | null>>({})
  const [toolsById, setToolsById] = useState<Record<string, McpToolDescriptor[]>>({})
  const [selectedToolById, setSelectedToolById] = useState<Record<string, string>>({})
  const resetTimerByKeyRef = useRef<Record<string, number>>({})

  useEffect(() => {
    if (props.value.some(server => server.template === 'postgres')) return

    props.onChange(prev => {
      if (prev.some(server => server.template === 'postgres')) return prev

      const atlassianIndex = prev.findIndex(server => server.template === 'atlassian')
      const insertIndex = atlassianIndex >= 0 ? atlassianIndex + 1 : prev.length
      const next = [...prev]
      next.splice(insertIndex, 0, createPostgresServer())
      return next
    })
  }, [props.onChange, props.value])

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(resetTimerByKeyRef.current)) {
        window.clearTimeout(timerId)
      }
    }
  }, [])

  useEffect(() => {
    function handlePointerDown() {
      setToolsMenuOpenById({})
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const server of props.value) {
        try {
          const status = await getMcpServerStatus(server)
          if (cancelled) return
          setRunningById(prev => ({ ...prev, [server.id]: status.running }))
          setServerNameById(prev => ({ ...prev, [server.id]: status.serverName ?? null }))
          if (status.running) {
            const toolsResult = await listMcpServerTools(server)
            if (cancelled) return
            setToolsById(prev => ({ ...prev, [server.id]: toolsResult.tools }))
            setSelectedToolById(prev => ({
              ...prev,
              [server.id]: prev[server.id] && toolsResult.tools.some(tool => tool.name === prev[server.id])
                ? prev[server.id]
                : (toolsResult.tools[0]?.name ?? ''),
            }))
          } else {
            setToolsById(prev => ({ ...prev, [server.id]: [] }))
            setSelectedToolById(prev => ({ ...prev, [server.id]: '' }))
          }
        } catch {
          if (cancelled) return
          setRunningById(prev => ({ ...prev, [server.id]: false }))
          setToolsById(prev => ({ ...prev, [server.id]: [] }))
          setSelectedToolById(prev => ({ ...prev, [server.id]: '' }))
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [props.value])

  function getActionKey(serverId: string, action: ServerAction) {
    return `${serverId}:${action}`
  }

  function clearActionResetTimer(serverId: string, action: ServerAction) {
    const key = getActionKey(serverId, action)
    const timerId = resetTimerByKeyRef.current[key]
    if (!timerId) return
    window.clearTimeout(timerId)
    delete resetTimerByKeyRef.current[key]
  }

  function setActionState(serverId: string, action: ServerAction, state: ActionIndicatorState) {
    const key = getActionKey(serverId, action)
    setActionStateByKey(prev => ({ ...prev, [key]: state }))
  }

  function scheduleActionReset(serverId: string, action: ServerAction) {
    const key = getActionKey(serverId, action)
    clearActionResetTimer(serverId, action)
    resetTimerByKeyRef.current[key] = window.setTimeout(() => {
      setActionStateByKey(prev => ({ ...prev, [key]: 'idle' }))
      delete resetTimerByKeyRef.current[key]
    }, 5_000)
  }

  function getActionClassName(serverId: string, action: ServerAction, variant: 'icon' | 'text') {
    const state = actionStateByKey[getActionKey(serverId, action)] ?? 'idle'
    const base = variant === 'icon' ? 'iconBtn' : 'mcpTextActionBtn'
    return `${base} mcpActionBtn mcpActionBtn${state[0].toUpperCase()}${state.slice(1)}`
  }

  function updateServer(id: string, patch: Partial<McpServerSettings>) {
    props.onChange(prev => prev.map(server => (server.id === id ? { ...server, ...patch } : server)))
  }

  function addCustomServer() {
    props.onChange(prev => [...prev, createCustomServer()])
  }

  function removeServer(id: string) {
    props.onChange(prev => prev.filter(server => server.id !== id))
  }

  function toggleExpanded(id: string) {
    setExpandedById(prev => ({ ...prev, [id]: !(prev[id] ?? false) }))
  }

  function toggleToolsMenu(id: string) {
    setToolsMenuOpenById(prev => ({ ...prev, [id]: !(prev[id] ?? false) }))
  }

  function closeToolsMenu(id: string) {
    setToolsMenuOpenById(prev => ({ ...prev, [id]: false }))
  }

  function updateEnvEntries(server: McpServerSettings, entries: McpEnvEntry[]) {
    updateServer(server.id, syncEnv(entries))
  }

  function addEnvEntry(server: McpServerSettings) {
    updateEnvEntries(server, [...getEnvEntries(server), { key: '', value: '' }])
  }

  function updateEnvEntry(server: McpServerSettings, index: number, patch: Partial<McpEnvEntry>) {
    const nextEntries = getEnvEntries(server).map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, ...patch } : entry
    ))
    updateEnvEntries(server, nextEntries)
  }

  function removeEnvEntry(server: McpServerSettings, index: number) {
    const nextEntries = getEnvEntries(server).filter((_, entryIndex) => entryIndex !== index)
    updateEnvEntries(server, nextEntries)
  }

  async function runServerAction(server: McpServerSettings, action: ServerAction) {
    if (busyActionById[server.id]) return
    clearActionResetTimer(server.id, action)
    setBusyActionById(prev => ({ ...prev, [server.id]: action }))
    setMessageById(prev => ({ ...prev, [server.id]: null }))
    setErrorById(prev => ({ ...prev, [server.id]: null }))
    setActionState(server.id, action, 'loading')

    try {
      if (action === 'start') {
        const result = await startMcpServer(server)
        setRunningById(prev => ({ ...prev, [server.id]: true }))
        setServerNameById(prev => ({ ...prev, [server.id]: result.serverName }))
        setToolsById(prev => ({ ...prev, [server.id]: result.tools }))
        setSelectedToolById(prev => ({ ...prev, [server.id]: result.tools[0]?.name ?? '' }))
        setMessageById(prev => ({
          ...prev,
          [server.id]: `Started ${result.serverName}. ${result.tools.length} tool${result.tools.length === 1 ? '' : 's'} available.`,
        }))
      } else if (action === 'stop') {
        await stopMcpServer(server)
        setRunningById(prev => ({ ...prev, [server.id]: false }))
        setServerNameById(prev => ({ ...prev, [server.id]: null }))
        setToolsById(prev => ({ ...prev, [server.id]: [] }))
        setSelectedToolById(prev => ({ ...prev, [server.id]: '' }))
        setMessageById(prev => ({ ...prev, [server.id]: 'MCP server stopped.' }))
      } else if (action === 'test') {
        const result = await listMcpServerTools(server)
        setRunningById(prev => ({ ...prev, [server.id]: true }))
        setServerNameById(prev => ({ ...prev, [server.id]: result.serverName }))
        setToolsById(prev => ({ ...prev, [server.id]: result.tools }))
        setSelectedToolById(prev => ({ ...prev, [server.id]: result.tools[0]?.name ?? '' }))
        setMessageById(prev => ({
          ...prev,
          [server.id]: `Connected to ${result.serverName}. ${result.tools.length} tool${result.tools.length === 1 ? '' : 's'} available.`,
        }))
      } else {
        const message = await reconnectMcpServer(server)
        const toolsResult = await listMcpServerTools(server)
        const status = await getMcpServerStatus(server)
        setRunningById(prev => ({ ...prev, [server.id]: status.running }))
        setServerNameById(prev => ({ ...prev, [server.id]: status.serverName ?? null }))
        setToolsById(prev => ({ ...prev, [server.id]: toolsResult.tools }))
        setSelectedToolById(prev => ({
          ...prev,
          [server.id]: prev[server.id] && toolsResult.tools.some(tool => tool.name === prev[server.id])
            ? prev[server.id]
            : (toolsResult.tools[0]?.name ?? ''),
        }))
        setMessageById(prev => ({ ...prev, [server.id]: message }))
      }

      setActionState(server.id, action, 'success')
      scheduleActionReset(server.id, action)
    } catch (error) {
      setActionState(server.id, action, 'error')
      if (action === 'stop') {
        setRunningById(prev => ({ ...prev, [server.id]: false }))
      } else {
        setRunningById(prev => ({ ...prev, [server.id]: false }))
        setServerNameById(prev => ({ ...prev, [server.id]: null }))
        setToolsById(prev => ({ ...prev, [server.id]: [] }))
        setSelectedToolById(prev => ({ ...prev, [server.id]: '' }))
      }
      setErrorById(prev => ({
        ...prev,
        [server.id]: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setBusyActionById(prev => ({ ...prev, [server.id]: null }))
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={addCustomServer}>Add Server</button>
      </div>

      {props.value.map(server => {
        const isRunning = runningById[server.id] ?? false
        const currentServerName = serverNameById[server.id]
        const tools = toolsById[server.id] ?? []
        const selectedTool = selectedToolById[server.id] ?? ''
        const selectedToolLabel = tools.find(tool => tool.name === selectedTool)?.name ?? ''
        const toolsMenuOpen = toolsMenuOpenById[server.id] ?? false

        return (
          <div
            key={server.id}
            style={{
              display: 'grid',
              gap: 12,
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12,
              padding: 14,
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <b style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {server.name || (server.template === 'atlassian'
                    ? 'Atlassian MCP'
                    : server.template === 'postgres'
                      ? 'Postgres MCP'
                      : 'Custom MCP Server')}
                </b>
                <span className={`localMockStatusDot ${isRunning ? 'localMockStatusDotRunning' : 'localMockStatusDotStopped'}`} aria-hidden="true" />
                {currentServerName && isRunning ? (
                  <span
                    className="small mono"
                    style={{ opacity: 0.72, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={currentServerName}
                  >
                    {currentServerName}
                  </span>
                ) : null}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={getActionClassName(server.id, isRunning ? 'stop' : 'start', 'text')}
                  onClick={() => void runServerAction(server, isRunning ? 'stop' : 'start')}
                  disabled={!!busyActionById[server.id]}
                  title={isRunning ? 'Stop MCP server' : 'Start MCP server'}
                >
                  {isRunning ? 'Stop' : 'Start'}
                </button>
                <button
                  type="button"
                  className={getActionClassName(server.id, 'test', 'icon')}
                  onClick={() => void runServerAction(server, 'test')}
                  disabled={!!busyActionById[server.id]}
                  aria-label={busyActionById[server.id] === 'test' ? 'Testing MCP server' : 'Test MCP server'}
                  title={busyActionById[server.id] === 'test' ? 'Testing...' : 'Test'}
                >
                  <PlayIcon size={16} />
                </button>
                <button
                  type="button"
                  className={getActionClassName(server.id, 'reconnect', 'icon')}
                  onClick={() => void runServerAction(server, 'reconnect')}
                  disabled={!!busyActionById[server.id]}
                  aria-label={busyActionById[server.id] === 'reconnect' ? 'Reconnecting MCP server' : 'Reconnect MCP server'}
                  title={busyActionById[server.id] === 'reconnect' ? 'Reconnecting...' : 'Reconnect'}
                >
                  <ReloadIcon size={16} />
                </button>
                <button
                  type="button"
                  className="iconBtn"
                  onClick={() => toggleExpanded(server.id)}
                  aria-label={expandedById[server.id] ? 'Collapse MCP server' : 'Expand MCP server'}
                  title={expandedById[server.id] ? 'Collapse' : 'Expand'}
                >
                  {expandedById[server.id] ? <FoldersCollapseIcon size={16} /> : <FoldersExpandIcon size={16} />}
                </button>
              </div>
            </div>

            {messageById[server.id] ? <div className="small" style={{ color: '#7ee0a1' }}>{messageById[server.id]}</div> : null}
            {errorById[server.id] ? <div className="small" style={{ color: '#ff9a9a', whiteSpace: 'pre-wrap' }}>{errorById[server.id]}</div> : null}

            {expandedById[server.id] ? (
              <>
                <div className="settingsTable mcpSettingsTable">
                  <div className="settingsTableRow">
                    <div className="settingsTableLabel">Enabled</div>
                    <div className="settingsTableValue">
                      <label className="checkRow">
                        <input
                          type="checkbox"
                          className="checkInput"
                          checked={server.enabled}
                          onChange={event => updateServer(server.id, { enabled: event.target.checked })}
                        />
                        <span className="checkBox" aria-hidden="true" />
                        <span>Keep this MCP server available when used</span>
                      </label>
                    </div>
                  </div>

                  <div className="settingsTableRow">
                    <div className="settingsTableLabel">Name</div>
                    <div className="settingsTableValue">
                      <input
                        className="mono"
                        value={server.name}
                        onChange={event => updateServer(server.id, { name: event.target.value })}
                        placeholder="My MCP Server"
                      />
                    </div>
                  </div>

                  <div className="settingsTableRow">
                    <div className="settingsTableLabel">Command</div>
                    <div className="settingsTableValue">
                      <input
                        className="mono"
                        value={server.command}
                        onChange={event => updateServer(server.id, { command: event.target.value })}
                        placeholder="npx"
                      />
                    </div>
                  </div>

                  <div className="settingsTableRow">
                    <div className="settingsTableLabel">Arguments</div>
                    <div className="settingsTableValue">
                      <textarea
                        className="mono modalTextarea"
                        value={formatArgs(server.args)}
                        onChange={event => updateServer(server.id, { args: parseArgs(event.target.value) })}
                        rows={4}
                        placeholder="-y&#10;mcp-remote@latest&#10;https://mcp.atlassian.com/v1/mcp/authv2"
                      />
                    </div>
                  </div>

                  <div className="settingsTableRow">
                    <div className="settingsTableLabel">Environment</div>
                    <div className="settingsTableValue">
                      {server.template === 'postgres' ? (
                        <div className="mcpEnvEditor">
                          {POSTGRES_ENV_FIELDS.map(field => (
                            <div key={`${server.id}:env:${field}`} className="mcpEnvRow">
                              <input
                                className="mono mcpEnvInput"
                                value={field}
                                readOnly
                                aria-label={`${field} key`}
                              />
                              <input
                                className="mono mcpEnvInput"
                                value={getEnvValue(server, field)}
                                onChange={event => updateServer(server.id, updateNamedEnvEntry(server, field, event.target.value))}
                                placeholder={field === 'DB_PORT' ? '5432' : 'value'}
                                type={field === 'DB_PASSWORD' ? 'password' : 'text'}
                                aria-label={field}
                              />
                            </div>
                          ))}
                          <div className="small" style={{ opacity: 0.72 }}>
                            DATABASE_URI is built automatically as `postgresql://user:password@host:port/db`
                          </div>
                        </div>
                      ) : (
                        <div className="mcpEnvEditor">
                          {getEnvEntries(server).map((entry, index) => (
                            <div key={`${server.id}:env:${index}`} className="mcpEnvRow">
                              <input
                                className="mono mcpEnvInput"
                                value={entry.key}
                                onChange={event => updateEnvEntry(server, index, { key: event.target.value })}
                                placeholder="KEY"
                              />
                              <input
                                className="mono mcpEnvInput"
                                value={entry.value}
                                onChange={event => updateEnvEntry(server, index, { value: event.target.value })}
                                placeholder="value"
                              />
                              <button type="button" className="iconBtn mcpEnvDeleteBtn" onClick={() => removeEnvEntry(server, index)} aria-label="Delete environment entry" title="Delete">
                                <CloseIcon size={16} />
                              </button>
                            </div>
                          ))}
                          <div className="mcpEnvActions">
                            <button type="button" className="mcpTextActionBtn mcpEnvAddBtn" onClick={() => addEnvEntry(server)}>Add variable</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="settingsTableRow">
                    <div className="settingsTableLabel">Tools</div>
                    <div className="settingsTableValue">
                      <div className="mcpToolsFieldRow">
                        <div className="selectMenuWrap mcpToolsMenuWrap">
                          <button
                            type="button"
                            className="selectMenuBtn mono mcpToolsSelect"
                            disabled={!isRunning || !!busyActionById[server.id] || tools.length === 0}
                            onPointerDown={event => event.stopPropagation()}
                            onClick={event => {
                              event.preventDefault()
                              event.stopPropagation()
                              if (!isRunning || busyActionById[server.id] || tools.length === 0) return
                              toggleToolsMenu(server.id)
                            }}
                            aria-haspopup="menu"
                            aria-expanded={toolsMenuOpen}
                            title={selectedToolLabel || (tools.length === 0 ? 'No tools' : 'Select tool')}
                          >
                            {selectedToolLabel || (tools.length === 0 ? 'No tools' : 'Select tool')}
                          </button>
                          {toolsMenuOpen ? (
                            <div
                              className="selectMenuPanel mcpToolsMenuPanel"
                              role="menu"
                              onPointerDown={event => {
                                event.preventDefault()
                                event.stopPropagation()
                              }}
                              onClick={event => {
                                event.preventDefault()
                                event.stopPropagation()
                              }}
                            >
                              {tools.map(tool => (
                                <button
                                  key={tool.name}
                                  type="button"
                                  className={`selectMenuItem ${selectedTool === tool.name ? 'selectMenuItemActive' : ''}`}
                                  role="menuitemradio"
                                  aria-checked={selectedTool === tool.name}
                                  onClick={() => {
                                    setSelectedToolById(prev => ({ ...prev, [server.id]: tool.name }))
                                    closeToolsMenu(server.id)
                                  }}
                                >
                                  <span className="mono">{tool.name}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <span className="small mcpToolsCount" title={`${tools.length} tool${tools.length === 1 ? '' : 's'} available`}>
                          {tools.length}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => removeServer(server.id)}>Delete</button>
                </div>
              </>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
