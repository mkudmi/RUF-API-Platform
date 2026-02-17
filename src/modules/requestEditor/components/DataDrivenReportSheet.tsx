import { useState } from 'react'
import { CloseIcon } from '../../../shared/icons'
import type { DataDrivenDatasetFormat, DataDrivenRow } from '../../../shared/utils/variables'

export type DataDrivenRunItem = {
  rowNumber: number
  status: number
  ok: boolean
  timeMs: number
  responseBytes: number
  responseBodyText: string
  variables: DataDrivenRow
}

export type DataDrivenRunReport = {
  startedAt: number
  finishedAt: number | null
  total: number
  completed: number
  passed: number
  failed: number
  canceled: boolean
  format: DataDrivenDatasetFormat
  items: DataDrivenRunItem[]
  error?: string
}

type Props = {
  open: boolean
  report: DataDrivenRunReport | null
  onClose: () => void
  onClearReport: () => void
}

function formatRunDuration(timeMs: number) {
  if (!Number.isFinite(timeMs) || timeMs <= 0) return '0ms'
  if (timeMs > 999) return `${(timeMs / 1000).toFixed(2)}s`
  return `${Math.round(timeMs)}ms`
}

function formatRunBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatRunResponseBodyPretty(bodyText: string) {
  const raw = typeof bodyText === 'string' ? bodyText : ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return raw
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return raw
  }
}

export function DataDrivenReportSheet(props: Props) {
  const { open, report, onClose, onClearReport } = props
  const [expandedRowNumber, setExpandedRowNumber] = useState<number | null>(null)
  if (!open) return null

  return (
    <>
      <button
        type="button"
        className="dataRunReportSheetBackdrop"
        onClick={onClose}
        aria-label="Close data run report"
      />
      <div className="dataRunReportSheetPanel">
        <div className="modalHeader" style={{ marginBottom: 8 }}>
          <b>Data Run Report</b>
          <div style={{ display: 'flex', gap: 6 }}>
            {report ? (
              <button
                type="button"
                className="iconBtn"
                onClick={onClearReport}
                title="Clear report"
                aria-label="Clear report"
              >
                <span aria-hidden="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M10.9 2.2L13.8 5.1L12.7 6.2L9.8 3.3L10.9 2.2Z" fill="currentColor" />
                    <path d="M4.1 8.6L9.5 3.2L12.8 6.5L7.4 11.9L4.7 11.3L4.1 8.6Z" fill="currentColor" />
                    <path d="M2.4 12.4H9.6V13.8H2.4V12.4Z" fill="currentColor" />
                  </svg>
                </span>
              </button>
            ) : null}
            <button type="button" className="iconBtn" onClick={onClose} aria-label="Close" title="Close">
              <CloseIcon size={18} />
            </button>
          </div>
        </div>

        {report ? (
          <div style={{ display: 'grid', gap: 8, minHeight: 0, height: '100%', gridTemplateRows: 'auto auto auto 1fr' }}>
            <div className="small" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span>Total: <span className="mono">{report.total}</span></span>
              <span>Done: <span className="mono">{report.completed}</span></span>
              <span>Passed: <span className="mono">{report.passed}</span></span>
              <span>Failed: <span className="mono">{report.failed}</span></span>
              <span>Format: <span className="mono">{report.format.toUpperCase()}</span></span>
            </div>
            {report.canceled ? <div className="small" style={{ color: '#ffcf84' }}>Run canceled.</div> : null}
            {report.error ? <div className="small" style={{ color: '#ff9a9a' }}>{report.error}</div> : null}
            <div style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, overflow: 'auto', minHeight: 0 }}>
              {report.items.length ? report.items.map(item => (
                <div
                  key={item.rowNumber}
                  style={{
                    borderBottom: '1px solid rgba(255,255,255,.08)',
                    background: expandedRowNumber === item.rowNumber ? 'rgba(255,255,255,.03)' : 'transparent',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedRowNumber(prev => (prev === item.rowNumber ? null : item.rowNumber))}
                    style={{
                      width: '100%',
                      border: 0,
                      background: 'transparent',
                      textAlign: 'left',
                      padding: '8px 10px',
                      display: 'grid',
                      gap: 4,
                    }}
                  >
                    <div className="small mono" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span>#{item.rowNumber}</span>
                      <span className={item.ok ? 'status2xx' : 'status4xx'} style={{ padding: '1px 6px', border: '1px solid currentColor', borderRadius: 'var(--radius)' }}>
                        {item.status || 0}
                      </span>
                      <span>{formatRunDuration(item.timeMs)}</span>
                      <span>{formatRunBytes(item.responseBytes)}</span>
                    </div>
                    <div className="small mono" style={{ opacity: 0.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {JSON.stringify(item.variables)}
                    </div>
                  </button>

                  {expandedRowNumber === item.rowNumber ? (
                    <div style={{ padding: '0 10px 10px 10px' }}>
                      <div className="small" style={{ opacity: 0.72, marginBottom: 4 }}>Response Body</div>
                      <pre
                        className="mono"
                        style={{
                          fontSize: 13,
                          margin: 0,
                          padding: 10,
                          borderRadius: 'var(--radius)',
                          border: '1px solid rgba(255,255,255,.12)',
                          background: 'rgba(0,0,0,.28)',
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                          maxHeight: 220,
                          overflow: 'auto',
                        }}
                      >
                        {item.responseBodyText ? formatRunResponseBodyPretty(item.responseBodyText) : '[Empty response body]'}
                      </pre>
                    </div>
                  ) : null}
                </div>
              )) : (
                <div className="small" style={{ padding: 10 }}>No rows executed yet.</div>
              )}
            </div>
          </div>
        ) : (
          <div className="small" style={{ opacity: 0.75 }}>No report yet. Run data first.</div>
        )}
      </div>
    </>
  )
}
