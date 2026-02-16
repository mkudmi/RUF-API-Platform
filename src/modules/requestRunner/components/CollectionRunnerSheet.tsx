import { CloseIcon } from '../../../shared/icons'
import type {
  CollectionRunnerTab,
  CollectionRunHistoryEntry,
  CollectionRunReportState,
  CollectionRunSelectionState,
} from '../types'
import {
  displayRunnerMethod,
  formatRunBytes,
  formatRunDuration,
  formatRunHistoryTimestamp,
  formatRunResponseBodyPretty,
  runnerMethodClass,
  statusClass,
} from '../uiUtils'

type Props = {
  open: boolean
  busy: boolean
  closing: boolean
  tab: CollectionRunnerTab
  selection: CollectionRunSelectionState | null
  report: CollectionRunReportState | null
  history: CollectionRunHistoryEntry[]
  iterationsInput: string
  iterations: number | null
  selectedCount: number
  reportDurationMs: number
  expandedItemKey: string | null
  onClose: () => void
  onTabChange: (tab: CollectionRunnerTab) => void
  onToggleSelectionItem: (itemId: string, enabled: boolean) => void
  onIterationsInputChange: (next: string) => void
  onPlay: () => void
  onStop: () => void
  onRerun: () => void
  onToggleExpandedItem: (key: string) => void
  onOpenHistoryReport: (itemId: string) => void
}

export function CollectionRunnerSheet(props: Props) {
  const {
    open,
    busy,
    closing,
    tab,
    selection,
    report,
    history,
    iterationsInput,
    iterations,
    selectedCount,
    reportDurationMs,
    expandedItemKey,
    onClose,
    onTabChange,
    onToggleSelectionItem,
    onIterationsInputChange,
    onPlay,
    onStop,
    onRerun,
    onToggleExpandedItem,
    onOpenHistoryReport,
  } = props

  if (!open) return null

  return (
    <>
      <button
        type="button"
        className={`collectionRunSheetBackdrop ${busy ? 'collectionRunSheetBackdropDisabled' : ''} ${closing ? 'collectionRunSheetBackdropClosing' : ''}`}
        aria-label="Close collection run panel"
        onClick={onClose}
        disabled={busy || closing}
      />
      <div className={`collectionRunSheetPanel ${closing ? 'collectionRunSheetPanelClosing' : ''}`}>
        <div className="modalHeader" style={{ marginBottom: 8 }}>
          <b>Collection Runner</b>
          <button
            className="iconBtn"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            disabled={busy || closing}
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="tabs" style={{ marginTop: 2, marginBottom: 10 }}>
          <button
            className={`tab ${tab === 'report' ? 'tabActive' : ''}`}
            onClick={() => onTabChange('report')}
          >
            Report
          </button>
          <button
            className={`tab ${tab === 'history' ? 'tabActive' : ''}`}
            onClick={() => onTabChange('history')}
          >
            History
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {tab === 'history' ? (
            <div style={{ display: 'grid', gap: 10, flex: 1, minHeight: 0, gridTemplateRows: '1fr' }}>
              <div style={{ minHeight: 0, overflow: 'auto', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10 }}>
                {history.length ? (
                  history.map(item => {
                    const historyReport = item.report
                    const endTs = historyReport.finishedAt ?? historyReport.startedAt
                    const durationMs = Math.max(0, endTs - historyReport.startedAt)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onOpenHistoryReport(item.id)}
                        style={{
                          width: '100%',
                          border: 0,
                          borderBottom: '1px solid rgba(255,255,255,.08)',
                          background: 'transparent',
                          textAlign: 'left',
                          padding: '10px 12px',
                          display: 'grid',
                          gap: 4,
                        }}
                      >
                        <div className="mono" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={historyReport.collectionName}>
                          {historyReport.collectionName}
                        </div>
                        <div className="small" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', opacity: 0.78 }}>
                          <span>{formatRunHistoryTimestamp(item.createdAt)}</span>
                          <span>Total: <span className="mono">{historyReport.total}</span></span>
                          <span>Passed: <span className="mono">{historyReport.passed}</span></span>
                          <span>Failed: <span className="mono">{historyReport.failed}</span></span>
                          <span>Time: <span className="mono">{formatRunDuration(durationMs)}</span></span>
                        </div>
                      </button>
                    )
                  })
                ) : (
                  <div className="small" style={{ padding: 12 }}>No run history yet.</div>
                )}
              </div>
            </div>
          ) : selection ? (
            <div style={{ display: 'grid', gap: 10, flex: 1, minHeight: 0, gridTemplateRows: 'auto auto auto 1fr auto' }}>
              <div className="small">
                Scope: <span className="mono">{selection.runLabel}</span>
              </div>

              <div className="small" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <span>Total: <span className="mono">{selection.items.length}</span></span>
                <span>Selected: <span className="mono">{selectedCount}</span></span>
                <span>
                  Planned runs:{' '}
                  <span className="mono">
                    {iterations ? selectedCount * iterations : 0}
                  </span>
                </span>
              </div>

              <div className="formRow" style={{ marginBottom: 0, gridTemplateColumns: 'max-content max-content', justifyContent: 'start' }}>
                <div className="formLabel">Iterations</div>
                <input
                  className="mono"
                  style={{ width: 45, justifySelf: 'start' }}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={iterationsInput}
                  onChange={e => onIterationsInputChange(e.target.value)}
                  placeholder="1"
                  title="Number of run iterations"
                />
              </div>

              <div style={{ minHeight: 0, height: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10 }}>
                {selection.items.length ? (
                  selection.items.map(item => (
                    <label
                      key={item.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '24px 38px 1fr',
                        gap: 10,
                        alignItems: 'center',
                        padding: '8px 10px',
                        borderBottom: '1px solid rgba(255,255,255,.08)',
                        cursor: 'pointer',
                        background: item.enabled ? 'transparent' : 'rgba(0,0,0,.22)',
                        opacity: item.enabled ? 1 : 0.5,
                      }}
                    >
                      <span className="checkRow rowCheck">
                        <input
                          className="checkInput"
                          type="checkbox"
                          checked={item.enabled}
                          aria-label={`Toggle ${item.request.name || item.request.id}`}
                          onChange={e => onToggleSelectionItem(item.id, e.target.checked)}
                        />
                        <span className="checkBox" aria-hidden="true" />
                      </span>
                      <span className={`mono small treeMethod ${runnerMethodClass(item.request.method)}`} style={{ opacity: 0.95 }}>
                        {displayRunnerMethod(item.request.method)}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className="mono" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.request.path}>
                          {item.request.path || '/'}
                        </div>
                        <div className="small" style={{ opacity: 0.7 }}>
                          {item.folderPath ? item.folderPath : '(root)'} | {item.request.name || item.request.id}
                        </div>
                      </div>
                    </label>
                  ))
                ) : (
                  <div className="small" style={{ padding: 12 }}>
                    No requests in selection.
                  </div>
                )}
              </div>

              <div className="modalActions" style={{ marginTop: 0 }}>
                <button type="button" onClick={onClose}>Close</button>
                <button
                  type="button"
                  onClick={onPlay}
                  disabled={selectedCount <= 0 || iterations === null}
                >
                  Play
                </button>
              </div>
            </div>
          ) : report ? (
            <div style={{ display: 'grid', gap: 10, flex: 1, minHeight: 0, gridTemplateRows: 'auto auto auto auto 1fr auto' }}>
              <div className="small">
                Collection: <span className="mono">{report.collectionName}</span>
              </div>

              <div className="small" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <span>Total: <span className="mono">{report.total}</span></span>
                <span>Done: <span className="mono">{report.completed}</span></span>
                <span>Passed: <span className="mono">{report.passed}</span></span>
                <span>Failed: <span className="mono">{report.failed}</span></span>
                <span>Time: <span className="mono">{formatRunDuration(reportDurationMs)}</span></span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                {busy ? (
                  <div className="small" style={{ color: 'rgb(160, 200, 255)', opacity: 1 }}>
                    Running...
                  </div>
                ) : report.canceled ? (
                  <div className="small" style={{ color: '#ffcf84', opacity: 1 }}>
                    Run canceled.
                  </div>
                ) : (
                  <div className="small" style={{ color: 'rgb(120, 255, 185)', opacity: 1 }}>
                    Run finished.
                  </div>
                )}
                {busy ? (
                  <button
                    type="button"
                    onClick={onStop}
                    style={{
                      background: 'rgba(239,68,68,.24)',
                      borderColor: 'rgba(239,68,68,.55)',
                      color: 'rgb(255, 170, 170)',
                    }}
                  >
                    Stop
                  </button>
                ) : (
                  <button type="button" onClick={onRerun}>
                    Re-run
                  </button>
                )}
              </div>

              <div className="treeMenuDivider" role="separator" />

              <div style={{ minHeight: 0, height: '100%', overflow: 'auto', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10 }}>
                {report.items.length ? (
                  report.items.map((item, idx) => {
                    const rowKey = `${item.runId}:${item.requestId}`
                    const expanded = expandedItemKey === rowKey
                    const prevIteration = idx > 0 ? report.items[idx - 1]?.iteration : null
                    const showIterationDivider = idx === 0 || prevIteration !== item.iteration
                    return (
                      <div
                        key={rowKey}
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,.08)',
                          background: expanded ? 'rgba(255,255,255,.03)' : 'transparent',
                        }}
                      >
                        {showIterationDivider ? (
                          <div
                            className="small mono"
                            style={{
                              padding: '6px 10px',
                              borderBottom: '1px solid rgba(255,255,255,.08)',
                              background: 'rgba(255,255,255,.04)',
                              opacity: 0.9,
                            }}
                          >
                            Iteration {item.iteration}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onToggleExpandedItem(rowKey)}
                          style={{
                            width: '100%',
                            display: 'grid',
                            gridTemplateColumns: '38px 1fr auto',
                            gap: 10,
                            alignItems: 'center',
                            padding: '8px 10px',
                            textAlign: 'left',
                            border: 0,
                            borderRadius: 0,
                            background: 'transparent',
                          }}
                        >
                          <span className={`mono small treeMethod ${runnerMethodClass(item.method)}`} style={{ opacity: 0.95 }}>
                            {displayRunnerMethod(item.method)}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div className="mono" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.path}>
                              {item.path || '/'}
                            </div>
                            <div className="small" style={{ opacity: 0.7 }}>
                              {item.folderPath ? item.folderPath : '(root)'} · {item.requestName || item.requestId}
                            </div>
                          </div>
                          <div className="small mono" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className={statusClass(item.status)} style={{ padding: '2px 7px', borderWidth: 1, borderStyle: 'solid', borderRadius: 'var(--radius)' }}>
                              {item.status || 0}
                            </span>
                            <span style={{ opacity: 0.52 }}>·</span>
                            <span style={{ opacity: 0.8 }}>{formatRunDuration(item.timeMs)}</span>
                            <span style={{ opacity: 0.52 }}>·</span>
                            <span style={{ opacity: 0.72 }}>{formatRunBytes(item.responseBytes)}</span>
                          </div>
                        </button>

                        {expanded ? (
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
                    )
                  })
                ) : (
                  <div className="small" style={{ padding: 12 }}>
                    No requests in collection.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="small">Select "Run Collection" in collection menu.</div>
          )}
        </div>
      </div>
    </>
  )
}
