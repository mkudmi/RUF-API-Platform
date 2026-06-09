import type { Dispatch, RefObject, SetStateAction } from 'react'
import { CloseIcon, OpenInNewIcon } from '../../../../shared/icons'
import { ConfirmIconButton } from '../../../../shared/components/ConfirmIconButton'
import { JsCodeEditor } from '../../../../shared/components/JsCodeEditor'
import type { DataDrivenRunReport } from '../sheets/DataDrivenReportSheet'

export function RequestEditorTestsSection(props: {
  testFunctionMenuWrapRef: RefObject<HTMLDivElement | null>
  testFunctionMenuOpen: boolean
  setTestFunctionMenuOpen: Dispatch<SetStateAction<boolean>>
  selectedTestFunction: string
  setSelectedTestFunction: Dispatch<SetStateAction<string>>
  availableGlobalTestFunctionNames: string[]
  requestTestScript: string
  setRequestTestScript: Dispatch<SetStateAction<string>>
}) {
  return (
    <div className="accordion">
      <div style={{ display: 'grid', gap: 8 }}>
        <div className="small" style={{ opacity: 0.78 }}>Function</div>
        <div ref={props.testFunctionMenuWrapRef} className="selectMenuWrap" style={{ width: '100%' }}>
          <button
            type="button"
            className="selectMenuBtn mono"
            aria-haspopup="listbox"
            aria-expanded={props.testFunctionMenuOpen}
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              props.setTestFunctionMenuOpen(prev => !prev)
            }}
          >
            {props.selectedTestFunction || 'No function'}
          </button>
          {props.testFunctionMenuOpen ? (
            <div className="selectMenuPanel" role="listbox" style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', width: '100%', zIndex: 210 }}>
              <button
                type="button"
                className={`selectMenuItem ${props.selectedTestFunction === '' ? 'selectMenuItemActive' : ''}`}
                role="option"
                aria-selected={props.selectedTestFunction === ''}
                onClick={() => {
                  props.setSelectedTestFunction('')
                  props.setTestFunctionMenuOpen(false)
                }}
              >
                <div className="mono">No function</div>
              </button>
              {props.availableGlobalTestFunctionNames.map(fnName => (
                <button
                  key={fnName}
                  type="button"
                  className={`selectMenuItem ${props.selectedTestFunction === fnName ? 'selectMenuItemActive' : ''}`}
                  role="option"
                  aria-selected={props.selectedTestFunction === fnName}
                  onClick={() => {
                    props.setSelectedTestFunction(fnName)
                    props.setTestFunctionMenuOpen(false)
                  }}
                >
                  <div className="mono">{fnName}</div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {!props.availableGlobalTestFunctionNames.length ? (
          <div className="small" style={{ color: '#ffb46a' }}>
            Global test functions list is empty. Add functions via the sidebar Tests button.
          </div>
        ) : null}
      </div>

      <div className="section" style={{ display: 'grid', gap: 8 }}>
        <div className="small" style={{ opacity: 0.78 }}>Request Test Script (JS)</div>
        <JsCodeEditor
          value={props.requestTestScript}
          onChangeValue={props.setRequestTestScript}
          minHeight={220}
        />
      </div>
    </div>
  )
}

export function RequestEditorDataSection(props: {
  dataDrivenRunning: boolean
  canSend: boolean
  isSending: boolean
  dataDrivenInput: string
  setDataDrivenInput: Dispatch<SetStateAction<string>>
  dataDrivenParsed: { format: string, rows: unknown[], error: string }
  dataDrivenRunReport: DataDrivenRunReport | null
  setDataDrivenReportSheetOpen: Dispatch<SetStateAction<boolean>>
  cancelDataDrivenRun: () => void
  startDataDrivenRun: () => Promise<void>
  openDataDrivenInputEditor: () => void
}) {
  return (
    <div className="accordion">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ fontWeight: 600, opacity: 0.95 }}>Data-driven run</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => props.setDataDrivenReportSheetOpen(true)}
            style={{ height: 32, minHeight: 32, padding: '0 10px', boxSizing: 'border-box' }}
          >
            Report
          </button>
          {props.dataDrivenRunning ? (
            <button
              type="button"
              onClick={props.cancelDataDrivenRun}
              style={{
                height: 32,
                minHeight: 32,
                padding: '0 10px',
                boxSizing: 'border-box',
                background: 'rgba(239,68,68,.24)',
                borderColor: 'rgba(239,68,68,.55)',
                color: 'rgb(255, 170, 170)',
              }}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void props.startDataDrivenRun()}
              disabled={!props.canSend || !!props.dataDrivenParsed.error || !props.dataDrivenParsed.rows.length || props.isSending}
              style={{ height: 32, minHeight: 32, padding: '0 10px', boxSizing: 'border-box' }}
            >
              Run Data
            </button>
          )}
        </div>
      </div>

      <div className="section" style={{ display: 'grid', gap: 8 }}>
        <div className="small" style={{ opacity: 0.78 }}>
          JSON/CSV
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 2, display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="iconBtn"
              onClick={props.openDataDrivenInputEditor}
              aria-label="Open large editor"
              title="Open large editor"
              style={{
                width: 28,
                height: 28,
                minHeight: 28,
                padding: 0,
              }}
            >
              <OpenInNewIcon size={14} />
            </button>
            <ConfirmIconButton
              className="iconBtn"
              onConfirm={() => props.setDataDrivenInput('')}
              ariaLabel="Clear data input"
              confirmAriaLabel="Confirm clear data input"
              title="Clear data input"
              confirmTitle="Confirm clear data input"
              icon={<CloseIcon size={14} />}
              style={{
                width: 28,
                height: 28,
                minHeight: 28,
                padding: 0,
              }}
            />
          </div>
          <textarea
            className="mono"
            spellCheck={false}
            value={props.dataDrivenInput}
            onChange={e => props.setDataDrivenInput(e.target.value)}
            placeholder={'[{"userId":"1","token":"abc"},{"userId":"2","token":"def"}]\n\nuserId,token\n1,abc\n2,def'}
            style={{
              width: '100%',
              minHeight: 140,
              resize: 'vertical',
              borderRadius: 'var(--radius)',
              border: '1px solid rgba(255,255,255,.12)',
              background: 'rgba(255,255,255,.04)',
              padding: '8px 74px 8px 10px',
            }}
          />
        </div>
        <div className="small" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, opacity: 0.8 }}>
          <span>Format: <span className="mono">{props.dataDrivenParsed.format.toUpperCase()}</span></span>
          <span>Rows: <span className="mono">{props.dataDrivenParsed.rows.length}</span></span>
          <span>Passed: <span className="mono">{props.dataDrivenRunReport?.passed ?? 0}</span></span>
          <span>Failed: <span className="mono">{props.dataDrivenRunReport?.failed ?? 0}</span></span>
          {props.dataDrivenParsed.error ? <span style={{ color: '#ff9a9a' }}>{props.dataDrivenParsed.error}</span> : null}
        </div>
      </div>
    </div>
  )
}
