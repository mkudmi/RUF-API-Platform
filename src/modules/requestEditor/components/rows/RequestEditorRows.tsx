import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { RequestParam } from '../../../collectionTree'
import { CloseIcon } from '../../../../shared/icons'
import { VariableAutocompleteField } from '../../../../shared/components/VariableAutocompleteField'
import { ConfirmIconButton } from '../../../../shared/components/ConfirmIconButton'
import type { VariableSuggestion } from '../../../../shared/utils/variables'

export type MenuAnchor = { left: number, top: number, width: number }

function normalizeEnumOptions(enumValues: Array<string | number | boolean> | undefined): string[] {
  if (!enumValues?.length) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of enumValues) {
    const normalized = String(value)
    if (!normalized) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function EnumMenuPanel(props: {
  values: string[]
  currentValue: string
  anchor: MenuAnchor
  panelRef: RefObject<HTMLDivElement | null>
  onPick: (value: string) => void
}) {
  return (
    <div
      className="selectMenuPanel enumMenuPanel"
      ref={props.panelRef}
      role="listbox"
      style={{ position: 'fixed', left: props.anchor.left, top: props.anchor.top, width: props.anchor.width, zIndex: 210 }}
      onPointerDown={e => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {props.values.length ? (
        props.values.map(v => (
          <button
            key={v}
            type="button"
            className={`selectMenuItem ${v === props.currentValue ? 'selectMenuItemActive' : ''}`}
            role="option"
            aria-selected={v === props.currentValue}
            onClick={() => props.onPick(v)}
          >
            <div className="mono">{v}</div>
          </button>
        ))
      ) : (
        <div className="enumMenuEmpty small">No values</div>
      )}
    </div>
  )
}

type ValueHistoryMenuProps = {
  items: string[]
  anchor: MenuAnchor
  panelRef: RefObject<HTMLDivElement | null>
  onPick: (value: string) => void
  onDeleteItem: (value: string) => void
  onClearAll: () => void
}

function ValueHistoryMenu(props: ValueHistoryMenuProps) {
  return (
    <div
      className="selectMenuPanel valueHistoryPanel"
      ref={props.panelRef}
      role="menu"
      style={{ position: 'fixed', left: props.anchor.left, top: props.anchor.top, width: props.anchor.width, zIndex: 220 }}
      onPointerDown={e => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {props.items.length ? (
        props.items.map(v => (
          <div key={v} className="valueHistoryItemRow">
            <button
              type="button"
              className="selectMenuItem valueHistoryPickBtn"
              role="menuitem"
              onClick={() => props.onPick(v)}
            >
              <div className="mono valueHistoryText">{v}</div>
            </button>
            <button
              type="button"
              className="valueHistoryDeleteBtn"
              aria-label="Remove from history"
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                props.onDeleteItem(v)
              }}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        ))
      ) : (
        <div className="valueHistoryEmpty small">No history</div>
      )}
      <div className="valueHistoryFooterRow">
        <button
          type="button"
          className="valueHistoryClearBtn"
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
            props.onClearAll()
          }}
        >
          Clear History
        </button>
      </div>
    </div>
  )
}

type HistoryMenuProps = {
  historyItems: string[]
  historyMenuId: string
  historyMenuOpenId: string | null
  historyMenuAnchor: MenuAnchor | null
  onToggleHistoryMenu: (menuId: string, anchorEl: HTMLElement) => void
  onCloseHistoryMenu: () => void
  onPickHistory: (value: string) => void
  onDeleteHistoryItem: (value: string) => void
  onClearAllHistory: () => void
  historyMenuPanelRef: RefObject<HTMLDivElement | null>
}

type EnumMenuProps = {
  enumValues?: Array<string | number | boolean>
  enumMenuId?: string
  enumMenuOpenId: string | null
  enumMenuAnchor: MenuAnchor | null
  onToggleEnumMenu: (menuId: string, anchorEl: HTMLElement) => void
  onCloseEnumMenu: () => void
  enumMenuPanelRef: RefObject<HTMLDivElement | null>
}

type SharedEditableRowProps = HistoryMenuProps & Partial<EnumMenuProps> & {
  name: string
  value: string
  isActive: boolean
  placeholder?: string
  valueClassName?: string
  valueDataAttributes?: Record<string, string>
  variableSuggestions: VariableSuggestion[]
  onChangeValue: (value: string) => void
  onRecordHistory: (value: string) => void
}

function SharedEditableRowValue(props: SharedEditableRowProps) {
  const enumOptions = useMemo(() => normalizeEnumOptions(props.enumValues), [props.enumValues])
  const hasEnumMenu = enumOptions.length > 1 && !!props.enumMenuId

  return (
    <div
      style={{ position: 'relative', flex: 1, minWidth: 0 }}
      data-value-history-anchor
      data-enum-anchor={hasEnumMenu ? '' : undefined}
      {...props.valueDataAttributes}
    >
      <VariableAutocompleteField
        className={props.valueClassName}
        value={props.value}
        suggestions={props.variableSuggestions}
        onChangeValue={props.onChangeValue}
        onBlur={e => props.onRecordHistory((e.target as HTMLInputElement | HTMLTextAreaElement).value ?? props.value)}
        onClick={
          hasEnumMenu && props.onToggleEnumMenu && props.enumMenuId
            ? e => {
              const anchorEl = (e.currentTarget.closest('[data-enum-anchor]') as HTMLElement | null) ?? e.currentTarget
              const enumMenuId = props.enumMenuId
              const onToggleEnumMenu = props.onToggleEnumMenu
              if (!enumMenuId || !onToggleEnumMenu) return
              onToggleEnumMenu(enumMenuId, anchorEl)
            }
            : undefined
        }
        placeholder={props.placeholder}
      />
      <button
        type="button"
        className="valueHistoryBtn"
        data-value-history-btn
        aria-label="Value history"
        title="Value history"
        onClick={e => {
          e.preventDefault()
          e.stopPropagation()
          const anchorEl = (e.currentTarget.closest('[data-value-history-anchor]') as HTMLElement | null) ?? e.currentTarget
          props.onToggleHistoryMenu(props.historyMenuId, anchorEl)
        }}
      >
        ▾
      </button>
      {props.historyMenuOpenId === props.historyMenuId && props.historyMenuAnchor ? (
        <ValueHistoryMenu
          items={props.historyItems}
          anchor={props.historyMenuAnchor}
          panelRef={props.historyMenuPanelRef}
          onPick={value => {
            props.onPickHistory(value)
            props.onCloseHistoryMenu()
          }}
          onDeleteItem={props.onDeleteHistoryItem}
          onClearAll={props.onClearAllHistory}
        />
      ) : null}
      {hasEnumMenu && props.enumMenuId && props.enumMenuOpenId === props.enumMenuId && props.enumMenuAnchor && props.enumMenuPanelRef && props.onCloseEnumMenu ? (
        <EnumMenuPanel
          values={enumOptions}
          currentValue={props.value}
          anchor={props.enumMenuAnchor}
          panelRef={props.enumMenuPanelRef}
          onPick={picked => {
            props.onChangeValue(picked)
            props.onCloseEnumMenu?.()
          }}
        />
      ) : null}
    </div>
  )
}

export function ParamRow(props: {
  param: RequestParam
  store: Record<string, string>
  setStore: Dispatch<SetStateAction<Record<string, string>>>
  onClear?: () => void
  variableSuggestions: VariableSuggestion[]
  enumMenuOpenId?: string | null
  enumMenuId?: string
  enumMenuAnchor?: MenuAnchor | null
  onToggleEnumMenu?: (menuId: string, anchorEl: HTMLElement) => void
  onCloseEnumMenu?: () => void
  enumMenuPanelRef?: RefObject<HTMLDivElement | null>
  historyItems?: string[]
  onRecordHistory?: (value: string) => void
  onPickHistory?: (value: string) => void
  onDeleteHistoryItem?: (value: string) => void
  onClearAllHistory?: () => void
  historyMenuId?: string
  historyMenuOpenId?: string | null
  historyMenuAnchor?: MenuAnchor | null
  onToggleHistoryMenu?: (menuId: string, anchorEl: HTMLElement) => void
  onCloseHistoryMenu?: () => void
  historyMenuPanelRef?: RefObject<HTMLDivElement | null>
}) {
  const value = props.store[props.param.name] ?? ''
  const hint =
    typeof props.param.example === 'string' || typeof props.param.example === 'number'
      ? String(props.param.example)
      : props.param.schemaType || ''

  const canShowMenus =
    !!props.historyMenuId &&
    props.historyMenuOpenId !== undefined &&
    !!props.historyMenuPanelRef &&
    !!props.onToggleHistoryMenu &&
    !!props.onCloseHistoryMenu &&
    !!props.onPickHistory &&
    !!props.onDeleteHistoryItem &&
    !!props.onClearAllHistory

  return (
    <div className="formRow">
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <input
            className="mono keyInput"
            style={{ width: '100%', pointerEvents: 'none', opacity: 0.75 }}
            value={props.param.name}
            readOnly
            aria-readonly="true"
            tabIndex={-1}
          />
          {props.param.required ? <span className="reqStar keyReqStar">*</span> : null}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
        {canShowMenus ? (
          <SharedEditableRowValue
            name={props.param.name}
            value={value}
            isActive={true}
            placeholder={hint}
            valueClassName={`valueHistoryInput ${props.historyMenuId ? 'mono' : ''}`.trim()}
            valueDataAttributes={{
              'data-commit-kind': 'path',
              'data-commit-key': props.param.name,
            }}
            variableSuggestions={props.variableSuggestions}
            onChangeValue={nextValue => {
              props.setStore(prev => ({ ...prev, [props.param.name]: nextValue }))
            }}
            onRecordHistory={props.onRecordHistory ?? (() => {})}
            historyItems={props.historyItems ?? []}
            historyMenuId={props.historyMenuId!}
            historyMenuOpenId={props.historyMenuOpenId ?? null}
            historyMenuAnchor={props.historyMenuAnchor ?? null}
            onToggleHistoryMenu={props.onToggleHistoryMenu!}
            onCloseHistoryMenu={props.onCloseHistoryMenu!}
            onPickHistory={props.onPickHistory!}
            onDeleteHistoryItem={props.onDeleteHistoryItem!}
            onClearAllHistory={props.onClearAllHistory!}
            historyMenuPanelRef={props.historyMenuPanelRef!}
            enumValues={props.param.enumValues}
            enumMenuId={props.enumMenuId}
            enumMenuOpenId={props.enumMenuOpenId ?? null}
            enumMenuAnchor={props.enumMenuAnchor ?? null}
            onToggleEnumMenu={props.onToggleEnumMenu}
            onCloseEnumMenu={props.onCloseEnumMenu}
            enumMenuPanelRef={props.enumMenuPanelRef}
          />
        ) : (
          <div
            style={{ position: 'relative', flex: 1, minWidth: 0 }}
            data-value-history-anchor
            data-enum-anchor
            data-commit-kind="path"
            data-commit-key={props.param.name}
          >
            <VariableAutocompleteField
              className="valueHistoryInput mono"
              value={value}
              placeholder={hint}
              suggestions={props.variableSuggestions}
              onChangeValue={nextValue => {
                props.setStore(prev => ({ ...prev, [props.param.name]: nextValue }))
              }}
            />
          </div>
        )}
        {props.onClear ? (
          <button className="ghostBtn" onClick={props.onClear}>Clear</button>
        ) : null}
      </div>
    </div>
  )
}

export function HeaderRow(props: HistoryMenuProps & EnumMenuProps & {
  name: string
  value: string
  readOnlyName: boolean
  required?: boolean
  isActive: boolean
  onToggleActive: (isActive: boolean) => void
  onChangeValue: (value: string) => void
  onRecordHistory: (value: string) => void
  onRename?: (nextName: string) => void
  onDelete?: () => void
  variableSuggestions: VariableSuggestion[]
}) {
  const [draftName, setDraftName] = useState(props.name)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const keyIsLocked = props.readOnlyName || !!props.required
  const clearValueOnly = !!props.required

  useEffect(() => {
    setDraftName(props.name)
  }, [props.name])

  function commitRename(nextRaw?: string) {
    if (!props.onRename) return
    const next = (nextRaw ?? nameInputRef.current?.value ?? draftName).trim()
    if (next === props.name) {
      setDraftName(props.name)
      return
    }
    props.onRename(next)
  }

  return (
    <div className="formRow">
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          {keyIsLocked ? (
            <input
              className={`mono keyInput ${props.isActive ? '' : 'rowInactive'}`.trim()}
              style={clearValueOnly ? { width: '100%', pointerEvents: 'none', opacity: 0.75 } : { width: '100%' }}
              value={props.name}
              readOnly
              aria-readonly="true"
              tabIndex={-1}
            />
          ) : (
            <input
              ref={nameInputRef}
              className={`mono keyInput ${props.isActive ? '' : 'rowInactive'}`.trim()}
              style={{ width: '100%' }}
              value={draftName}
              data-commit-on-blur="1"
              onChange={e => setDraftName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename((e.currentTarget as HTMLInputElement).value)
                if (e.key === 'Escape') setDraftName(props.name)
              }}
              onBlur={e => commitRename(e.currentTarget.value)}
              placeholder="Key"
            />
          )}
          {props.required ? <span className="reqStar keyReqStar">*</span> : null}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <SharedEditableRowValue
          name={props.name}
          value={props.value}
          isActive={props.isActive}
          placeholder="Value"
          valueClassName={`mono valueHistoryInput ${props.isActive ? '' : 'rowInactive'}`.trim()}
          valueDataAttributes={{
            'data-commit-kind': 'header',
            'data-commit-key': props.name,
          }}
          variableSuggestions={props.variableSuggestions}
          onChangeValue={props.onChangeValue}
          onRecordHistory={props.onRecordHistory}
          historyItems={props.historyItems}
          historyMenuId={props.historyMenuId}
          historyMenuOpenId={props.historyMenuOpenId}
          historyMenuAnchor={props.historyMenuAnchor}
          onToggleHistoryMenu={props.onToggleHistoryMenu}
          onCloseHistoryMenu={props.onCloseHistoryMenu}
          onPickHistory={props.onPickHistory}
          onDeleteHistoryItem={props.onDeleteHistoryItem}
          onClearAllHistory={props.onClearAllHistory}
          historyMenuPanelRef={props.historyMenuPanelRef}
          enumValues={props.enumValues}
          enumMenuId={props.enumMenuId}
          enumMenuOpenId={props.enumMenuOpenId}
          enumMenuAnchor={props.enumMenuAnchor}
          onToggleEnumMenu={props.onToggleEnumMenu}
          onCloseEnumMenu={props.onCloseEnumMenu}
          enumMenuPanelRef={props.enumMenuPanelRef}
        />
        <label className="checkRow rowCheck" title={props.isActive ? 'Active' : 'Inactive'}>
          <input
            type="checkbox"
            className="checkInput"
            checked={props.isActive}
            aria-label={`Toggle ${props.name}`}
            onChange={e => props.onToggleActive(e.target.checked)}
            onClick={e => e.stopPropagation()}
          />
          <span className="checkBox" aria-hidden="true" />
        </label>
        {props.onDelete ? (
          <ConfirmIconButton
            className="headerDeleteBtn"
            onConfirm={props.onDelete}
            ariaLabel={clearValueOnly ? `Clear header value ${props.name}` : `Delete header ${props.name}`}
            confirmAriaLabel={clearValueOnly ? `Confirm clear header value ${props.name}` : `Confirm delete header ${props.name}`}
            title={clearValueOnly ? 'Clear value' : 'Delete'}
            confirmTitle={clearValueOnly ? 'Confirm clear value' : 'Confirm delete'}
            icon={<CloseIcon size={18} />}
          />
        ) : null}
      </div>
    </div>
  )
}

export function QueryRow(props: HistoryMenuProps & EnumMenuProps & {
  name: string
  rawName?: string
  isSpec?: boolean
  value: string
  hint?: string
  required?: boolean
  readOnlyName?: boolean
  isActive: boolean
  onToggleActive: (isActive: boolean) => void
  onChangeValue: (value: string) => void
  onRecordHistory: (value: string) => void
  onRename?: (nextName: string) => void
  onDelete?: () => void
  variableSuggestions: VariableSuggestion[]
}) {
  const [draftName, setDraftName] = useState(props.name)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const keyIsLocked = !!props.readOnlyName || !!props.required
  const clearValueOnly = !!props.required

  useEffect(() => {
    setDraftName(props.name)
  }, [props.name])

  function commitRename(nextRaw?: string) {
    if (!props.onRename) return
    const next = (nextRaw ?? nameInputRef.current?.value ?? draftName).trim()
    if (next === props.name) {
      setDraftName(props.name)
      return
    }
    props.onRename(next)
  }

  return (
    <div className="formRow">
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          {keyIsLocked ? (
            <input
              className={`mono keyInput ${props.isActive ? '' : 'rowInactive'}`.trim()}
              style={clearValueOnly ? { width: '100%', pointerEvents: 'none', opacity: 0.75 } : { width: '100%' }}
              value={props.name}
              readOnly
              aria-readonly="true"
              tabIndex={-1}
            />
          ) : (
            <input
              ref={nameInputRef}
              className={`mono keyInput ${props.isActive ? '' : 'rowInactive'}`.trim()}
              style={{ width: '100%' }}
              value={draftName}
              data-commit-on-blur="1"
              onChange={e => setDraftName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename((e.currentTarget as HTMLInputElement).value)
                if (e.key === 'Escape') setDraftName(props.name)
              }}
              onBlur={e => commitRename(e.currentTarget.value)}
              placeholder="Key"
            />
          )}
          {props.required ? <span className="reqStar keyReqStar">*</span> : null}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <SharedEditableRowValue
          name={props.name}
          value={props.value}
          isActive={props.isActive}
          placeholder={props.hint || 'Value'}
          valueClassName={`mono valueHistoryInput ${props.isActive ? '' : 'rowInactive'}`.trim()}
          valueDataAttributes={{
            'data-commit-kind': 'query',
            'data-commit-key': props.name,
            'data-commit-raw': props.rawName ?? props.name,
            'data-commit-spec': props.isSpec ? '1' : '0',
          }}
          variableSuggestions={props.variableSuggestions}
          onChangeValue={props.onChangeValue}
          onRecordHistory={props.onRecordHistory}
          historyItems={props.historyItems}
          historyMenuId={props.historyMenuId}
          historyMenuOpenId={props.historyMenuOpenId}
          historyMenuAnchor={props.historyMenuAnchor}
          onToggleHistoryMenu={props.onToggleHistoryMenu}
          onCloseHistoryMenu={props.onCloseHistoryMenu}
          onPickHistory={props.onPickHistory}
          onDeleteHistoryItem={props.onDeleteHistoryItem}
          onClearAllHistory={props.onClearAllHistory}
          historyMenuPanelRef={props.historyMenuPanelRef}
          enumValues={props.enumValues}
          enumMenuId={props.enumMenuId}
          enumMenuOpenId={props.enumMenuOpenId}
          enumMenuAnchor={props.enumMenuAnchor}
          onToggleEnumMenu={props.onToggleEnumMenu}
          onCloseEnumMenu={props.onCloseEnumMenu}
          enumMenuPanelRef={props.enumMenuPanelRef}
        />
        <label className="checkRow rowCheck" title={props.isActive ? 'Active' : 'Inactive'}>
          <input
            type="checkbox"
            className="checkInput"
            checked={props.isActive}
            aria-label={`Toggle ${props.name}`}
            onChange={e => props.onToggleActive(e.target.checked)}
            onClick={e => e.stopPropagation()}
          />
          <span className="checkBox" aria-hidden="true" />
        </label>
        {props.onDelete ? (
          <ConfirmIconButton
            className="rowDeleteBtn"
            onConfirm={props.onDelete}
            ariaLabel={clearValueOnly ? `Clear query value ${props.name}` : `Delete query param ${props.name}`}
            confirmAriaLabel={clearValueOnly ? `Confirm clear query value ${props.name}` : `Confirm delete query param ${props.name}`}
            title={clearValueOnly ? 'Clear value' : 'Delete'}
            confirmTitle={clearValueOnly ? 'Confirm clear value' : 'Confirm delete'}
            icon={<CloseIcon size={18} />}
          />
        ) : null}
      </div>
    </div>
  )
}

type DraftRowProps = HistoryMenuProps & {
  rowId: string
  name: string
  value: string
  isActive: boolean
  onToggleActive: (isActive: boolean) => void
  onChangeName: (nextName: string) => void
  onChangeValue: (nextValue: string) => void
  onRecordHistory: (value: string) => void
  onDelete: () => void
  canDelete?: boolean
  onCommit?: () => void
  variableSuggestions: VariableSuggestion[]
  commitKind: 'queryDraft' | 'headerDraft'
  deleteClassName: 'rowDeleteBtn' | 'headerDeleteBtn'
  deleteAriaLabel: string
  deleteConfirmAriaLabel: string
}

function DraftEditableRow(props: DraftRowProps) {
  const canDelete = props.canDelete ?? true

  return (
    <div className="formRow">
      <input
        className={`mono ${props.isActive ? '' : 'rowInactive'}`.trim()}
        value={props.name}
        onChange={e => props.onChangeName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            props.onCommit?.()
          }
        }}
        placeholder="Key"
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div
          style={{ position: 'relative', flex: 1, minWidth: 0 }}
          data-value-history-anchor
          data-commit-kind={props.commitKind}
          data-commit-rowid={props.rowId}
        >
          <VariableAutocompleteField
            className={`mono valueHistoryInput ${props.isActive ? '' : 'rowInactive'}`.trim()}
            value={props.value}
            suggestions={props.variableSuggestions}
            onChangeValue={props.onChangeValue}
            onBlur={e => {
              props.onRecordHistory((e.target as HTMLInputElement | HTMLTextAreaElement).value ?? props.value)
              props.onCommit?.()
            }}
            placeholder="Value"
          />
          <button
            type="button"
            className="valueHistoryBtn"
            data-value-history-btn
            aria-label="Value history"
            title="Value history"
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              const anchorEl = (e.currentTarget.closest('[data-value-history-anchor]') as HTMLElement | null) ?? e.currentTarget
              props.onToggleHistoryMenu(props.historyMenuId, anchorEl)
            }}
          >
            ▾
          </button>
          {props.historyMenuOpenId === props.historyMenuId && props.historyMenuAnchor ? (
            <ValueHistoryMenu
              items={props.historyItems}
              anchor={props.historyMenuAnchor}
              panelRef={props.historyMenuPanelRef}
              onPick={value => {
                props.onPickHistory(value)
                props.onCloseHistoryMenu()
              }}
              onDeleteItem={props.onDeleteHistoryItem}
              onClearAll={props.onClearAllHistory}
            />
          ) : null}
        </div>
        <label className="checkRow rowCheck" title={props.isActive ? 'Active' : 'Inactive'}>
          <input
            type="checkbox"
            className="checkInput"
            checked={props.isActive}
            aria-label={`Toggle ${props.name || 'row'}`}
            onChange={e => props.onToggleActive(e.target.checked)}
            onClick={e => e.stopPropagation()}
          />
          <span className="checkBox" aria-hidden="true" />
        </label>
        <ConfirmIconButton
          className={props.deleteClassName}
          onConfirm={props.onDelete}
          disabled={!canDelete}
          ariaLabel={props.deleteAriaLabel}
          confirmAriaLabel={props.deleteConfirmAriaLabel}
          title={canDelete ? 'Delete' : 'Cannot delete'}
          confirmTitle="Confirm delete"
          icon={<CloseIcon size={18} />}
        />
      </div>
    </div>
  )
}

export function QueryDraftRow(props: Omit<DraftRowProps, 'commitKind' | 'deleteClassName' | 'deleteAriaLabel' | 'deleteConfirmAriaLabel'>) {
  return (
    <DraftEditableRow
      {...props}
      commitKind="queryDraft"
      deleteClassName="rowDeleteBtn"
      deleteAriaLabel="Delete query param"
      deleteConfirmAriaLabel="Confirm delete query param"
    />
  )
}

export function HeaderDraftRow(props: Omit<DraftRowProps, 'commitKind' | 'deleteClassName' | 'deleteAriaLabel' | 'deleteConfirmAriaLabel'>) {
  return (
    <DraftEditableRow
      {...props}
      commitKind="headerDraft"
      deleteClassName="headerDeleteBtn"
      deleteAriaLabel="Delete header"
      deleteConfirmAriaLabel="Confirm delete header"
    />
  )
}
