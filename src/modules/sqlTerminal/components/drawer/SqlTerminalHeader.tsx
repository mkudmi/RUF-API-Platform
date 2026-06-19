import type { RefObject } from 'react'
import { CloseIcon, SqlTerminalPositionIcon } from '../../../../shared/icons'
import type { DbConnOption } from '../../types'

type Props = {
  open: boolean
  editorBusy: boolean
  menuOpen: boolean
  menuWrapRef: RefObject<HTMLDivElement | null>
  connOptions: DbConnOption[]
  selectedConn: DbConnOption | null
  selectedConnId: string | null
  selectedLabel: string
  isLeftPosition: boolean
  onClose: () => void
  onToggleMenu: () => void
  onSelectConnection: (id: string) => void
  onToggleDrawerPosition: () => void
  onClear: () => void
  focusEditorSoon: () => void
}

export function SqlTerminalHeader(props: Props) {
  const {
    open,
    editorBusy,
    menuOpen,
    menuWrapRef,
    connOptions,
    selectedConn,
    selectedConnId,
    selectedLabel,
    isLeftPosition,
    onClose,
    onToggleMenu,
    onSelectConnection,
    onToggleDrawerPosition,
    onClear,
    focusEditorSoon,
  } = props

  return (
    <header className="terminalHeader">
      <div className="terminalTitle mono" style={{ flex: '1 1 auto', minWidth: 0 }}>
        SQL
        <div ref={menuOpen ? menuWrapRef : null} className="selectMenuWrap sqlTerminalConnMenu">
          <button
            type="button"
            className="selectMenuBtn mono"
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              if (!connOptions.length) return
              onToggleMenu()
            }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Database connection"
            title={selectedConn?.connectionPreview ?? 'Database connection'}
          >
            {selectedLabel}
          </button>

          {menuOpen ? (
            <div
              className="selectMenuPanel"
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
              {connOptions.map(option => (
                <button
                  key={option.id}
                  type="button"
                  className={`selectMenuItem ${selectedConnId === option.id ? 'selectMenuItemActive' : ''}`}
                  role="menuitem"
                  title={option.connectionPreview}
                  onClick={() => {
                    onSelectConnection(option.id)
                    focusEditorSoon()
                  }}
                >
                  <span className="mono">{option.label}</span>
                  <span style={{ opacity: 0.75 }}>{` — ${option.connectionPreview}`}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="terminalHeaderActions">
        <button
          type="button"
          className="iconBtn"
          onClick={onToggleDrawerPosition}
          aria-label={isLeftPosition ? 'Move terminal to bottom' : 'Move terminal to left'}
          title={isLeftPosition ? 'Move to bottom' : 'Move to left'}
          disabled={editorBusy || !open}
        >
          <SqlTerminalPositionIcon left={isLeftPosition} />
        </button>
        <button
          type="button"
          className="iconBtn terminalClearBtn"
          onClick={onClear}
          aria-label="Clear output"
          title="Clear"
          disabled={editorBusy || !open}
        >
          <span className="terminalClearGlyph">⟲</span>
        </button>
        <button type="button" className="iconBtn headerDeleteBtn terminalCloseBtn" onClick={onClose} aria-label="Close" title="Close">
          <CloseIcon size={18} />
        </button>
      </div>
    </header>
  )
}
