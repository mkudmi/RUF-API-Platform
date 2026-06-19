import type { RefObject } from 'react'
import type { OutputEntry, ResultPagingState } from '../../types'
import { stringifyResultValue } from '../../utils/sql'

type Props = {
  editorBusy: boolean
  output: OutputEntry[]
  resultRows: Array<Record<string, unknown>> | null
  effectiveResultColumns: string[]
  resultHint: string | null
  lastRunSchemaTableLabel: string | null
  paging: ResultPagingState
  outputRef: RefObject<HTMLDivElement | null>
  focusEditorSoon: () => void
  onOutputScroll: () => void
  onLoadAllRows: () => void
}

export function SqlTerminalOutputPane(props: Props) {
  const {
    editorBusy,
    output,
    resultRows,
    effectiveResultColumns,
    resultHint,
    lastRunSchemaTableLabel,
    paging,
    outputRef,
    focusEditorSoon,
    onOutputScroll,
    onLoadAllRows,
  } = props

  return (
    <div className="sqlTerminalPane">
      <div className="sqlTerminalPaneTitle mono">
        <span>Output</span>
        {lastRunSchemaTableLabel ? <span className="sqlTerminalPaneTitleCenter" title={lastRunSchemaTableLabel}>{lastRunSchemaTableLabel}</span> : null}
        {(resultHint || paging.enabled) ? (
          <div className="sqlTerminalPaneTitleRight">
            {resultHint ? <span className="sqlTerminalRowsHint">{resultHint}</span> : null}
            {paging.enabled ? (
              <button
                type="button"
                className="iconBtn"
                disabled={editorBusy || paging.loading || !paging.hasMore}
                onClick={onLoadAllRows}
                title={paging.hasMore ? 'Load full result' : 'All rows loaded'}
                aria-label="Load all rows"
              >
                {paging.loading && paging.loadAll ? '…' : 'All'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div
        ref={outputRef}
        className="sqlTerminalOutput mono"
        role="log"
        aria-live="polite"
        onPointerDown={focusEditorSoon}
        onScroll={onOutputScroll}
      >
        {effectiveResultColumns.length ? (
          <div className="sqlTerminalTableWrap">
            <table className="sqlTerminalTable">
              <thead>
                <tr>
                  {effectiveResultColumns.map(column => (
                    <th key={column} className="mono" title={column}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(resultRows ?? []).map((row, index) => (
                  <tr key={index}>
                    {effectiveResultColumns.map(column => {
                      const text = stringifyResultValue(row[column])
                      return (
                        <td key={column} title={text}>
                          {text}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {paging.loading && !paging.loadAll ? <div className="terminalLine terminalLine_sys" style={{ marginTop: 8 }}>Loading more…</div> : null}
          </div>
        ) : output.length ? (
          output.map((entry, index) => (
            <div key={index} className={`terminalLine terminalLine_${entry.kind}`}>
              {entry.text}
            </div>
          ))
        ) : (
          <div className="terminalLine terminalLine_sys">Run a query to see output.</div>
        )}
      </div>
    </div>
  )
}
