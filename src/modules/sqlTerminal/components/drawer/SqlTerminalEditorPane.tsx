import type { CSSProperties, RefObject } from 'react'
import { StarIcon } from '../../../../shared/icons'
import type { DbConnOption, PopupPosition } from '../../types'

type SuggestMode = 'table' | 'column'

type Props = {
  open: boolean
  editorBusy: boolean
  busy: boolean
  aiBusy: boolean
  connOptions: DbConnOption[]
  selectedConn: DbConnOption | null
  selectedSchema: string
  schemas: string[]
  schemaMenuOpen: boolean
  schemaMenuPlacement: 'below' | 'above'
  schemaMenuMaxHeight: number
  aiMenuOpen: boolean
  sql: string
  lineNumbers: number[]
  activeLine: number
  editorWrapStyle: CSSProperties
  tableSuggestOpen: boolean
  tableSuggestReplaceRange: { start: number; end: number } | null
  tableSuggestPopupPos: PopupPosition | null
  suggestMode: SuggestMode
  tableSuggestions: string[]
  columnSuggestions: string[]
  columnLoading: boolean
  tableSuggestActiveIndex: number | null
  sqlAiPrompt: string
  schemaMenuWrapRef: RefObject<HTMLDivElement | null>
  aiMenuWrapRef: RefObject<HTMLDivElement | null>
  editorWrapRef: RefObject<HTMLDivElement | null>
  lineNumbersRef: RefObject<HTMLPreElement | null>
  sqlRef: RefObject<HTMLTextAreaElement | null>
  sqlAiPromptRef: RefObject<HTMLInputElement | null>
  tableSuggestRef: RefObject<HTMLDivElement | null>
  onOpenSchemaMenu: (anchorEl: HTMLElement) => void
  onToggleSchemaMenu: () => void
  onSelectSchema: (schema: string) => void
  onToggleAiMenu: () => void
  onEnhanceSqlWithAi: () => void
  onCreateSqlWithAi: () => void
  onRun: () => void
  onSqlChange: (nextText: string, caret: number) => void
  onRefreshEditorCaretState: () => void
  onEditorScroll: () => void
  onEditorKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onApplyColumnSuggestionAt: (index: number) => void
  onApplyTableSuggestionAt: (index: number) => void
  onSqlAiPromptChange: (value: string) => void
  onSqlAiPromptSend: () => void
}

export function SqlTerminalEditorPane(props: Props) {
  const {
    open,
    editorBusy,
    busy,
    aiBusy,
    connOptions,
    selectedConn,
    selectedSchema,
    schemas,
    schemaMenuOpen,
    schemaMenuPlacement,
    schemaMenuMaxHeight,
    aiMenuOpen,
    sql,
    lineNumbers,
    activeLine,
    editorWrapStyle,
    tableSuggestOpen,
    tableSuggestReplaceRange,
    tableSuggestPopupPos,
    suggestMode,
    tableSuggestions,
    columnSuggestions,
    columnLoading,
    tableSuggestActiveIndex,
    sqlAiPrompt,
    schemaMenuWrapRef,
    aiMenuWrapRef,
    editorWrapRef,
    lineNumbersRef,
    sqlRef,
    sqlAiPromptRef,
    tableSuggestRef,
    onOpenSchemaMenu,
    onToggleSchemaMenu,
    onSelectSchema,
    onToggleAiMenu,
    onEnhanceSqlWithAi,
    onCreateSqlWithAi,
    onRun,
    onSqlChange,
    onRefreshEditorCaretState,
    onEditorScroll,
    onEditorKeyDown,
    onApplyColumnSuggestionAt,
    onApplyTableSuggestionAt,
    onSqlAiPromptChange,
    onSqlAiPromptSend,
  } = props

  return (
    <div className="sqlTerminalPane sqlTerminalPaneSql">
      <div className="sqlTerminalPaneTitle mono">
        <div className="sqlTerminalPaneTitleLeft">
          <span>SQL</span>
          <div ref={schemaMenuOpen ? schemaMenuWrapRef : null} className="selectMenuWrap sqlTerminalSchemaMenu">
            <button
              type="button"
              className="selectMenuBtn mono"
              disabled={!schemas.length || selectedConn?.type !== 'postgres'}
              onPointerDown={event => event.stopPropagation()}
              onClick={event => {
                event.preventDefault()
                event.stopPropagation()
                if (!schemas.length) return
                if (schemaMenuOpen) {
                  onToggleSchemaMenu()
                  return
                }
                onOpenSchemaMenu(event.currentTarget)
              }}
              aria-haspopup="menu"
              aria-expanded={schemaMenuOpen}
              aria-label="Schema"
              title="Schema"
            >
              {selectedConn?.type !== 'postgres' ? 'Schema' : (selectedSchema || 'Schema')}
            </button>
            {schemaMenuOpen ? (
              <div
                className={`selectMenuPanel sqlTerminalSchemaPanel ${schemaMenuPlacement === 'above' ? 'sqlTerminalSchemaPanelAbove' : ''}`.trim()}
                role="menu"
                style={{ maxHeight: `${schemaMenuMaxHeight}px`, overflowY: 'auto' }}
                onPointerDown={event => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={event => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
              >
                {schemas.map(schema => (
                  <button
                    key={schema}
                    type="button"
                    className={`selectMenuItem ${selectedSchema === schema ? 'selectMenuItemActive' : ''}`}
                    role="menuitem"
                    onClick={() => onSelectSchema(schema)}
                  >
                    <span className="mono">{schema}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="sqlTerminalPaneActions">
          <div ref={aiMenuOpen ? aiMenuWrapRef : null} className="selectMenuWrap sqlTerminalAiMenu">
            <button
              type="button"
              className="responseSearchModeBtn aiMagicBtn sqlTerminalAiBtn"
              disabled={!open || editorBusy}
              onPointerDown={event => event.stopPropagation()}
              onClick={event => {
                event.preventDefault()
                event.stopPropagation()
                if (editorBusy) return
                onToggleAiMenu()
              }}
              aria-haspopup="menu"
              aria-expanded={aiMenuOpen}
              aria-label="AI actions"
              title={aiBusy ? 'AI is working…' : 'AI actions'}
            >
              <span className="aiEnhanceBtnSpark" aria-hidden="true">
                <StarIcon size={14} />
              </span>
              <span className="aiEnhanceBtnText">AI</span>
            </button>
            {aiMenuOpen ? (
              <div
                className="selectMenuPanel sqlTerminalAiMenuPanel"
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
                <button
                  type="button"
                  className="selectMenuItem"
                  role="menuitem"
                  disabled={editorBusy || !sql.trim()}
                  onClick={onEnhanceSqlWithAi}
                >
                  <span>Enchance with AI</span>
                </button>
                <button
                  type="button"
                  className="selectMenuItem"
                  role="menuitem"
                  onClick={onCreateSqlWithAi}
                >
                  <span>Create SQL with AI</span>
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="iconBtn sqlTerminalPlayBtn"
            onClick={onRun}
            disabled={editorBusy || !open || !selectedConn || !sql.trim()}
            aria-label="Run SQL"
            title={busy ? 'Running…' : (aiBusy ? 'AI is working…' : 'Run (Ctrl+Enter). Selection/current statement. Trailing ; is optional.')}
          >
            ▶
          </button>
        </div>
      </div>
      <div ref={editorWrapRef} className="sqlTerminalEditorWrap" style={editorWrapStyle}>
        <div className="sqlTerminalLineNumbers" aria-hidden="true">
          <pre ref={lineNumbersRef} className="sqlTerminalLineNumbersInner mono">
            {lineNumbers.map(lineNumber => (
              <span
                key={lineNumber}
                className={lineNumber === activeLine ? 'sqlTerminalLineNumber sqlTerminalLineNumberActive' : 'sqlTerminalLineNumber'}
              >
                {lineNumber}
              </span>
            ))}
          </pre>
        </div>
        <textarea
          ref={sqlRef}
          className="sqlTerminalEditor mono"
          value={sql}
          disabled={!open || editorBusy}
          onChange={event => onSqlChange(event.target.value, event.target.selectionStart ?? 0)}
          onKeyUp={onRefreshEditorCaretState}
          onClick={onRefreshEditorCaretState}
          onSelect={onRefreshEditorCaretState}
          onScroll={onEditorScroll}
          onKeyDown={onEditorKeyDown}
          placeholder={
            connOptions.length
              ? 'Write SQL here… (Ctrl+Enter: selection/current statement; trailing ; optional)'
              : 'Configure DB connection in App Settings or Collection Environment…'
          }
          wrap="off"
          spellCheck={false}
        />

        {open && tableSuggestOpen && tableSuggestReplaceRange && tableSuggestPopupPos ? (
          <div
            ref={tableSuggestRef}
            className={`sqlTerminalTableSuggest selectMenuPanel ${suggestMode === 'table' ? 'sqlTerminalTableSuggestTable' : ''}`.trim()}
            role="listbox"
            style={{ top: `${tableSuggestPopupPos.top}px`, left: `${tableSuggestPopupPos.left}px`, right: 'auto' }}
            onPointerDown={event => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            {suggestMode === 'column' ? (
              columnSuggestions.length ? (
                columnSuggestions.map((column, index) => (
                  <button
                    key={column}
                    type="button"
                    className={`selectMenuItem ${index === tableSuggestActiveIndex ? 'selectMenuItemActive' : ''}`.trim()}
                    role="option"
                    onClick={() => onApplyColumnSuggestionAt(index)}
                  >
                    <span className="mono">{column}</span>
                  </button>
                ))
              ) : (
                <div className="selectMenuItem" style={{ cursor: 'default', opacity: 0.75 }}>
                  {columnLoading ? 'Loading columns…' : 'No matches'}
                </div>
              )
            ) : (
              tableSuggestions.length ? (
                tableSuggestions.map((table, index) => (
                  <button
                    key={table}
                    type="button"
                    className={`selectMenuItem ${index === tableSuggestActiveIndex ? 'selectMenuItemActive' : ''}`.trim()}
                    role="option"
                    onClick={() => onApplyTableSuggestionAt(index)}
                  >
                    <span className="mono">{table}</span>
                  </button>
                ))
              ) : (
                <div className="selectMenuItem" style={{ cursor: 'default', opacity: 0.75 }}>
                  No matches
                </div>
              )
            )}
          </div>
        ) : null}
      </div>
      <div className="sqlTerminalAiPromptBar">
        <input
          ref={sqlAiPromptRef}
          type="text"
          className="sqlTerminalAiPromptInput mono"
          value={sqlAiPrompt}
          disabled={!open || editorBusy || !selectedConn}
          onChange={event => onSqlAiPromptChange(event.target.value)}
          placeholder="SQL AI: опиши запрос естественным языком"
          onKeyDown={event => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            onSqlAiPromptSend()
          }}
        />
        <button
          type="button"
          className={`responseSearchModeBtn aiMagicBtn sqlTerminalAiBtn sqlTerminalAiPromptRunBtn ${aiBusy ? 'sqlTerminalAiPromptRunBtnBusy' : ''}`.trim()}
          onClick={onSqlAiPromptSend}
          disabled={!open || editorBusy || !selectedConn || !sqlAiPrompt.trim()}
          title={aiBusy ? 'AI is working…' : 'Generate SQL and run only the generated script'}
        >
          {aiBusy ? (
            <span className="sqlTerminalAiPromptRunBtnSpark" aria-hidden="true">
              <StarIcon size={14} />
            </span>
          ) : (
            <span className="sqlTerminalAiPromptRunBtnLabel">Send</span>
          )}
        </button>
      </div>
    </div>
  )
}
