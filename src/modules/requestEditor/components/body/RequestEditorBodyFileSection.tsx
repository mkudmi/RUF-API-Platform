import type { KeyboardEventHandler, PointerEventHandler, ReactNode, RefObject } from 'react'
import { CloseIcon, CopyIcon, PlusIcon, ReloadIcon, StarIcon } from '../../../../shared/icons'
import { ConfirmIconButton } from '../../../../shared/components/ConfirmIconButton'
import { VariableAutocompleteField } from '../../../../shared/components/VariableAutocompleteField'
import type { VariableSuggestion } from '../../../../shared/utils/variables'
import { JsonCodeEditor } from '../editors/JsonCodeEditor'
import type { MenuAnchor } from '../rows/RequestEditorRows'

export type BodyFormatOption = {
  id: string
  label: string
}

export function RequestEditorBodyFileSection(props: {
  isBodyOpen: boolean
  onToggleBodyOpen: (open: boolean) => void
  bodyFormatMenuWrapRef: RefObject<HTMLDivElement | null>
  bodyFormatMenuPanelRef: RefObject<HTMLDivElement | null>
  bodyFormatMenuOpen: boolean
  onToggleBodyFormatMenu: () => void
  bodyFormatId: string
  bodyFormatLabel: string
  bodyFormatOptions: BodyFormatOption[]
  onPickBodyFormat: (id: string) => void
  bodyFormatMenuAnchor: MenuAnchor
  hasExampleBody: boolean
  onReloadExampleBody: () => void
  onBeautifyBody: () => void
  onCopyBody: () => void
  bodyCopied: boolean
  onClearBody: () => void
  useJsonBodyEditor: boolean
  bodyText: string
  onChangeBodyText: (value: string) => void
  onSubmitShortcut: () => boolean
  variableSuggestions: VariableSuggestion[]
  bodyTextareaRef: RefObject<HTMLTextAreaElement | null>
  isMac: boolean
  onPlainBodyKeyDown: KeyboardEventHandler<HTMLTextAreaElement>
  onPlainBodyResizeHandlePointerDown: PointerEventHandler<HTMLDivElement>
  isFileOpen: boolean
  onToggleFileOpen: (open: boolean) => void
  isMultipartForm: boolean
  onAddFileRow: () => void
  filePicker: ReactNode
}) {
  return (
    <>
      <details
        className="accordion"
        open={props.isBodyOpen}
        onToggle={e => props.onToggleBodyOpen(e.currentTarget.open)}
      >
        <summary>
          <span>Body</span>
          <span style={{ marginLeft: 'auto' }} />
          <div ref={props.bodyFormatMenuWrapRef} className="selectMenuWrap" style={{ width: 120 }}>
            <button
              type="button"
              className="selectMenuBtn mono bodyFormatMenuBtn"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                props.onToggleBodyFormatMenu()
              }}
              aria-haspopup="menu"
              aria-expanded={props.bodyFormatMenuOpen}
              aria-label="Body format"
              title="Body format"
            >
              {props.bodyFormatLabel}
            </button>
          </div>
          <button
            type="button"
            className="bodyBeautifyBtn mono"
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              props.onReloadExampleBody()
            }}
            aria-label="Reload example body"
            title={props.hasExampleBody ? 'Reload example body' : 'Clear body'}
          >
            <ReloadIcon size={16} />
          </button>
          <button
            type="button"
            className="bodyBeautifyBtn mono"
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              props.onBeautifyBody()
            }}
            aria-label="Beautify"
            title="Beautify"
          >
            <StarIcon size={16} />
          </button>
          <button
            type="button"
            className="iconBtn"
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              props.onCopyBody()
            }}
            aria-label="Copy body"
            title="Copy body"
            style={{ width: 32, height: 32 }}
          >
            {props.bodyCopied ? 'OK' : <CopyIcon />}
          </button>
          <ConfirmIconButton
            className="iconBtn"
            onConfirm={props.onClearBody}
            ariaLabel="Clear body"
            confirmAriaLabel="Confirm clear body"
            title="Clear body"
            confirmTitle="Confirm clear body"
            icon={<CloseIcon size={18} />}
          />
        </summary>
        {props.useJsonBodyEditor ? (
          <JsonCodeEditor
            value={props.bodyText}
            onChangeValue={props.onChangeBodyText}
            onSubmitShortcut={props.onSubmitShortcut}
            variableSuggestions={props.variableSuggestions}
          />
        ) : (
          <>
            <VariableAutocompleteField
              as="textarea"
              ref={props.bodyTextareaRef as any}
              className="mono editorTextarea"
              style={props.isMac ? { resize: 'none' } : undefined}
              value={props.bodyText}
              spellCheck={false}
              suggestions={props.variableSuggestions}
              onChangeValue={props.onChangeBodyText}
              onKeyDown={props.onPlainBodyKeyDown}
              rows={18}
            />
            {props.isMac ? <div className="bodyResizeHandle" onPointerDown={props.onPlainBodyResizeHandlePointerDown} /> : null}
          </>
        )}
      </details>

      <details
        className="accordion"
        open={props.isFileOpen}
        onToggle={e => props.onToggleFileOpen(e.currentTarget.open)}
      >
        <summary>
          <span>File</span>
          <span style={{ marginLeft: 'auto' }} />
          <button
            type="button"
            className="iconBtn addRowBtn"
            aria-disabled={false}
            aria-label="Add file"
            title={props.isMultipartForm ? 'Add file' : 'Add file (multiple files are only sent for multipart/form-data)'}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              props.onAddFileRow()
            }}
          >
            <PlusIcon size={16} />
          </button>
        </summary>
        {props.filePicker}
      </details>

      {props.bodyFormatMenuOpen ? (
        <div
          ref={props.bodyFormatMenuPanelRef}
          className="selectMenuPanel"
          role="menu"
          style={{ position: 'fixed', left: props.bodyFormatMenuAnchor.left, top: props.bodyFormatMenuAnchor.top, width: props.bodyFormatMenuAnchor.width, zIndex: 200 }}
          onPointerDown={e => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          {props.bodyFormatOptions.map(option => (
            <button
              key={option.id}
              type="button"
              className={`selectMenuItem ${props.bodyFormatId === option.id ? 'selectMenuItemActive' : ''}`}
              role="menuitem"
              onClick={() => props.onPickBodyFormat(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}
