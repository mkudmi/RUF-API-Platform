import { useEffect, useRef, useState } from 'react'
import { CloseIcon, StarIcon, TrashIcon } from '../../../shared/icons'
import type { AiProviderSettings, McpServerSettings } from '../../../shared/utils/appSettings'
import { loadLocalStorageJson, saveLocalStorageJson } from '../../../shared/utils/localStorageJson'
import { enhanceBugReportWithYandex } from '../../ai/provider'
import { getAtlassianMcpServer, isMcpServerConfigured, sendBugReportToAtlassianMcp } from '../services/mcp'

type Props = {
  open: boolean
  onClose: () => void
  aiSettings: AiProviderSettings
  mcpSettings: McpServerSettings[]
  openSettings: (tabId?: string) => void
}

const BUG_REPORT_PROJECT_KEYS_STORAGE_KEY = 'ruf_bug_report_project_keys_v1'

function loadProjectKeyHistory() {
  const parsed = loadLocalStorageJson<unknown>(BUG_REPORT_PROJECT_KEYS_STORAGE_KEY, [])
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 10)
}

function saveProjectKeyHistory(items: string[]) {
  saveLocalStorageJson(BUG_REPORT_PROJECT_KEYS_STORAGE_KEY, items.slice(0, 10))
}

function pushProjectKeyHistory(items: string[], projectKey: string) {
  const normalized = projectKey.trim().toUpperCase()
  if (!normalized) return items
  return [normalized, ...items.filter(item => item !== normalized)].slice(0, 10)
}

function removeProjectKeyHistoryItem(items: string[], projectKey: string) {
  const normalized = projectKey.trim().toUpperCase()
  if (!normalized) return items
  return items.filter(item => item !== normalized)
}

function buildInitialDescription() {
  return [
    'Описание проблемы:',
    '',
    'Шаги для воспроизведения:',
    '1.',
    '2.',
    '3.',
    '',
    'Фактический результат:',
    '',
    'Ожидаемый результат:',
    '',
  ].join('\n')
}

export function BugReportDialog(props: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const projectKeyHistoryWrapRef = useRef<HTMLDivElement | null>(null)
  const initialDescription = buildInitialDescription()
  const [projectKeyHistory, setProjectKeyHistory] = useState<string[]>(() => loadProjectKeyHistory())
  const [projectKey, setProjectKey] = useState<string>(() => loadProjectKeyHistory()[0] ?? '')
  const [projectKeyHistoryOpen, setProjectKeyHistoryOpen] = useState(false)
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState(initialDescription)
  const [busyMode, setBusyMode] = useState<'ai' | 'mcp' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    setDescription(initialDescription)
  }, [initialDescription])

  useEffect(() => {
    if (!projectKeyHistoryOpen) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (projectKeyHistoryWrapRef.current?.contains(target)) return
      setProjectKeyHistoryOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [projectKeyHistoryOpen])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (props.open) {
      const nextHistory = loadProjectKeyHistory()
      setProjectKeyHistory(nextHistory)
      setProjectKey(prev => prev || nextHistory[0] || '')
      setProjectKeyHistoryOpen(false)
      setSummary('')
      setDescription(initialDescription)
      setBusyMode(null)
      setError(null)
      setSuccess(null)
      if (!dialog.open) dialog.showModal()
      return
    }
    if (dialog.open) dialog.close()
  }, [initialDescription, props.open])

  async function handleEnhanceWithAi() {
    if (busyMode) return
    setBusyMode('ai')
    setError(null)
    setSuccess(null)
    try {
      const enhanced = await enhanceBugReportWithYandex(props.aiSettings, {
        summary,
        description,
      })
      setSummary(enhanced.summary)
      setDescription(enhanced.description)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setBusyMode(null)
    }
  }

  async function handleSendToJira() {
    if (busyMode) return
    setBusyMode('mcp')
    setError(null)
    setSuccess(null)
    try {
      const message = await sendBugReportToAtlassianMcp(props.mcpSettings, {
        summary,
        description,
        projectKey,
      })
      const nextHistory = pushProjectKeyHistory(projectKeyHistory, projectKey)
      setProjectKeyHistory(nextHistory)
      saveProjectKeyHistory(nextHistory)
      setProjectKey(projectKey.trim().toUpperCase())
      setSuccess(message)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setBusyMode(null)
    }
  }

  const atlassianServer = getAtlassianMcpServer(props.mcpSettings)
  const jiraConfigured = isMcpServerConfigured(atlassianServer)

  function handleDeleteProjectKeyHistoryItem(item: string) {
    const nextHistory = removeProjectKeyHistoryItem(projectKeyHistory, item)
    setProjectKeyHistory(nextHistory)
    saveProjectKeyHistory(nextHistory)
    if (projectKey.trim().toUpperCase() === item) {
      setProjectKey(nextHistory[0] ?? '')
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal bugReportModal"
      onClose={props.onClose}
      onClick={event => {
        if (event.target === event.currentTarget) dialogRef.current?.close()
      }}
    >
      <div className="bugReportModalBody">
        <div className="modalHeader">
          <b>Bug Report</b>
          <button className="iconBtn" onClick={() => dialogRef.current?.close()} aria-label="Close" title="Close">
            <CloseIcon size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <div className="formRow bugReportFormRow">
            <div className="formLabel">Summary</div>
            <input
              className="mono"
              value={summary}
              onChange={event => setSummary(event.target.value)}
              placeholder="Short bug title"
            />
          </div>

          <div className="formRow bugReportFormRow">
            <div className="formLabel">Project Key</div>
            <div ref={projectKeyHistoryWrapRef} style={{ position: 'relative', flex: 1, minWidth: 0, width: '100%' }}>
              <input
                className="mono valueHistoryInput"
                value={projectKey}
                onChange={event => setProjectKey(event.target.value.toUpperCase())}
                onFocus={() => {
                  if (projectKeyHistory.length) setProjectKeyHistoryOpen(true)
                }}
                placeholder="QA"
                style={{ width: '100%', boxSizing: 'border-box', display: 'block' }}
              />
              <button
                type="button"
                className="valueHistoryBtn"
                aria-label="Project key history"
                title="Project key history"
                onClick={event => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (!projectKeyHistory.length) return
                  setProjectKeyHistoryOpen(prev => !prev)
                }}
              >
                ▾
              </button>
              {projectKeyHistoryOpen && projectKeyHistory.length ? (
                <div
                  className="selectMenuPanel valueHistoryPanel"
                  role="menu"
                  style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', width: '100%', zIndex: 220 }}
                  onPointerDown={event => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={event => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                >
                  {projectKeyHistory.map(item => {
                    const isActive = item === projectKey.trim().toUpperCase()
                    return (
                      <div
                        key={item}
                        className={`selectMenuItem ${isActive ? 'selectMenuItemActive' : ''}`}
                        role="menuitemradio"
                        aria-checked={isActive}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                      >
                        <button
                          type="button"
                          style={{
                            flex: 1,
                            textAlign: 'left',
                            background: 'transparent',
                            border: 0,
                            color: 'inherit',
                            padding: 0,
                            font: 'inherit',
                            cursor: 'pointer',
                          }}
                          onClick={() => {
                            setProjectKey(item)
                            setProjectKeyHistoryOpen(false)
                          }}
                        >
                          <span className="mono">{item}</span>
                        </button>
                        <button
                          type="button"
                          className="iconBtn"
                          aria-label={`Delete ${item} from history`}
                          title="Delete from history"
                          onClick={() => handleDeleteProjectKeyHistoryItem(item)}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </div>

          <div className="formRow bugReportFormRow bugReportFormRowTop">
            <div className="formLabel">Report Template</div>
            <textarea
              className="mono modalTextarea"
              value={description}
              onChange={event => setDescription(event.target.value)}
              rows={18}
              placeholder="Describe the bug details"
              style={{ minHeight: 360 }}
            />
          </div>

          {!jiraConfigured ? (
            <div
              className="small"
              style={{
                color: '#ffcf7a',
                whiteSpace: 'pre-wrap',
                border: '1px solid rgba(255, 207, 122, 0.24)',
                borderRadius: 10,
                padding: '10px 12px',
                background: 'rgba(255, 207, 122, 0.08)',
              }}
            >
              To send a bug to Jira, configure the Atlassian MCP server in Settings → MCP.
            </div>
          ) : null}

          {success ? (
            <div
              className="small"
              style={{
                color: '#7ee0a1',
                whiteSpace: 'pre-wrap',
                border: '1px solid rgba(126, 224, 161, 0.24)',
                borderRadius: 10,
                padding: '10px 12px',
                background: 'rgba(126, 224, 161, 0.08)',
              }}
            >
              {success}
            </div>
          ) : null}

          {error ? <div className="small" style={{ color: '#ff9a9a', whiteSpace: 'pre-wrap' }}>{error}</div> : null}
        </div>

        <div className="modalActions" style={{ justifyContent: 'space-between', marginTop: 18 }}>
          <button
            type="button"
            onClick={() => {
              props.onClose()
              props.openSettings('mcp')
            }}
          >
            Open MCP Settings
          </button>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="aiEnhanceBtn"
              onClick={() => void handleEnhanceWithAi()}
              disabled={!!busyMode || !description.trim()}
            >
              <span className="aiEnhanceBtnSpark" aria-hidden="true">
                <StarIcon size={14} />
              </span>
              <span className="aiEnhanceBtnText">{busyMode === 'ai' ? 'Enhancing...' : 'Enhance with AI'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSendToJira()}
              disabled={!!busyMode || !jiraConfigured || !summary.trim() || !description.trim() || !projectKey.trim()}
            >
              {busyMode === 'mcp' ? 'Sending...' : 'Send Bug to Jira'}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
