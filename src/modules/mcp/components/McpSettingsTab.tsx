import { useState } from 'react'
import type { McpServerSettings } from '../../../shared/utils/appSettings'
import { FoldersCollapseIcon, FoldersExpandIcon, PlayIcon, ReloadIcon } from '../../../shared/icons'
import { uid } from '../../../shared/utils/id'
import { reconnectMcpServer, testMcpServerConnection } from '../services/mcp'

type Props = {
  value: McpServerSettings[]
  onChange: (next: McpServerSettings[] | ((prev: McpServerSettings[]) => McpServerSettings[])) => void
}

function createCustomServer(): McpServerSettings {
  return {
    id: uid('mcp'),
    name: 'Custom MCP Server',
    enabled: false,
    template: 'custom',
    command: '',
    args: [],
    env: {},
    bugReportCloudId: '',
    bugReportProjectKey: '',
    bugReportIssueType: 'Bug',
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

function formatEnv(env: Record<string, string>) {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function parseEnv(value: string) {
  const out: Record<string, string> = {}
  value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      const eqIndex = line.indexOf('=')
      if (eqIndex <= 0) return
      const key = line.slice(0, eqIndex).trim()
      const envValue = line.slice(eqIndex + 1)
      if (!key) return
      out[key] = envValue
    })
  return out
}

export function McpSettingsTab(props: Props) {
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({})
  const [busyActionById, setBusyActionById] = useState<Record<string, 'test' | 'reconnect' | null>>({})
  const [messageById, setMessageById] = useState<Record<string, string | null>>({})
  const [errorById, setErrorById] = useState<Record<string, string | null>>({})

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

  async function runServerAction(server: McpServerSettings, action: 'test' | 'reconnect') {
    if (busyActionById[server.id]) return
    setBusyActionById(prev => ({ ...prev, [server.id]: action }))
    setMessageById(prev => ({ ...prev, [server.id]: null }))
    setErrorById(prev => ({ ...prev, [server.id]: null }))
    try {
      const message = action === 'test'
        ? await testMcpServerConnection(server)
        : await reconnectMcpServer(server)
      setMessageById(prev => ({ ...prev, [server.id]: message }))
    } catch (error) {
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

      {props.value.map(server => (
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
            <b>{server.name || (server.template === 'atlassian' ? 'Atlassian MCP' : 'Custom MCP Server')}</b>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="iconBtn"
                onClick={() => void runServerAction(server, 'test')}
                disabled={!!busyActionById[server.id]}
                aria-label={busyActionById[server.id] === 'test' ? 'Testing MCP server' : 'Test MCP server'}
                title={busyActionById[server.id] === 'test' ? 'Testing...' : 'Test'}
              >
                <PlayIcon size={16} />
              </button>
              <button
                type="button"
                className="iconBtn"
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
              <div className="settingsTable">
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
                      <span>Start this MCP server when used</span>
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
                    <textarea
                      className="mono modalTextarea"
                      value={formatEnv(server.env)}
                      onChange={event => updateServer(server.id, { env: parseEnv(event.target.value) })}
                      rows={4}
                      placeholder="KEY=value"
                    />
                  </div>
                </div>

              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => removeServer(server.id)}>Delete</button>
              </div>
            </>
          ) : null}
        </div>
      ))}
    </div>
  )
}
