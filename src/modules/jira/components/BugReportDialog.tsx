import { useEffect, useMemo, useRef, useState } from 'react'
import { CloseIcon, StarIcon } from '../../../shared/icons'
import type { AiProviderSettings, CaCertificate, ClientTlsIdentity, JiraIntegrationSettings } from '../../../shared/utils/appSettings'
import { enhanceBugReportWithYandex } from '../../ai/provider'
import { createJiraIssue, isJiraConfigured } from '../services/jira'

type Props = {
  open: boolean
  onClose: () => void
  aiSettings: AiProviderSettings
  jiraSettings: JiraIntegrationSettings
  validateCertificates: boolean
  caCertificates: CaCertificate[]
  clientTlsIdentity: ClientTlsIdentity | null
  openSettings: (tabId?: string) => void
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
  const initialDescription = useMemo(() => buildInitialDescription(), [])
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState(initialDescription)
  const [busyMode, setBusyMode] = useState<'ai' | 'jira' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ key: string, url: string } | null>(null)

  useEffect(() => {
    setDescription(initialDescription)
  }, [initialDescription])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (props.open) {
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
    setBusyMode('jira')
    setError(null)
    setSuccess(null)
    try {
      const issue = await createJiraIssue(props.jiraSettings, {
        validateCertificates: props.validateCertificates,
        caCertificates: props.caCertificates,
        clientTlsIdentity: props.clientTlsIdentity,
      }, { summary, description })
      setSuccess(issue)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setBusyMode(null)
    }
  }

  const jiraConfigured = isJiraConfigured(props.jiraSettings)

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
              placeholder="Short bug title for Jira"
            />
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
              Jira is not configured yet. Fill in Base URL, email, API token, and project key in Settings.
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
              Issue created: <a href={success.url} target="_blank" rel="noreferrer">{success.key}</a>
            </div>
          ) : null}

          {error ? <div className="small" style={{ color: '#ff9a9a', whiteSpace: 'pre-wrap' }}>{error}</div> : null}
        </div>

        <div className="modalActions" style={{ justifyContent: 'space-between', marginTop: 18 }}>
          <button
            type="button"
            onClick={() => {
              props.onClose()
              props.openSettings('jira')
            }}
          >
            Open Jira Settings
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
              disabled={!!busyMode || !jiraConfigured || !summary.trim() || !description.trim()}
            >
              {busyMode === 'jira' ? 'Sending...' : 'Send Bug to Jira'}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
