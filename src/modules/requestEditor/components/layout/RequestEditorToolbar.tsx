import type { Dispatch, RefObject, SetStateAction } from 'react'
import { CopyIcon } from '../../../../shared/icons'
import { VariableAutocompleteField } from '../../../../shared/components/VariableAutocompleteField'
import type { VariableSuggestion } from '../../../../shared/utils/variables'
import type { HttpMethod } from '../../../collectionTree'

export function RequestEditorToolbar(props: {
  requestMethod: string
  onChangeMethod?: (method: HttpMethod) => void
  methodMenuOpen: boolean
  setMethodMenuOpen: Dispatch<SetStateAction<boolean>>
  methodMenuWrapRef: RefObject<HTMLDivElement | null>
  defaultMethodOptions: string[]
  visibleCustomMethodOptions: string[]
  isAddingMethod: boolean
  methodAddDraft: string
  setMethodAddDraft: Dispatch<SetStateAction<string>>
  methodAddInputRef: RefObject<HTMLInputElement | null>
  commitMethodAdd: (applyToRequest?: boolean) => void
  cancelMethodAdd: () => void
  selectMethod: (method: string) => void
  startMethodAdd: () => void
  removeCustomMethod: (method: string) => void
  isEditingUrl: boolean
  editorUrlMainDisplay: string
  startUrlEdit: (placeCursorAtEnd?: boolean) => void
  urlInputRef: RefObject<HTMLInputElement | null>
  urlDraftText: string
  setUrlDraftText: Dispatch<SetStateAction<string>>
  variableSuggestions: VariableSuggestion[]
  commitUrlEdit: (nextValue?: string) => void
  cancelUrlEdit: () => void
  variableKeys: string[]
  baseUrlKey: string
  setBaseUrlKey: Dispatch<SetStateAction<string>>
  environmentVariables?: Record<string, string>
  copyMenuOpen: boolean
  setCopyMenuOpen: Dispatch<SetStateAction<boolean>>
  copyMenuWrapRef: RefObject<HTMLDivElement | null>
  copyOk: boolean
  copyUrlText: () => Promise<void>
  copyCurlText: () => Promise<void>
  isSending: boolean
  canSend: boolean
  commitFocusedValueFieldToState: () => void
  cancelInFlightSend: () => void
  send: () => Promise<void>
}) {
  return (
    <div className="editorUrlWrap">
      <div
        className="mono editorUrl"
      >
        <div className="editorUrlText">
          <div ref={props.methodMenuOpen ? props.methodMenuWrapRef : null} className="methodMenuWrap">
            <button
              type="button"
              className="badge mono methodBadgeBtn"
              disabled={!props.onChangeMethod}
              onPointerDown={e => {
                if (!props.onChangeMethod) return
                e.stopPropagation()
              }}
              onClick={e => {
                if (!props.onChangeMethod) return
                e.preventDefault()
                e.stopPropagation()
                props.setMethodMenuOpen(v => !v)
              }}
              aria-label="Change method"
              title="Change method"
            >
              {props.requestMethod}
            </button>

            {props.methodMenuOpen ? (
              <div
                className="methodMenuPanel"
                role="menu"
                onPointerDown={e => {
                  e.stopPropagation()
                }}
                onClick={e => {
                  e.stopPropagation()
                }}
              >
                {props.defaultMethodOptions.map(m => (
                  <div key={m} className={`methodMenuItemRow ${m === props.requestMethod ? 'methodMenuItemActive' : ''}`}>
                    <button
                      type="button"
                      className="methodMenuItem mono"
                      role="menuitem"
                      onClick={() => props.selectMethod(m)}
                    >
                      {m}
                    </button>
                  </div>
                ))}
                {props.visibleCustomMethodOptions.length ? <div className="treeMenuDivider" role="separator" /> : null}
                {props.visibleCustomMethodOptions.map(m => (
                  <div key={m} className={`methodMenuItemRow methodMenuCustomItemRow ${m === props.requestMethod ? 'methodMenuItemActive' : ''}`}>
                    <button
                      type="button"
                      className="methodMenuItem mono methodMenuCustomItemBtn"
                      role="menuitem"
                      onClick={() => props.selectMethod(m)}
                    >
                      {m}
                    </button>
                    <button
                      type="button"
                      className="methodMenuDeleteBtn mono"
                      aria-label={`Delete method ${m}`}
                      title={`Delete method ${m}`}
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        props.removeCustomMethod(m)
                      }}
                    >
                      &times;
                    </button>
                  </div>
                ))}
                <div className="treeMenuDivider" role="separator" />
                {props.isAddingMethod ? (
                  <input
                    ref={props.methodAddInputRef}
                    className="methodMenuAddInput mono"
                    value={props.methodAddDraft}
                    placeholder="METHOD"
                    onChange={e => props.setMethodAddDraft(e.target.value.toUpperCase())}
                    onKeyDown={e => {
                      if (e.key === 'Enter') props.commitMethodAdd(true)
                      if (e.key === 'Escape') props.cancelMethodAdd()
                    }}
                    onBlur={() => props.commitMethodAdd(true)}
                  />
                ) : (
                  <button
                    type="button"
                    className="methodMenuItem mono methodMenuAddBtn"
                    role="menuitem"
                    onClick={props.startMethodAdd}
                  >
                    Add
                  </button>
                )}
              </div>
            ) : null}
          </div>

          <div
            className="editorUrlMain"
            role="button"
            tabIndex={0}
            title={props.editorUrlMainDisplay}
            onClick={() => {
              if (props.isEditingUrl) return
              props.startUrlEdit(true)
            }}
            onKeyDown={e => {
              if (props.isEditingUrl) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                props.startUrlEdit(true)
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            {props.isEditingUrl ? (
              <VariableAutocompleteField
                ref={props.urlInputRef as any}
                className="mono editorUrlInput"
                value={props.urlDraftText}
                suggestions={props.variableSuggestions}
                onChangeValue={props.setUrlDraftText}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => {
                  if (e.key === 'Enter') props.commitUrlEdit((e.currentTarget as HTMLInputElement).value)
                  if (e.key === 'Escape') props.cancelUrlEdit()
                }}
                onBlur={() => {
                  props.commitUrlEdit(props.urlInputRef.current?.value)
                }}
                style={{ flex: 1, minWidth: 0 }}
              />
            ) : (
              <span className="editorUrlValue">
                {props.editorUrlMainDisplay}
              </span>
            )}

            {props.isEditingUrl ? (
              <div className="editorUrlBaseUrlDock">
                <div
                  className="selectMenuPanel valueHistoryPanel editorUrlBaseUrlMenu"
                  role="menu"
                  onPointerDown={e => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                >
                  {props.variableKeys.length ? (
                    props.variableKeys.map(k => (
                      <button
                        key={k}
                        type="button"
                        className={`selectMenuItem ${k === props.baseUrlKey ? 'selectMenuItemActive' : ''}`}
                        role="menuitem"
                        onMouseDown={e => {
                          e.preventDefault()
                          e.stopPropagation()
                        }}
                        onClick={() => {
                          props.setBaseUrlKey(k)
                          props.cancelUrlEdit()
                        }}
                      >
                        <div className="mono">{k}</div>
                        {props.environmentVariables?.[k] ? (
                          <div className="varMenuDesc mono">{String(props.environmentVariables[k] ?? '')}</div>
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <div className="valueHistoryEmpty small">No URLs</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div ref={props.copyMenuOpen ? props.copyMenuWrapRef : null} className="methodMenuWrap">
          <button
            type="button"
            className="iconBtn editorUrlActionBtn"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              props.setCopyMenuOpen(v => !v)
            }}
            aria-label="Copy"
            title="Copy"
            style={{ width: 28, height: 28 }}
          >
            {props.copyOk ? 'OK' : <CopyIcon />}
          </button>

          {props.copyMenuOpen ? (
            <div
              className="methodMenuPanel copyMenuPanel"
              role="menu"
              onPointerDown={e => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              <button
                type="button"
                className="methodMenuItem mono"
                role="menuitem"
                onClick={() => {
                  props.setCopyMenuOpen(false)
                  void props.copyUrlText()
                }}
              >
                Copy URL
              </button>
              <button
                type="button"
                className="methodMenuItem mono"
                role="menuitem"
                onClick={() => {
                  props.setCopyMenuOpen(false)
                  void props.copyCurlText()
                }}
              >
                Copy cURL
              </button>
            </div>
          ) : null}
        </div>

        <div className="editorUrlSendWrap">
          <button
            className={`editorSendBtn ${props.isSending ? 'editorSendBtnCancel' : ''}`.trim()}
            onPointerDown={e => {
              e.stopPropagation()
              if (!props.isSending) props.commitFocusedValueFieldToState()
            }}
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              if (props.isSending) props.cancelInFlightSend()
              else void props.send()
            }}
            disabled={!props.canSend && !props.isSending}
          >
            {props.isSending ? 'Cancel' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
