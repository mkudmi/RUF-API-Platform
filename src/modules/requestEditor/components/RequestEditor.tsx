import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react'
import type { Collection, HttpMethod, RequestItem, RequestParam } from '../../collectionTree'
import type { Environment } from '../../../shared/types/environment'
import type { RequestDraft, RequestHistoryItem } from '../../../shared/types/requestHistory'
import { CloseIcon, CopyIcon, ReloadIcon, StarIcon } from '../../../shared/icons'
import { copyText } from '../../../shared/utils/clipboard'
import { computeEffectiveBaseUrl, isAbsoluteUrl, joinUrlParts } from '../../../shared/utils/url'
import { uid } from '../../../shared/utils/id'
import { runRequest, type RunResult } from '../../requestRunner/runRequest'
import { buildCurlCommand } from '../../requestRunner/buildCurl'
import { beautifyBody, type BeautifyBodyFormat } from '../utils/bodyBeautify'
import { DB_ENV_KEYS, buildDbConnectionString, getDbFormStateFromEnv, runDbSql } from '../../environment'
import { SqlScriptsTab } from './SqlScriptsTab'
import { AuthorizationTab } from './AuthorizationTab'
import { getVariableSuggestions, resolveVariableValue, type VariableSuggestion } from '../../../shared/utils/variables'
import { VariableAutocompleteField } from '../../../shared/components/VariableAutocompleteField'
import { loadRequestDraft, saveRequestDraft } from '../utils/draftStorage'
import { addValueHistoryEntry, loadValueHistory, removeValueHistoryEntry, saveValueHistory, type ValueHistoryKind, type ValueHistoryStore } from '../utils/valueHistory'

type BodyFormat = NonNullable<RequestDraft['bodyFormat']>

function normalizeBodyFormat(raw: unknown): BodyFormat {
  if (raw === 'auto' || raw === 'json' || raw === 'xml' || raw === 'yaml' || raw === 'text') return raw
  return 'auto'
}

function labelForBodyFormat(format: BodyFormat) {
  switch (format) {
    case 'json': return 'JSON'
    case 'xml': return 'XML'
    case 'yaml': return 'YAML'
    case 'text': return 'Plain Text'
    case 'auto': return 'Auto'
  }
}

function contentTypeForBodyFormat(format: Exclude<BodyFormat, 'auto'>) {
  switch (format) {
    case 'json': return 'application/json'
    case 'xml': return 'application/xml'
    case 'yaml': return 'application/yaml'
    case 'text': return 'text/plain'
  }
}

function inferBodyFormatFromContentType(contentType: string): BeautifyBodyFormat {
  const ct = (contentType || '').toLowerCase()
  if (ct.includes('json')) return 'json'
  if (ct.includes('yaml') || ct.includes('yml')) return 'yaml'
  if (ct.includes('xml')) return 'xml'
  if (ct.includes('text/plain')) return 'text'
  return 'text'
}

function shouldDefaultOpenFileTab(method: HttpMethod, contentType: string | undefined): boolean {
  if (method === 'GET' || method === 'HEAD') return false
  const ct = (contentType || '').toLowerCase()
  return ct.includes('multipart/form-data') || ct.includes('application/octet-stream')
}


function applyPathParamsForDisplay(url: string, values: Record<string, string>) {
  let out = ''
  for (let i = 0; i < url.length; i++) {
    const ch = url[i]
    if (ch !== '{') {
      out += ch
      continue
    }

    const next = url[i + 1] ?? ''
    if (next === '{') {
      const close = url.indexOf('}}', i + 2)
      if (close >= 0) {
        out += url.slice(i, close + 2)
        i = close + 1
        continue
      }
      out += ch
      continue
    }

    const close = url.indexOf('}', i + 1)
    if (close < 0) {
      out += ch
      continue
    }

    const key = url.slice(i + 1, close).trim()
    i = close

    const v = (values[key] ?? '').trim()
    out += v ? v : `{${key}}`
  }

  return out
}

function applyVariablesForDisplay(text: string, vars: Record<string, string>) {
  return text.replaceAll(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m: string, name: string) => resolveVariableValue(name, vars) ?? '')
}

function extractPathParamNamesFromTemplate(template: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (let i = 0; i < template.length; i++) {
    const ch = template[i]
    if (ch !== '{') continue

    const next = template[i + 1] ?? ''
    if (next === '{') {
      // Skip {{variables}}
      const close = template.indexOf('}}', i + 2)
      if (close >= 0) i = close + 1
      continue
    }

    const close = template.indexOf('}', i + 1)
    if (close < 0) continue
    if (template[close + 1] === '}') continue // ignore "}}"

    const name = template.slice(i + 1, close).trim()
    i = close

    if (!name) continue
    if (name.includes('{') || name.includes('}')) continue
    if (name.includes('/') || name.includes('?') || name.includes('#')) continue

    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }

  return out
}

function applySchemeIfHostLike(url: string, scheme: 'http' | 'https') {
  const raw = url.trim().replace(/\/+$/, '')
  if (!raw) return ''
  if (isAbsoluteUrl(raw) || raw.startsWith('/') || raw.startsWith('//')) return raw

  const looksLikeHost =
    /^localhost(?::\d+)?(?:\/.*)?$/i.test(raw) ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/.*)?$/.test(raw) ||
    /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(raw)

  if (!looksLikeHost) return raw
  return `${scheme}://${raw}`.replace(/\/+$/, '')
}

function defaultQueryParamsFromSpec(_params: RequestParam[]) {
  // Imported query params should render as editable fields with placeholder hints,
  // without automatically pre-filling values from examples.
  return {}
}

type DraftRow = { id: string, name: string, value: string, isActive: boolean }

function normalizeDraftRows(raw: unknown, prefix: 'qrow' | 'hrow'): DraftRow[] {
  if (!Array.isArray(raw)) return []
  const out: DraftRow[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as { id?: unknown, name?: unknown, value?: unknown, isActive?: unknown }
    const name = typeof row.name === 'string' ? row.name : ''
    const value = typeof row.value === 'string' ? row.value : ''
    const isActive = typeof row.isActive === 'boolean' ? row.isActive : true
    const id = typeof row.id === 'string' && row.id ? row.id : uid(prefix)
    out.push({ id, name, value, isActive })
  }
  return out
}

type FileRow = { id: string, fieldName: string, file: File | null, isActive: boolean }
type DraftFileRow = { fieldName: string, isActive: boolean }

function normalizeDraftFileRows(raw: unknown): DraftFileRow[] {
  if (!Array.isArray(raw)) return []
  const out: DraftFileRow[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as { fieldName?: unknown, isActive?: unknown }
    const fieldName = typeof row.fieldName === 'string' ? row.fieldName : ''
    const isActive = typeof row.isActive === 'boolean' ? row.isActive : true
    out.push({ fieldName, isActive })
  }
  return out
}

function setFlagForKey(prev: Record<string, true>, keyRaw: string, active: boolean): Record<string, true> {
  const key = keyRaw.trim()
  if (!key) return prev
  if (active) {
    if (!(key in prev)) return prev
    const next = { ...prev }
    delete next[key]
    return next
  }
  if (key in prev) return prev
  return { ...prev, [key]: true }
}

function renameFlagKey(prev: Record<string, true>, fromKey: string, toKey: string): Record<string, true> {
  const from = fromKey.trim()
  const to = toKey.trim()
  if (!from || !to || from === to) return prev
  if (!(from in prev)) return prev
  if (to in prev) {
    const next = { ...prev }
    delete next[from]
    return next
  }
  const next = { ...prev }
  delete next[from]
  next[to] = true
  return next
}

function setFlagForHeaderName(prev: Record<string, true>, headerNameRaw: string, active: boolean): Record<string, true> {
  const headerName = headerNameRaw.trim()
  if (!headerName) return prev
  const needle = headerName.toLowerCase()

  let changed = false
  const next: Record<string, true> = {}
  for (const k of Object.keys(prev)) {
    if (k.toLowerCase() === needle) {
      changed = true
      continue
    }
    next[k] = true
  }

  if (!active) {
    if (!(headerName in next)) {
      next[headerName] = true
      changed = true
    }
  }

  return changed ? next : prev
}

function headerIsInactive(inactiveHeaderNames: Record<string, true>, headerName: string): boolean {
  const needle = headerName.toLowerCase()
  for (const k of Object.keys(inactiveHeaderNames)) {
    if (k.toLowerCase() === needle) return true
  }
  return false
}

function headerNameExistsCaseInsensitive(headers: Record<string, string>, name: string): boolean {
  const needle = name.toLowerCase()
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === needle) return true
  }
  return false
}

function defaultInactiveQueryParamNamesFromSpec(params: RequestParam[]): Record<string, true> {
  const out: Record<string, true> = {}
  for (const p of params) {
    if (!p || p.in !== 'query') continue
    if (p.required !== false) continue
    const name = (p.name || '').trim()
    if (!name) continue
    out[name] = true
  }
  return out
}

function defaultInactiveHeaderNamesFromSpec(params: RequestParam[], requestBaseHeaders: Record<string, string>): Record<string, true> {
  const out: Record<string, true> = {}
  for (const p of params) {
    if (!p || p.in !== 'header') continue
    if (p.required !== false) continue
    const name = (p.name || '').trim()
    if (!name) continue
    const lower = name.toLowerCase()
    if (lower === 'authorization') continue
    if (headerNameExistsCaseInsensitive(requestBaseHeaders, name)) continue
    out[name] = true
  }
  return out
}

function removeInactiveHeaders(headers: Record<string, string>, inactiveHeaderNames: Record<string, true>): Record<string, string> {
  const needles = new Set(Object.keys(inactiveHeaderNames).map(k => k.toLowerCase()).filter(Boolean))
  if (!needles.size) return headers
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (needles.has(k.toLowerCase())) continue
    next[k] = v
  }
  return next
}

function ConfirmIconButton(props: {
  className: string
  onConfirm: () => void
  disabled?: boolean
  ariaLabel: string
  confirmAriaLabel?: string
  title?: string
  confirmTitle?: string
  icon: ReactNode
  timeoutMs?: number
}) {
  const timeoutMs = props.timeoutMs ?? 5500
  const [armed, setArmed] = useState(false)
  const timerRef = useRef<number | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!armed) return
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setArmed(false), timeoutMs)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [armed, timeoutMs])

  useEffect(() => {
    if (!armed) return

    function onGlobalPointerDown(e: PointerEvent) {
      const el = btnRef.current
      if (!el) return
      const target = e.target as Node | null
      if (target && el.contains(target)) return
      setArmed(false)
    }

    window.addEventListener('pointerdown', onGlobalPointerDown, true)
    return () => window.removeEventListener('pointerdown', onGlobalPointerDown, true)
  }, [armed])

  return (
    <button
      type="button"
      className={`${props.className} ${armed ? 'confirmActionArmed' : ''}`.trim()}
      disabled={props.disabled}
      aria-disabled={props.disabled}
      aria-label={armed ? (props.confirmAriaLabel ?? props.ariaLabel) : props.ariaLabel}
      title={armed ? (props.confirmTitle ?? props.title) : props.title}
      ref={btnRef}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        if (props.disabled) return
        if (!armed) {
          setArmed(true)
          return
        }
        setArmed(false)
        props.onConfirm()
      }}
    >
      {armed ? <span className="confirmActionGlyph">!</span> : props.icon}
    </button>
  )
}

function normalizeEnumOptions(enumValues: Array<string | number | boolean> | undefined): string[] {
  if (!Array.isArray(enumValues) || enumValues.length === 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of enumValues) {
    const s = String(v ?? '').trim()
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function EnumMenuPanel(props: {
  values: string[]
  currentValue: string
  anchor: { left: number, top: number, width: number }
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

function ParamRow(props: { 
  param: RequestParam 
  store: Record<string, string> 
  setStore: Dispatch<SetStateAction<Record<string, string>>> 
  onClear?: () => void 
  variableSuggestions: VariableSuggestion[] 
  enumMenuOpenId?: string | null
  enumMenuId?: string
  enumMenuAnchor?: { left: number, top: number, width: number } | null
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
  historyMenuAnchor?: { left: number, top: number, width: number } | null 
  onToggleHistoryMenu?: (menuId: string, anchorEl: HTMLElement) => void 
  onCloseHistoryMenu?: () => void 
  historyMenuPanelRef?: RefObject<HTMLDivElement | null> 
}) { 
  const value = props.store[props.param.name] ?? '' 
  const hint =
    typeof props.param.example === 'string' || typeof props.param.example === 'number'
      ? String(props.param.example)
      : props.param.schemaType || ''

  const enumOptions = normalizeEnumOptions(props.param.enumValues)
  const hasEnumMenu =
    enumOptions.length > 1 &&
    !!props.enumMenuId &&
    props.enumMenuOpenId !== undefined &&
    !!props.enumMenuPanelRef &&
    !!props.onToggleEnumMenu &&
    !!props.onCloseEnumMenu

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
      <div 
        style={{ position: 'relative', flex: 1, minWidth: 0 }} 
        data-value-history-anchor 
        data-enum-anchor
        data-commit-kind="path" 
        data-commit-key={props.param.name} 
      > 
        <VariableAutocompleteField
          className={`valueHistoryInput ${props.historyMenuId ? 'mono' : ''}`.trim()}
          value={value}
          placeholder={hint}
          suggestions={props.variableSuggestions}
          onBlur={
            props.onRecordHistory
              ? e => props.onRecordHistory!((e.target as HTMLInputElement | HTMLTextAreaElement).value ?? value)
              : undefined
          }
          onClick={
            hasEnumMenu
              ? e => {
                const anchorEl = (e.currentTarget.closest('[data-enum-anchor]') as HTMLElement | null) ?? e.currentTarget
                props.onToggleEnumMenu?.(props.enumMenuId!, anchorEl)
              }
              : undefined
          }
          onChangeValue={nextValue => {
            props.setStore(prev => {
              if (nextValue !== '') return { ...prev, [props.param.name]: nextValue }
              if (!(props.param.name in prev)) return prev
              const next = { ...prev }
              delete next[props.param.name]
              return next
            })
          }}
        />

        {props.historyMenuId && props.onToggleHistoryMenu && props.historyMenuOpenId !== undefined ? (
          <>
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
                props.onToggleHistoryMenu?.(props.historyMenuId!, anchorEl)
              }}
            >
              ▾
            </button>
            {props.historyMenuOpenId === props.historyMenuId && props.historyMenuAnchor && props.historyMenuPanelRef ? (
              <div
                className="selectMenuPanel valueHistoryPanel"
                ref={props.historyMenuPanelRef}
                role="menu"
                style={{ position: 'fixed', left: props.historyMenuAnchor.left, top: props.historyMenuAnchor.top, width: props.historyMenuAnchor.width, zIndex: 220 }}
                onPointerDown={e => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
              >
                {(props.historyItems ?? []).length ? (
                  (props.historyItems ?? []).map(v => (
                    <div key={v} className="valueHistoryItemRow">
                      <button
                        type="button"
                        className="selectMenuItem valueHistoryPickBtn"
                        role="menuitem"
                        onClick={() => {
                          props.onPickHistory?.(v)
                          props.onCloseHistoryMenu?.()
                        }}
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
                          props.onDeleteHistoryItem?.(v)
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
                      props.onClearAllHistory?.()
                    }}
                  >
                    Clear History
                  </button>
                </div>
              </div>
            ) : null}
          </> 
           ) : null} 

        {hasEnumMenu && props.enumMenuOpenId === props.enumMenuId && props.enumMenuAnchor && props.enumMenuPanelRef ? (
          <EnumMenuPanel
            values={enumOptions}
            currentValue={value}
            anchor={props.enumMenuAnchor}
            panelRef={props.enumMenuPanelRef}
            onPick={picked => {
              props.setStore(prev => ({ ...prev, [props.param.name]: picked }))
              props.onCloseEnumMenu?.()
            }}
          />
        ) : null}
      </div> 
      {props.onClear ? ( 
        <ConfirmIconButton
          className="rowDeleteBtn"
          onConfirm={() => props.onClear?.()}
          disabled={!value}
          ariaLabel={`Clear path param ${props.param.name}`}
          confirmAriaLabel={`Confirm clear path param ${props.param.name}`}
          title={value ? 'Clear' : 'Empty'}
          confirmTitle="Confirm clear"
          icon={<CloseIcon size={18} />}
        />
      ) : null} 
      </div> 
    </div> 
  ) 
} 

function findKeyIndexCaseInsensitive(list: string[], needle: string): number {
  const n = needle.toLowerCase()
  for (let i = 0; i < list.length; i++) {
    if ((list[i] ?? '').toLowerCase() === n) return i
  }
  return -1
}

function replaceKeyInOrder(prev: string[], fromKey: string, toKey: string): string[] {
  const from = fromKey.trim()
  const to = toKey.trim()
  if (!from || !to || from === to) return prev
  const fromIdx = prev.indexOf(from)
  if (fromIdx < 0) {
    return prev.includes(to) ? prev : [...prev, to]
  }
  const withoutTo = prev.filter(k => k !== to)
  const next = [...withoutTo]
  const idx = next.indexOf(from)
  next[idx] = to
  return next
}

function replaceKeyInOrderCaseInsensitive(prev: string[], fromKey: string, toKey: string): string[] {
  const from = fromKey.trim()
  const to = toKey.trim()
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return prev
  const fromIdx = findKeyIndexCaseInsensitive(prev, from)
  if (fromIdx < 0) {
    return findKeyIndexCaseInsensitive(prev, to) >= 0 ? prev : [...prev, to]
  }
  const next = prev.filter(k => (k ?? '').toLowerCase() !== to.toLowerCase())
  const idx = findKeyIndexCaseInsensitive(next, from)
  next[idx] = to
  return next
}

function normalizeHeaderParams(
  requestHeaders: RequestParam[],
  headersStore: Record<string, string>,
  keyOrder: string[],
) {
  const spec = requestHeaders.filter(Boolean)
  const out: RequestParam[] = [...spec]
  for (const k of Object.keys(headersStore)) {
    if (spec.some(x => x.name === k)) continue
    out.push({ name: k, in: 'header', required: false })
  }
  // Preserve a stable, explicit order for all rows (old at top, new at bottom).
  const decorated = out.map((p, i) => {
    const idx = findKeyIndexCaseInsensitive(keyOrder, p.name)
    return { p, sortKey: (idx >= 0 ? idx : (1_000_000 + i)) }
  })
  decorated.sort((a, b) => a.sortKey - b.sortKey)
  return decorated.map(x => x.p)
}

function renameStoreKey(
  prev: Record<string, string>,
  fromKey: string,
  toKey: string,
) {
  const from = fromKey.trim()
  const to = toKey.trim()
  if (!from || !to || to === from) return prev
  const value = prev[from]
  if (value === undefined) return prev
  if (Object.prototype.hasOwnProperty.call(prev, to)) return prev
  const next: Record<string, string> = { ...prev }
  delete next[from]
  next[to] = value
  return next
}

function HeaderRow(props: {
  name: string
  value: string
  readOnlyName: boolean
  required?: boolean
  isActive: boolean
  onToggleActive: (isActive: boolean) => void
  onChangeValue: (value: string) => void
  onRename?: (nextName: string) => void
  onDelete?: () => void
  variableSuggestions: VariableSuggestion[]
  historyItems: string[]
  onRecordHistory: (value: string) => void
  onPickHistory: (value: string) => void
  onDeleteHistoryItem: (value: string) => void
  onClearAllHistory: () => void
  historyMenuId: string
  historyMenuOpenId: string | null
  historyMenuAnchor: { left: number, top: number, width: number } | null
  onToggleHistoryMenu: (menuId: string, anchorEl: HTMLElement) => void
  onCloseHistoryMenu: () => void
  historyMenuPanelRef: RefObject<HTMLDivElement | null>
  enumValues?: Array<string | number | boolean>
  enumMenuId?: string
  enumMenuOpenId: string | null
  enumMenuAnchor: { left: number, top: number, width: number } | null
  onToggleEnumMenu: (menuId: string, anchorEl: HTMLElement) => void
  onCloseEnumMenu: () => void
  enumMenuPanelRef: RefObject<HTMLDivElement | null>
}) {
  const [draftName, setDraftName] = useState(props.name)
  const enumOptions = useMemo(() => normalizeEnumOptions(props.enumValues), [props.enumValues])
  const hasEnumMenu = enumOptions.length > 1 && !!props.enumMenuId
  const keyIsLocked = props.readOnlyName || !!props.required
  const clearValueOnly = !!props.required

  useEffect(() => {
    setDraftName(props.name)
  }, [props.name])

  function commitRename() {
    if (!props.onRename) return
    const next = draftName.trim()
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
              className={`mono keyInput ${props.isActive ? '' : 'rowInactive'}`.trim()}
              style={{ width: '100%' }}
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setDraftName(props.name)
              }}
              onBlur={commitRename}
              placeholder="Key"
            />
          )}
          {props.required ? <span className="reqStar keyReqStar">*</span> : null}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div
          style={{ position: 'relative', flex: 1, minWidth: 0 }}
          data-value-history-anchor
          data-enum-anchor
          data-commit-kind="header"
          data-commit-key={props.name}
        >
          <VariableAutocompleteField
            className={`mono valueHistoryInput ${props.isActive ? '' : 'rowInactive'}`.trim()}
            value={props.value}
            suggestions={props.variableSuggestions}
            onChangeValue={props.onChangeValue}
            onBlur={e => props.onRecordHistory((e.target as HTMLInputElement | HTMLTextAreaElement).value ?? props.value)}
            onClick={
              hasEnumMenu
                ? e => {
                  const anchorEl = (e.currentTarget.closest('[data-enum-anchor]') as HTMLElement | null) ?? e.currentTarget
                  props.onToggleEnumMenu(props.enumMenuId!, anchorEl)
                }
                : undefined
            }
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
            <div
              className="selectMenuPanel valueHistoryPanel"
              ref={props.historyMenuPanelRef}
              role="menu"
              style={{ position: 'fixed', left: props.historyMenuAnchor.left, top: props.historyMenuAnchor.top, width: props.historyMenuAnchor.width, zIndex: 220 }}
              onPointerDown={e => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              {props.historyItems.length ? (
                props.historyItems.map(v => (
                  <div key={v} className="valueHistoryItemRow">
                    <button
                      type="button"
                      className="selectMenuItem valueHistoryPickBtn"
                      role="menuitem"
                      onClick={() => {
                        props.onPickHistory(v)
                        props.onCloseHistoryMenu()
                      }}
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
                        props.onDeleteHistoryItem(v)
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
                    props.onClearAllHistory()
                  }}
                >
                  Clear History
                </button>
              </div>
            </div>
          ) : null}
          {hasEnumMenu && props.enumMenuOpenId === props.enumMenuId && props.enumMenuAnchor ? (
            <EnumMenuPanel
              values={enumOptions}
              currentValue={props.value}
              anchor={props.enumMenuAnchor}
              panelRef={props.enumMenuPanelRef}
              onPick={picked => {
                props.onChangeValue(picked)
                props.onCloseEnumMenu()
              }}
            />
          ) : null}
        </div>
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

function QueryRow(props: {
  name: string
  rawName?: string
  isSpec?: boolean
  value: string
  hint?: string
  enumValues?: Array<string | number | boolean>
  required?: boolean
  readOnlyName?: boolean
  isActive: boolean
  onToggleActive: (isActive: boolean) => void
  onChangeValue: (value: string) => void
  onRename?: (nextName: string) => void
  onDelete?: () => void
  variableSuggestions: VariableSuggestion[]
  historyItems: string[]
  onRecordHistory: (value: string) => void
  onPickHistory: (value: string) => void
  onDeleteHistoryItem: (value: string) => void
  onClearAllHistory: () => void
  historyMenuId: string
  historyMenuOpenId: string | null
  historyMenuAnchor: { left: number, top: number, width: number } | null
  onToggleHistoryMenu: (menuId: string, anchorEl: HTMLElement) => void
  onCloseHistoryMenu: () => void
  historyMenuPanelRef: RefObject<HTMLDivElement | null>
  enumMenuId?: string
  enumMenuOpenId: string | null
  enumMenuAnchor: { left: number, top: number, width: number } | null
  onToggleEnumMenu: (menuId: string, anchorEl: HTMLElement) => void
  onCloseEnumMenu: () => void
  enumMenuPanelRef: RefObject<HTMLDivElement | null>
}) {
  const [draftName, setDraftName] = useState(props.name)
  const enumOptions = useMemo(() => normalizeEnumOptions(props.enumValues), [props.enumValues])
  const hasEnumMenu = enumOptions.length > 1 && !!props.enumMenuId
  const keyIsLocked = !!props.readOnlyName || !!props.required
  const clearValueOnly = !!props.required

  useEffect(() => {
    setDraftName(props.name)
  }, [props.name])

  function commitRename() {
    if (!props.onRename) return
    const next = draftName.trim()
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
              className={`mono keyInput ${props.isActive ? '' : 'rowInactive'}`.trim()}
              style={{ width: '100%' }}
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setDraftName(props.name)
              }}
              onBlur={commitRename}
              placeholder="Key"
            />
          )}
          {props.required ? <span className="reqStar keyReqStar">*</span> : null}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div
          style={{ position: 'relative', flex: 1, minWidth: 0 }}
          data-value-history-anchor
          data-enum-anchor
          data-commit-kind="query"
          data-commit-key={props.name}
          data-commit-raw={props.rawName ?? props.name}
          data-commit-spec={props.isSpec ? '1' : '0'}
        >
          <VariableAutocompleteField
            className={`mono valueHistoryInput ${props.isActive ? '' : 'rowInactive'}`.trim()}
            value={props.value}
            suggestions={props.variableSuggestions}
            onChangeValue={props.onChangeValue}
            onBlur={e => props.onRecordHistory((e.target as HTMLInputElement | HTMLTextAreaElement).value ?? props.value)}
            onClick={
              hasEnumMenu
                ? e => {
                  const anchorEl = (e.currentTarget.closest('[data-enum-anchor]') as HTMLElement | null) ?? e.currentTarget
                  props.onToggleEnumMenu(props.enumMenuId!, anchorEl)
                }
                : undefined
            }
            placeholder={props.hint || 'Value'}
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
            <div
              className="selectMenuPanel valueHistoryPanel"
              ref={props.historyMenuPanelRef}
              role="menu"
              style={{ position: 'fixed', left: props.historyMenuAnchor.left, top: props.historyMenuAnchor.top, width: props.historyMenuAnchor.width, zIndex: 220 }}
              onPointerDown={e => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              {props.historyItems.length ? (
                props.historyItems.map(v => (
                  <div key={v} className="valueHistoryItemRow">
                    <button
                      type="button"
                      className="selectMenuItem valueHistoryPickBtn"
                      role="menuitem"
                      onClick={() => {
                        props.onPickHistory(v)
                        props.onCloseHistoryMenu()
                      }}
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
                        props.onDeleteHistoryItem(v)
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
                    props.onClearAllHistory()
                  }}
                >
                  Clear History
                </button>
              </div>
            </div>
          ) : null}
          {hasEnumMenu && props.enumMenuOpenId === props.enumMenuId && props.enumMenuAnchor ? (
            <EnumMenuPanel
              values={enumOptions}
              currentValue={props.value}
              anchor={props.enumMenuAnchor}
              panelRef={props.enumMenuPanelRef}
              onPick={picked => {
                props.onChangeValue(picked)
                props.onCloseEnumMenu()
              }}
            />
          ) : null}
        </div>
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

function QueryDraftRow(props: {
  rowId: string
  name: string
  value: string
  isActive: boolean
  onToggleActive: (isActive: boolean) => void
  onChangeName: (nextName: string) => void
  onChangeValue: (nextValue: string) => void
  onDelete: () => void
  canDelete?: boolean
  onCommit?: () => void
  variableSuggestions: VariableSuggestion[]
  historyItems: string[]
  onRecordHistory: (value: string) => void
  onPickHistory: (value: string) => void
  onDeleteHistoryItem: (value: string) => void
  onClearAllHistory: () => void
  historyMenuId: string
  historyMenuOpenId: string | null
  historyMenuAnchor: { left: number, top: number, width: number } | null
  onToggleHistoryMenu: (menuId: string, anchorEl: HTMLElement) => void
  onCloseHistoryMenu: () => void
  historyMenuPanelRef: RefObject<HTMLDivElement | null>
}) {
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
          data-commit-kind="queryDraft"
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
            <div
              className="selectMenuPanel valueHistoryPanel"
              ref={props.historyMenuPanelRef}
              role="menu"
              style={{ position: 'fixed', left: props.historyMenuAnchor.left, top: props.historyMenuAnchor.top, width: props.historyMenuAnchor.width, zIndex: 220 }}
              onPointerDown={e => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              {props.historyItems.length ? (
                props.historyItems.map(v => (
                  <div key={v} className="valueHistoryItemRow">
                    <button
                      type="button"
                      className="selectMenuItem valueHistoryPickBtn"
                      role="menuitem"
                      onClick={() => {
                        props.onPickHistory(v)
                        props.onCloseHistoryMenu()
                      }}
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
                        props.onDeleteHistoryItem(v)
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
                    props.onClearAllHistory()
                  }}
                >
                  Clear History
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <label className="checkRow rowCheck" title={props.isActive ? 'Active' : 'Inactive'}>
          <input
            type="checkbox"
            className="checkInput"
            checked={props.isActive}
            aria-label={`Toggle ${props.name || 'query param'}`}
            onChange={e => props.onToggleActive(e.target.checked)}
            onClick={e => e.stopPropagation()}
          />
          <span className="checkBox" aria-hidden="true" />
        </label>
        <ConfirmIconButton
          className="rowDeleteBtn"
          onConfirm={props.onDelete}
          disabled={!canDelete}
          ariaLabel="Delete query param"
          confirmAriaLabel="Confirm delete query param"
          title={canDelete ? 'Delete' : 'Cannot delete'}
          confirmTitle="Confirm delete"
          icon={<CloseIcon size={18} />}
        />
      </div>
    </div>
  )
}

function HeaderDraftRow(props: {
  rowId: string
  name: string
  value: string
  isActive: boolean
  onToggleActive: (isActive: boolean) => void
  onChangeName: (nextName: string) => void
  onChangeValue: (nextValue: string) => void
  onDelete: () => void
  canDelete?: boolean
  onCommit?: () => void
  variableSuggestions: VariableSuggestion[]
  historyItems: string[]
  onRecordHistory: (value: string) => void
  onPickHistory: (value: string) => void
  onDeleteHistoryItem: (value: string) => void
  onClearAllHistory: () => void
  historyMenuId: string
  historyMenuOpenId: string | null
  historyMenuAnchor: { left: number, top: number, width: number } | null
  onToggleHistoryMenu: (menuId: string, anchorEl: HTMLElement) => void
  onCloseHistoryMenu: () => void
  historyMenuPanelRef: RefObject<HTMLDivElement | null>
}) {
  const canDelete = props.canDelete ?? true
  return (
    <div className="formRow">
      <input
        className="mono"
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
          data-commit-kind="headerDraft"
          data-commit-rowid={props.rowId}
        >
          <VariableAutocompleteField
            className="mono valueHistoryInput"
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
            <div
              className="selectMenuPanel valueHistoryPanel"
              ref={props.historyMenuPanelRef}
              role="menu"
              style={{ position: 'fixed', left: props.historyMenuAnchor.left, top: props.historyMenuAnchor.top, width: props.historyMenuAnchor.width, zIndex: 220 }}
              onPointerDown={e => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              {props.historyItems.length ? (
                props.historyItems.map(v => (
                  <div key={v} className="valueHistoryItemRow">
                    <button
                      type="button"
                      className="selectMenuItem valueHistoryPickBtn"
                      role="menuitem"
                      onClick={() => {
                        props.onPickHistory(v)
                        props.onCloseHistoryMenu()
                      }}
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
                        props.onDeleteHistoryItem(v)
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
                    props.onClearAllHistory()
                  }}
                >
                  Clear History
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <label className="checkRow rowCheck" title={props.isActive ? 'Active' : 'Inactive'}>
          <input
            type="checkbox"
            className="checkInput"
            checked={props.isActive}
            aria-label={`Toggle ${props.name || 'header'}`}
            onChange={e => props.onToggleActive(e.target.checked)}
            onClick={e => e.stopPropagation()}
          />
          <span className="checkBox" aria-hidden="true" />
        </label>
        <ConfirmIconButton
          className="headerDeleteBtn"
          onConfirm={props.onDelete}
          disabled={!canDelete}
          ariaLabel="Delete header"
          confirmAriaLabel="Confirm delete header"
          title={canDelete ? 'Delete' : 'Cannot delete'}
          confirmTitle="Confirm delete"
          icon={<CloseIcon size={18} />}
        />
      </div>
    </div>
  )
}

export function RequestEditor(props: {
  environment?: Environment
  collection: Collection
  request: RequestItem
  inFlightCount?: number
  onBeforeSend?: (requestId: string, item: RequestHistoryItem) => void
  onSendStart?: (requestId: string, runId: string) => void
  onSendEnd?: (requestId: string, runId: string) => void
  onResult: (requestId: string, result: RunResult, runId: string) => void
  onChangeMethod?: (method: HttpMethod) => void
  applyDraft?: { token: string, draft: RequestDraft } | null
}) {
  const bodyFileInputRef = useRef<HTMLInputElement | null>(null)
  const activeFileRowIdRef = useRef<string | null>(null)
  const urlInputRef = useRef<HTMLInputElement | null>(null)
  const urlEditStartRef = useRef('')
  const methodMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const valueHistoryMenuPanelRef = useRef<HTMLDivElement | null>(null)
  const enumMenuPanelRef = useRef<HTMLDivElement | null>(null)

  const [pathParams, setPathParams] = useState<Record<string, string>>({})
  const [queryParams, setQueryParams] = useState<Record<string, string>>({})
  const [queryDraftRows, setQueryDraftRows] = useState<Array<{ id: string, name: string, value: string, isActive: boolean }>>([])
  const [queryKeyOrder, setQueryKeyOrder] = useState<string[]>([])
  const [queryParamKeyOverrides, setQueryParamKeyOverrides] = useState<Record<string, string>>({})
  const [disabledQueryParamNames, setDisabledQueryParamNames] = useState<Record<string, true>>({})
  const [inactiveQueryParamNames, setInactiveQueryParamNames] = useState<Record<string, true>>({})
  const [headerOverrides, setHeaderOverrides] = useState<Record<string, string>>({})
  const [disabledHeaderNames, setDisabledHeaderNames] = useState<Record<string, true>>({})
  const [inactiveHeaderNames, setInactiveHeaderNames] = useState<Record<string, true>>({})
  const [headerDraftRows, setHeaderDraftRows] = useState<Array<{ id: string, name: string, value: string, isActive: boolean }>>([])
  const [headerKeyOrder, setHeaderKeyOrder] = useState<string[]>([])
  const [valueHistory, setValueHistory] = useState<ValueHistoryStore>(() => loadValueHistory())
  const [valueHistoryMenuOpenId, setValueHistoryMenuOpenId] = useState<string | null>(null)
  const [valueHistoryMenuAnchor, setValueHistoryMenuAnchor] = useState<{ left: number, top: number, width: number } | null>(null)
  const [enumMenuOpenId, setEnumMenuOpenId] = useState<string | null>(null)
  const [enumMenuAnchor, setEnumMenuAnchor] = useState<{ left: number, top: number, width: number } | null>(null)
  const [fileRows, setFileRows] = useState<FileRow[]>(() => (
    [{ id: uid('frow'), fieldName: '', file: null, isActive: true }]
  ))
  const [baseUrlKey, setBaseUrlKey] = useState('baseUrl')
  const [copyMenuOpen, setCopyMenuOpen] = useState(false)
  const copyMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const [copyOk, setCopyOk] = useState(false)
  const [urlTemplateOverride, setUrlTemplateOverride] = useState('')
  const [isEditingUrl, setIsEditingUrl] = useState(false)
  const [urlDraftText, setUrlDraftText] = useState('')
  const [methodMenuOpen, setMethodMenuOpen] = useState(false)
  const [headersTab, setHeadersTab] = useState<'headers' | 'authorization' | 'sql'>('headers')

  function commitQueryDraftRowById(rowId: string) {
    const row = queryDraftRows.find(r => r.id === rowId)
    if (!row) return
    const key = row.name.trim()
    if (!key || row.value === '') return
    if (querySpecNames.has(key)) return
    if (hasOwn(queryParams, key)) return

    setQueryKeyOrder(prev => (prev.includes(key) ? prev : [...prev, key]))
    setQueryParams(prev => ({ ...prev, [key]: row.value }))
    setInactiveQueryParamNames(prev => setFlagForKey(prev, key, row.isActive))
    setDisabledQueryParamNames(prev => {
      if (!hasOwn(prev, key)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setQueryDraftRows(prev => prev.filter(r => r.id !== rowId))
  }

  function commitHeaderDraftRowById(rowId: string) {
    const row = headerDraftRows.find(r => r.id === rowId)
    if (!row) return
    const key = row.name.trim()
    if (!key || row.value === '') return

    const lower = key.toLowerCase()
    const hasCommitted = Object.keys(committedHeaders).some(k => k.toLowerCase() === lower)
    if (hasCommitted) return

    setHeaderKeyOrder(prev => (findKeyIndexCaseInsensitive(prev, key) >= 0 ? prev : [...prev, key]))
    setHeaderValueForRequest(key, row.value)
    setInactiveHeaderNames(prev => setFlagForHeaderName(prev, key, row.isActive))
    setHeaderDraftRows(prev => prev.filter(r => r.id !== rowId))
  }

  function recordValueHistory(kind: ValueHistoryKind, key: string, value: string) {
    setValueHistory(prev => {
      const next = addValueHistoryEntry(prev, kind, key, value, 10)
      if (next === prev) return prev
      saveValueHistory(next)
      return next
    })
  }

  function deleteValueHistoryItem(kind: ValueHistoryKind, key: string, value: string) {
    setValueHistory(prev => {
      const next = removeValueHistoryEntry(prev, kind, key, value)
      if (next === prev) return prev
      saveValueHistory(next)
      return next
    })
  }

  function clearAllValueHistory() {
    const empty: ValueHistoryStore = { header: {}, query: {}, path: {} }
    setValueHistory(empty)
    saveValueHistory(empty)
  }

  function closeValueHistoryMenu() {
    setValueHistoryMenuOpenId(null)
    setValueHistoryMenuAnchor(null)
  }

  function closeEnumMenu() {
    setEnumMenuOpenId(null)
    setEnumMenuAnchor(null)
  }

  function toggleValueHistoryMenu(menuId: string, anchorEl: HTMLElement) {
    if (valueHistoryMenuOpenId === menuId) {
      closeValueHistoryMenu()
      return
    }

    closeEnumMenu()

    const rect = anchorEl.getBoundingClientRect()
    const margin = 8
    const assumedMaxHeight = 240

    let width = rect.width
    if (width < 220) width = 220
    if (width > 520) width = 520

    let left = rect.left
    let top = rect.bottom + 6

    if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - width)
    if (left < margin) left = margin

    if (top + assumedMaxHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - 6 - assumedMaxHeight)
    }

    setValueHistoryMenuOpenId(menuId)
    setValueHistoryMenuAnchor({ left, top, width })
  }

  function toggleEnumMenu(menuId: string, anchorEl: HTMLElement) {
    if (enumMenuOpenId === menuId) {
      closeEnumMenu()
      return
    }

    closeValueHistoryMenu()

    const rect = anchorEl.getBoundingClientRect()
    const margin = 8
    const assumedMaxHeight = 240

    let width = rect.width
    if (width < 220) width = 220
    if (width > 520) width = 520

    let left = rect.left
    let top = rect.bottom + 6

    if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - width)
    if (left < margin) left = margin

    if (top + assumedMaxHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - 6 - assumedMaxHeight)
    }

    setEnumMenuOpenId(menuId)
    setEnumMenuAnchor({ left, top, width })
  }

  function commitFocusedValueFieldToState() {
    const active = document.activeElement as (HTMLInputElement | HTMLTextAreaElement | null)
    if (!active || !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return

    const wrap = active.closest<HTMLElement>('[data-commit-kind]')
    if (!wrap) return

    const kind = wrap.dataset.commitKind
    const key = wrap.dataset.commitKey ?? ''
    const rawName = wrap.dataset.commitRaw ?? key
    const isSpec = wrap.dataset.commitSpec === '1'
    const rowId = wrap.dataset.commitRowid ?? ''
    const value = String(active.value ?? '')

    if (kind === 'path') {
      setPathParams(prev => {
        if (value !== '') return { ...prev, [key]: value }
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
      return
    }

    if (kind === 'query') {
      setQueryParams(prev => {
        const next = { ...prev }
        next[key] = value
        if (isSpec && rawName && key !== rawName) delete next[rawName]
        return next
      })
      return
    }

    if (kind === 'header') {
      if (!key) return
      setHeaderValueForRequest(key, value)
      return
    }

    if (kind === 'queryDraft') {
      if (!rowId) return
      setQueryDraftRows(prev => prev.map(r => (r.id === rowId ? { ...r, value } : r)))
      return
    }

    if (kind === 'headerDraft') {
      if (!rowId) return
      setHeaderDraftRows(prev => prev.map(r => (r.id === rowId ? { ...r, value } : r)))
      return
    }
  }

  useEffect(() => {
    if (!valueHistoryMenuOpenId) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (valueHistoryMenuPanelRef.current && valueHistoryMenuPanelRef.current.contains(t)) return
      if (t.closest?.('[data-value-history-btn]')) return
      closeValueHistoryMenu()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeValueHistoryMenu()
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [valueHistoryMenuOpenId])

  useEffect(() => {
    if (!enumMenuOpenId) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (enumMenuPanelRef.current && enumMenuPanelRef.current.contains(t)) return
      if (t.closest?.('[data-enum-anchor]')) return
      closeEnumMenu()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeEnumMenu()
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [enumMenuOpenId])

  const [preSqlScript, setPreSqlScript] = useState('')
  const [postSqlScript, setPostSqlScript] = useState('')

  function hasOwn<T extends object>(obj: T, key: string): key is Extract<keyof T, string> {
    return Object.prototype.hasOwnProperty.call(obj, key)
  }

  function parseUrlInput(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) return { template: '', hasQuery: false, query: {} as Record<string, string> }

    const hashIdx = trimmed.indexOf('#')
    const withoutHash = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed
    const qIdx = withoutHash.indexOf('?')

    const template = (qIdx >= 0 ? withoutHash.slice(0, qIdx) : withoutHash).trim()
    const qs = qIdx >= 0 ? withoutHash.slice(qIdx + 1) : ''
    if (!qs) return { template, hasQuery: false, query: {} as Record<string, string> }

    const usp = new URLSearchParams(qs)
    const query: Record<string, string> = {}
    usp.forEach((v, k) => {
      query[k] = v
    })
    return { template, hasQuery: true, query }
  }

  const baseUrl = useMemo(() => {
    const envVars = props.environment?.variables ?? {}
    const envKey = props.environment?.baseUrlKey || 'baseUrl'
    const preferredKey = baseUrlKey || envKey
    const resolvedKey = Object.prototype.hasOwnProperty.call(envVars, preferredKey) ? preferredKey : envKey
    const envBaseUrl = envVars[resolvedKey] ?? ''
    const scheme = String(envVars.scheme || '').trim().toLowerCase() === 'https' ? 'https' : 'http'
    const effective = computeEffectiveBaseUrl(envBaseUrl, props.collection.baseUrl)
    return applySchemeIfHostLike(effective, scheme)
  }, [baseUrlKey, props.collection.baseUrl, props.environment])

  const variables = useMemo(() => {
    const envVars = props.environment?.variables ?? {}
    const envKey = props.environment?.baseUrlKey || 'baseUrl'
    const preferredKey = baseUrlKey || envKey
    const resolvedKey = Object.prototype.hasOwnProperty.call(envVars, preferredKey) ? preferredKey : envKey
    const selectedBaseUrl = envVars[resolvedKey] ?? ''
    const scheme = String(envVars.scheme || '').trim().toLowerCase() === 'https' ? 'https' : 'http'
    const effective = computeEffectiveBaseUrl(selectedBaseUrl, props.collection.baseUrl)
    const effectiveWithScheme = applySchemeIfHostLike(effective, scheme)
    return { ...envVars, scheme, baseUrl: effectiveWithScheme }
  }, [baseUrlKey, props.collection.baseUrl, props.environment])

  const variableSuggestions = useMemo<VariableSuggestion[]>(() => getVariableSuggestions(variables), [variables])

  const effectiveQueryParams = useMemo(() => {
    const next: Record<string, string> = { ...queryParams }
    for (const row of queryDraftRows) {
      const k = row.name.trim()
      if (!k) continue
      if (row.value === '') continue
      next[k] = row.value
    }
    return next
  }, [queryDraftRows, queryParams])

  const urlEditorText = useMemo(() => {
    const override = urlTemplateOverride.trim()
    const baseTemplate =
      override
        ? (isAbsoluteUrl(override) || override.startsWith('//'))
          ? override
          : baseUrl
            ? joinUrlParts(baseUrl, override)
            : override
        : baseUrl
          ? joinUrlParts(baseUrl, props.request.path)
          : props.request.urlTemplate

    const inactiveDraftKeys = new Set(queryDraftRows.filter(r => !r.isActive).map(r => r.name.trim()).filter(Boolean))
    const pairs: string[] = []
    for (const [k, v] of Object.entries(effectiveQueryParams)) {
      if (inactiveQueryParamNames[k]) continue
      if (inactiveDraftKeys.has(k)) continue
      if (!k) continue
      if (v === '') continue
      pairs.push(`${k}=${v}`)
    }
    if (!pairs.length) return baseTemplate
    return baseTemplate + (baseTemplate.includes('?') ? '&' : '?') + pairs.join('&')
  }, [baseUrl, effectiveQueryParams, inactiveQueryParamNames, props.request.path, props.request.urlTemplate, queryDraftRows, urlTemplateOverride])

  const derivedPathParamNames = useMemo(() => {
    const raw = isEditingUrl ? urlDraftText : urlEditorText
    const parsed = parseUrlInput(raw)
    return extractPathParamNamesFromTemplate(parsed.template || '')
  }, [isEditingUrl, urlDraftText, urlEditorText])

  const pathParamsList = useMemo(() => {
    const spec = props.request.params.filter(p => p.in === 'path')
    const specNames = new Set(spec.map(p => p.name))
    const extras = derivedPathParamNames
      .filter(n => !specNames.has(n))
      .map(n => ({ name: n, in: 'path' as const, required: false }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return [...spec, ...extras]
  }, [derivedPathParamNames, props.request.params])

  const envHeaders = (props.environment?.headers ?? {}) as Record<string, string>
  const requestBaseHeaders = (props.request.headers ?? {}) as Record<string, string>



  const committedHeaders = useMemo(() => {
    const next: Record<string, string> = { ...envHeaders, ...requestBaseHeaders, ...headerOverrides }
    for (const key of Object.keys(disabledHeaderNames)) delete next[key]
    return next
  }, [disabledHeaderNames, envHeaders, headerOverrides, requestBaseHeaders])

  const effectiveHeaders = useMemo(() => {
    const next: Record<string, string> = { ...committedHeaders }
    for (const row of headerDraftRows) {
      const k = row.name.trim()
      if (!k) continue
      if (row.value === '') continue
      next[k] = row.value
    }
    return next
  }, [committedHeaders, headerDraftRows])

  const envOnlyHeaderNames = useMemo(() => {
    return Object.keys(envHeaders).filter(k => !hasOwn(requestBaseHeaders, k) && k !== 'authorization')
  }, [envHeaders, requestBaseHeaders])

  const hasDisabledEnvOnlyHeaders = useMemo(() => {
    return envOnlyHeaderNames.some(k => hasOwn(disabledHeaderNames, k))
  }, [disabledHeaderNames, envOnlyHeaderNames])

  function reloadFromGlobalHeaders() {
    setDisabledHeaderNames(prev => {
      let changed = false
      const next = { ...prev }
      for (const k of envOnlyHeaderNames) {
        if (!hasOwn(next, k)) continue
        delete next[k]
        changed = true
      }
      return changed ? next : prev
    })

    setHeaderDraftRows(prev => {
      if (prev.some(r => r.name.trim() || r.value !== '')) return prev
      return []
    })
  }

  function setHeaderValueForRequest(headerName: string, nextValue: string) {
    const baseHas = hasOwn(requestBaseHeaders, headerName)
    const envHas = hasOwn(envHeaders, headerName)
    const defaultValue = baseHas ? (requestBaseHeaders[headerName] ?? '') : envHas ? (envHeaders[headerName] ?? '') : ''

    if (nextValue === '') {
      setInactiveHeaderNames(prev => setFlagForHeaderName(prev, headerName, true))
      setHeaderOverrides(prev => {
        if (!hasOwn(prev, headerName)) return prev
        const { [headerName]: _removed, ...rest } = prev
        return rest
      })
      if (baseHas || envHas) {
        setDisabledHeaderNames(prev => ({ ...prev, [headerName]: true }))
      } else {
        setDisabledHeaderNames(prev => {
          if (!hasOwn(prev, headerName)) return prev
          const next = { ...prev }
          delete next[headerName]
          return next
        })
      }
      return
    }

    setDisabledHeaderNames(prev => {
      if (!hasOwn(prev, headerName)) return prev
      const next = { ...prev }
      delete next[headerName]
      return next
    })

    setHeaderOverrides(prev => {
      if ((baseHas || envHas) && nextValue === defaultValue) {
        if (!hasOwn(prev, headerName)) return prev
        const { [headerName]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [headerName]: nextValue }
    })
  }

  const displayUrl = useMemo(() => {
    const override = urlTemplateOverride.trim()
    const url =
      override
        ? (isAbsoluteUrl(override) || override.startsWith('//'))
          ? override
          : baseUrl
            ? joinUrlParts(baseUrl, override)
            : override
        : baseUrl
          ? joinUrlParts(baseUrl, props.request.path)
          : props.request.urlTemplate
    const withPathParams = applyPathParamsForDisplay(url, pathParams)

    const usp = new URLSearchParams()
    const inactiveDraftKeys = new Set(queryDraftRows.filter(r => !r.isActive).map(r => r.name.trim()).filter(Boolean))
    for (const [k, v] of Object.entries(effectiveQueryParams)) {
      if (inactiveQueryParamNames[k]) continue
      if (inactiveDraftKeys.has(k)) continue
      const nextK = applyVariablesForDisplay(k, variables)
      const nextV = applyVariablesForDisplay(v, variables)
      if (nextK && nextV !== '') usp.set(nextK, nextV)
    }
    const qs = usp.toString()
    if (!qs) return withPathParams
    return withPathParams + (withPathParams.includes('?') ? '&' : '?') + qs
  }, [baseUrl, effectiveQueryParams, inactiveQueryParamNames, pathParams, props.request.path, props.request.urlTemplate, queryDraftRows, variables, urlTemplateOverride])

  const canSend = useMemo(() => {
    const override = urlTemplateOverride.trim()
    if (!override) return !!baseUrl
    if (isAbsoluteUrl(override) || override.startsWith('//')) return true
    return !!baseUrl
  }, [baseUrl, urlTemplateOverride])

  const variableKeys = useMemo(() => {
    const envVars = props.environment?.variables ?? {}
    const keys = Object.keys(envVars)
      .filter(k => k !== 'scheme')
      .filter(k => /url/i.test(k))
      .sort((a, b) => a.localeCompare(b))
    if (!keys.length && baseUrlKey) return [baseUrlKey]
    if (baseUrlKey && !keys.includes(baseUrlKey)) return [...keys, baseUrlKey].sort((a, b) => a.localeCompare(b))
    return keys
  }, [baseUrlKey, props.environment])

  const [bodyText, setBodyText] = useState('')
  const [bodyCopied, setBodyCopied] = useState(false)
  const [isBodyOpen, setIsBodyOpen] = useState(!!props.request.body)
  const [isFileOpen, setIsFileOpen] = useState(shouldDefaultOpenFileTab(props.request.method, props.request.body?.contentType))
  const [bodyFormat, setBodyFormat] = useState<BodyFormat>('auto')
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const bodyFormatMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const [bodyFormatMenuOpen, setBodyFormatMenuOpen] = useState(false)
  const bodyFormatMenuPanelRef = useRef<HTMLDivElement | null>(null)
  const [bodyFormatMenuAnchor, setBodyFormatMenuAnchor] = useState<{ left: number, top: number, width: number }>({
    left: 0,
    top: 0,
    width: 120,
  })
  const draftSaveTimerRef = useRef<number | null>(null)

  const inFlightCount = props.inFlightCount ?? 0
  const isSending = inFlightCount > 0
  const sendRef = useRef<(() => void) | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  function cancelInFlightSend() {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }

  function requestDefaultBodyText() {
    const b = props.request.body?.example
    if (b === undefined) return ''
    if (typeof b === 'string') return b
    return JSON.stringify(b, null, 2)
  }

  const hasExampleBody = props.request.body?.example !== undefined

  function reloadExampleBodyText() {
    const next = requestDefaultBodyText()
    setBodyText(next)
    bodyTextareaRef.current?.focus()
  }

  useEffect(() => {
    const draft = loadRequestDraft(props.request.id)
    const nextPathParams = draft?.pathParams ?? {}
    const nextQueryParams = draft?.queryParams ?? defaultQueryParamsFromSpec(props.request.params)
    const nextQueryDraftRows = normalizeDraftRows(draft?.queryDraftRows, 'qrow')
    const nextDisabledQueryParamNames =
      draft?.disabledQueryParamNames && typeof draft.disabledQueryParamNames === 'object' ? draft.disabledQueryParamNames : {}
    const nextInactiveQueryParamNames =
      draft?.inactiveQueryParamNames && typeof draft.inactiveQueryParamNames === 'object'
        ? draft.inactiveQueryParamNames
        : (draft ? {} : defaultInactiveQueryParamNamesFromSpec(props.request.params))

    const env = props.environment?.headers ?? {}
    const base = props.request.headers ?? {}

    const nextHeaderOverrides = (() => {
      if (draft?.headerOverrides && typeof draft.headerOverrides === 'object') return draft.headerOverrides
      const legacy = draft?.headers && typeof draft.headers === 'object' ? draft.headers : null
      if (!legacy) return {}
      const overrides: Record<string, string> = {}
      for (const [k, v] of Object.entries(legacy)) {
        if (!(k in base) && (k in env) && env[k] === v) continue
        if (!(k in base) || base[k] !== v) overrides[k] = v
      }
      return overrides
    })()

    const nextDisabledHeaderNames =
      draft?.disabledHeaderNames && typeof draft.disabledHeaderNames === 'object' ? draft.disabledHeaderNames : {}

    const nextInactiveHeaderNames =
      draft?.inactiveHeaderNames && typeof draft.inactiveHeaderNames === 'object'
        ? draft.inactiveHeaderNames
        : (draft ? {} : defaultInactiveHeaderNamesFromSpec(props.request.params, base))
    const nextHeaderDraftRows = normalizeDraftRows(draft?.headerDraftRows, 'hrow')

    const headersForSeedCheck = (() => {
      const next: Record<string, string> = { ...env, ...base, ...nextHeaderOverrides }
      for (const key of Object.keys(nextDisabledHeaderNames)) delete next[key]
      return next
    })()

    const nextQueryKeyOrder = (() => {
      const raw = Array.isArray(draft?.queryKeyOrder) ? draft?.queryKeyOrder : null
      const stored = (raw ?? []).filter(x => typeof x === 'string')
      if (stored.length) return stored

      const overrides = (draft?.queryParamKeyOverrides && typeof draft.queryParamKeyOverrides === 'object')
        ? draft.queryParamKeyOverrides as Record<string, string>
        : {}
      const overriddenKeys = new Set(Object.values(overrides).filter(Boolean))
      const specRaw = props.request.params.filter(p => p.in === 'query').map(p => p.name).filter(Boolean)
      const disabledSpec = new Set(Object.keys(nextDisabledQueryParamNames).filter(Boolean))
      const specEffective = specRaw
        .filter(n => !disabledSpec.has(n))
        .map(n => (overrides[n] ?? n))
        .filter(Boolean)

      const specRawSet = new Set(specRaw)
      const extras = Object.keys(nextQueryParams).filter(k => !specRawSet.has(k) && !overriddenKeys.has(k))
      return [...specEffective, ...extras]
    })()

    const nextHeaderKeyOrder = (() => {
      const raw = Array.isArray(draft?.headerKeyOrder) ? draft?.headerKeyOrder : null
      const stored = (raw ?? []).filter(x => typeof x === 'string')
      if (stored.length) return stored

      const spec = props.request.params
        .filter(p => p.in === 'header')
        .map(p => p.name)
        .filter(n => typeof n === 'string' && n && n.toLowerCase() !== 'authorization')

      const combinedKeys = Object.keys(headersForSeedCheck).filter(k => k.toLowerCase() !== 'authorization')
      const out: string[] = []
      for (const k of spec) {
        if (findKeyIndexCaseInsensitive(out, k) >= 0) continue
        out.push(k)
      }
      for (const k of combinedKeys) {
        if (findKeyIndexCaseInsensitive(out, k) >= 0) continue
        out.push(k)
      }
      return out
    })()

    const hasQueryParamsSpec = props.request.params.some(p => p.in === 'query')
    const hasQueryParamsStore = Object.keys(nextQueryParams).length > 0
    const shouldSeedQueryDraft = !hasQueryParamsSpec && !hasQueryParamsStore && nextQueryDraftRows.length === 0

    const hasHeadersSpec = props.request.params.some(p => p.in === 'header' && p.name.toLowerCase() !== 'authorization')
    const hasHeadersStore = Object.keys(headersForSeedCheck).some(k => k.toLowerCase() !== 'authorization')
    const shouldSeedHeaderDraft = !hasHeadersSpec && !hasHeadersStore && nextHeaderDraftRows.length === 0

    setPathParams(nextPathParams)
    setQueryParams(nextQueryParams)
    setQueryDraftRows(nextQueryDraftRows.length ? nextQueryDraftRows : (shouldSeedQueryDraft ? [{ id: uid('qrow'), name: '', value: '', isActive: true }] : []))
    setQueryParamKeyOverrides(draft?.queryParamKeyOverrides ?? {})
    setDisabledQueryParamNames(nextDisabledQueryParamNames)
    setInactiveQueryParamNames(nextInactiveQueryParamNames)
    setQueryKeyOrder(nextQueryKeyOrder)
    setHeaderOverrides(nextHeaderOverrides)
    setDisabledHeaderNames(nextDisabledHeaderNames)
    setInactiveHeaderNames(nextInactiveHeaderNames)
    setHeaderDraftRows(nextHeaderDraftRows.length ? nextHeaderDraftRows : (shouldSeedHeaderDraft ? [{ id: uid('hrow'), name: '', value: '', isActive: true }] : []))
    setHeaderKeyOrder(nextHeaderKeyOrder)
    setBaseUrlKey(draft?.baseUrlKey || props.environment?.baseUrlKey || 'baseUrl')
    const nextBodyText = draft?.bodyText ?? requestDefaultBodyText()
    setBodyText(nextBodyText)
    setIsBodyOpen(!!props.request.body)
    const nextBodyFormat = normalizeBodyFormat(draft?.bodyFormat)
    setBodyFormat(nextBodyFormat)
    setIsFileOpen(shouldDefaultOpenFileTab(props.request.method, props.request.body?.contentType))
    setUrlTemplateOverride(draft?.urlTemplateOverride ?? '')
    setIsEditingUrl(false)
    setUrlDraftText('')
    setFileRows(() => {
      const storedRows = normalizeDraftFileRows(draft?.fileRows)
      if (storedRows.length) return storedRows.map(r => ({ id: uid('frow'), fieldName: r.fieldName, file: null, isActive: r.isActive }))
      const rawList = Array.isArray(draft?.fileFieldNames) ? draft?.fileFieldNames : null
      const names = (rawList ?? []).filter(x => typeof x === 'string')
      const seed = names.length ? names : ['']
      return seed.map(name => ({ id: uid('frow'), fieldName: name, file: null, isActive: true }))
    })
    setPreSqlScript(draft?.preSqlScript ?? '')
    setPostSqlScript(draft?.postSqlScript ?? '')
  }, [props.request.body, props.request.headers, props.request.id, props.request.params])

  const applyDraftToken = props.applyDraft?.token ?? null
  const applyDraftRef = useRef<RequestDraft | null>(null)
  useEffect(() => {
    applyDraftRef.current = props.applyDraft?.draft ?? null
  }, [props.applyDraft])

  useEffect(() => {
    const draft = applyDraftRef.current
    if (!applyDraftToken || !draft) return

    const nextPathParams = draft?.pathParams ?? {}
    const nextQueryParams = draft?.queryParams ?? defaultQueryParamsFromSpec(props.request.params)
    const nextQueryDraftRows = normalizeDraftRows(draft?.queryDraftRows, 'qrow')
    const nextDisabledQueryParamNames =
      draft?.disabledQueryParamNames && typeof draft.disabledQueryParamNames === 'object' ? (draft.disabledQueryParamNames as Record<string, true>) : {}
    const nextInactiveQueryParamNames =
      draft?.inactiveQueryParamNames && typeof draft.inactiveQueryParamNames === 'object' ? draft.inactiveQueryParamNames : {}

    const env = props.environment?.headers ?? {}
    const base = props.request.headers ?? {}

    const target = (draft?.headers && typeof draft.headers === 'object') ? draft.headers : {}

    const nextHeaderOverrides = (() => {
      if (draft?.headerOverrides && typeof draft.headerOverrides === 'object') return draft.headerOverrides as Record<string, string>
      const overrides: Record<string, string> = {}
      for (const [k, v] of Object.entries(target)) {
        if (!(k in base) && (k in env) && env[k] === v) continue
        if (!(k in base) || base[k] !== v) overrides[k] = v
      }
      return overrides
    })()

    const nextDisabledHeaderNames = (() => {
      if (draft?.disabledHeaderNames && typeof draft.disabledHeaderNames === 'object') return draft.disabledHeaderNames as Record<string, true>
      const disabled: Record<string, true> = {}
      for (const key of Object.keys({ ...env, ...base })) {
        if (!(key in target)) disabled[key] = true
      }
      return disabled
    })()

    const nextInactiveHeaderNames =
      draft?.inactiveHeaderNames && typeof draft.inactiveHeaderNames === 'object' ? (draft.inactiveHeaderNames as Record<string, true>) : {}
    const nextHeaderDraftRows = normalizeDraftRows(draft?.headerDraftRows, 'hrow')

    const headersForSeedCheck = (() => {
      const next: Record<string, string> = { ...env, ...base, ...nextHeaderOverrides }
      for (const key of Object.keys(nextDisabledHeaderNames)) delete next[key]
      return next
    })()

    const nextQueryKeyOrder = (() => {
      const raw = Array.isArray(draft?.queryKeyOrder) ? draft?.queryKeyOrder : null
      const stored = (raw ?? []).filter(x => typeof x === 'string')
      if (stored.length) return stored

      const overrides = (draft?.queryParamKeyOverrides && typeof draft.queryParamKeyOverrides === 'object')
        ? (draft.queryParamKeyOverrides as Record<string, string>)
        : {}
      const overriddenKeys = new Set(Object.values(overrides).filter(Boolean))
      const specRaw = props.request.params.filter(p => p.in === 'query').map(p => p.name).filter(Boolean)
      const disabledSpec = new Set(Object.keys(nextDisabledQueryParamNames).filter(Boolean))
      const specEffective = specRaw
        .filter(n => !disabledSpec.has(n))
        .map(n => (overrides[n] ?? n))
        .filter(Boolean)

      const specRawSet = new Set(specRaw)
      const extras = Object.keys(nextQueryParams).filter(k => !specRawSet.has(k) && !overriddenKeys.has(k))
      return [...specEffective, ...extras]
    })()

    const nextHeaderKeyOrder = (() => {
      const raw = Array.isArray(draft?.headerKeyOrder) ? draft?.headerKeyOrder : null
      const stored = (raw ?? []).filter(x => typeof x === 'string')
      if (stored.length) return stored

      const spec = props.request.params
        .filter(p => p.in === 'header')
        .map(p => p.name)
        .filter(n => typeof n === 'string' && n && n.toLowerCase() !== 'authorization')

      const combinedKeys = Object.keys(headersForSeedCheck).filter(k => k.toLowerCase() !== 'authorization')
      const out: string[] = []
      for (const k of spec) {
        if (findKeyIndexCaseInsensitive(out, k) >= 0) continue
        out.push(k)
      }
      for (const k of combinedKeys) {
        if (findKeyIndexCaseInsensitive(out, k) >= 0) continue
        out.push(k)
      }
      return out
    })()

    const hasQueryParamsSpec = props.request.params.some(p => p.in === 'query')
    const hasQueryParamsStore = Object.keys(nextQueryParams).length > 0
    const shouldSeedQueryDraft = !hasQueryParamsSpec && !hasQueryParamsStore && nextQueryDraftRows.length === 0

    const hasHeadersSpec = props.request.params.some(p => p.in === 'header' && p.name.toLowerCase() !== 'authorization')
    const hasHeadersStore = Object.keys(headersForSeedCheck).some(k => k.toLowerCase() !== 'authorization')
    const shouldSeedHeaderDraft = !hasHeadersSpec && !hasHeadersStore && nextHeaderDraftRows.length === 0

    setPathParams(nextPathParams)
    setQueryParams(nextQueryParams)
    setQueryDraftRows(nextQueryDraftRows.length ? nextQueryDraftRows : (shouldSeedQueryDraft ? [{ id: uid('qrow'), name: '', value: '', isActive: true }] : []))
    setQueryParamKeyOverrides(draft?.queryParamKeyOverrides ?? {})
    setDisabledQueryParamNames(nextDisabledQueryParamNames)
    setInactiveQueryParamNames(nextInactiveQueryParamNames)
    setQueryKeyOrder(nextQueryKeyOrder)
    setHeaderOverrides(nextHeaderOverrides)
    setDisabledHeaderNames(nextDisabledHeaderNames)
    setInactiveHeaderNames(nextInactiveHeaderNames)
    setHeaderDraftRows(nextHeaderDraftRows.length ? nextHeaderDraftRows : (shouldSeedHeaderDraft ? [{ id: uid('hrow'), name: '', value: '', isActive: true }] : []))
    setHeaderKeyOrder(nextHeaderKeyOrder)
    setBaseUrlKey(draft?.baseUrlKey || props.environment?.baseUrlKey || 'baseUrl')
    const nextBodyText = draft?.bodyText ?? requestDefaultBodyText()
    setBodyText(nextBodyText)
    setIsBodyOpen(!!props.request.body)
    const nextBodyFormat = normalizeBodyFormat(draft?.bodyFormat)
    setBodyFormat(nextBodyFormat)
    setIsFileOpen(shouldDefaultOpenFileTab(props.request.method, props.request.body?.contentType))
    setUrlTemplateOverride(draft?.urlTemplateOverride ?? '')
    setIsEditingUrl(false)
    setUrlDraftText('')
    setFileRows(() => {
      const storedRows = normalizeDraftFileRows(draft?.fileRows)
      if (storedRows.length) return storedRows.map(r => ({ id: uid('frow'), fieldName: r.fieldName, file: null, isActive: r.isActive }))
      const rawList = Array.isArray(draft?.fileFieldNames) ? draft?.fileFieldNames : null
      const names = (rawList ?? []).filter(x => typeof x === 'string')
      const seed = names.length ? names : ['']
      return seed.map(name => ({ id: uid('frow'), fieldName: name, file: null, isActive: true }))
    })
    setPreSqlScript(draft?.preSqlScript ?? '')
    setPostSqlScript(draft?.postSqlScript ?? '')

    saveRequestDraft(props.request.id, {
      pathParams: draft?.pathParams ?? {},
      queryParams: draft?.queryParams ?? defaultQueryParamsFromSpec(props.request.params),
      queryDraftRows: nextQueryDraftRows,
      queryKeyOrder: nextQueryKeyOrder,
      inactiveQueryParamNames: nextInactiveQueryParamNames,
      queryParamKeyOverrides: draft?.queryParamKeyOverrides ?? {},
      disabledQueryParamNames: nextDisabledQueryParamNames,
      preSqlScript: draft?.preSqlScript ?? '',
      postSqlScript: draft?.postSqlScript ?? '',
      headerOverrides: nextHeaderOverrides,
      headerDraftRows: nextHeaderDraftRows,
      headerKeyOrder: nextHeaderKeyOrder,
      disabledHeaderNames: nextDisabledHeaderNames,
      inactiveHeaderNames: nextInactiveHeaderNames,
      bodyText: nextBodyText,
      bodyFormat: normalizeBodyFormat(draft?.bodyFormat),
      fileFieldName: (draft?.fileFieldName || 'file').trim() || 'file',
      fileFieldNames: Array.isArray(draft?.fileFieldNames)
        ? draft!.fileFieldNames!.filter(x => typeof x === 'string')
        : undefined,
      fileRows: (() => {
        const stored = normalizeDraftFileRows(draft?.fileRows)
        if (stored.length) return stored
        const rawList = Array.isArray(draft?.fileFieldNames) ? draft?.fileFieldNames : null
        const names = (rawList ?? []).filter(x => typeof x === 'string')
        const seed = names.length ? names : ['']
        return seed.map(fieldName => ({ fieldName, isActive: true }))
      })(),
      baseUrlKey: draft?.baseUrlKey || props.environment?.baseUrlKey || 'baseUrl',
      urlTemplateOverride: draft?.urlTemplateOverride ?? '',
    })
  }, [applyDraftToken])

  useEffect(() => {
    if (!props.request.id) return
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current)
    draftSaveTimerRef.current = window.setTimeout(() => {
      saveRequestDraft(props.request.id, {
        pathParams,
        queryParams,
        queryDraftRows,
        queryKeyOrder,
        inactiveQueryParamNames,
        queryParamKeyOverrides,
        disabledQueryParamNames,
        preSqlScript,
        postSqlScript,
        headerOverrides,
        headerDraftRows,
        headerKeyOrder,
        disabledHeaderNames,
        inactiveHeaderNames,
         bodyText,
         bodyFormat,
         fileFieldName: (fileRows[0]?.fieldName || 'file').trim() || 'file',
         fileFieldNames: fileRows.map(r => r.fieldName),
         fileRows: fileRows.map(r => ({ fieldName: r.fieldName, isActive: r.isActive })),
         baseUrlKey,
         urlTemplateOverride,
       })
     }, 200)
     return () => {
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current)
      draftSaveTimerRef.current = null
    }
  }, [
    baseUrlKey,
    bodyText,
    bodyFormat,
    disabledHeaderNames,
    inactiveHeaderNames,
    fileRows,
    headerOverrides,
    headerKeyOrder,
    headerDraftRows,
    pathParams,
    postSqlScript,
    preSqlScript,
    props.request.id,
    queryParams,
    queryKeyOrder,
    queryDraftRows,
    inactiveQueryParamNames,
    queryParamKeyOverrides,
    disabledQueryParamNames,
    urlTemplateOverride,
  ])

  const grouped = useMemo(() => {
    const p = props.request.params
    return {
      path: p.filter(x => x.in === 'path'),
      query: p.filter(x => x.in === 'query'),
      header: p.filter(x => x.in === 'header'),
    }
  }, [props.request.params])

  const querySpecNames = useMemo(() => new Set(grouped.query.map(q => q.name)), [grouped.query])
  const disabledQuerySpecNames = useMemo(
    () => new Set(Object.keys(disabledQueryParamNames).filter(Boolean)),
    [disabledQueryParamNames],
  )
  const queryParamsList = useMemo(() => {
    const overriddenKeys = new Set(Object.values(queryParamKeyOverrides).filter(Boolean))
    const spec = grouped.query.filter(Boolean).filter(p => !disabledQuerySpecNames.has(p.name))
    const out: RequestParam[] = [...spec]
    for (const k of Object.keys(queryParams)) {
      if (querySpecNames.has(k)) continue
      if (overriddenKeys.has(k)) continue
      out.push({ name: k, in: 'query', required: false })
    }
    const decorated = out.map((p, i) => {
      const raw = p.name
      const isSpec = querySpecNames.has(raw)
      const key = isSpec ? (queryParamKeyOverrides[raw] ?? raw) : raw
      const idx = queryKeyOrder.indexOf(key)
      return { p, sortKey: (idx >= 0 ? idx : (1_000_000 + i)) }
    })
    decorated.sort((a, b) => a.sortKey - b.sortKey)
    return decorated.map(x => x.p)
  }, [disabledQuerySpecNames, grouped.query, queryKeyOrder, queryParams, queryParamKeyOverrides, querySpecNames])

  useEffect(() => {
    const requiredSpecNames = grouped.query
      .filter(Boolean)
      .filter(p => !!p.required)
      .map(p => (p.name || '').trim())
      .filter(Boolean)

    if (!requiredSpecNames.length) return

    const moves: Array<{ from: string, to: string }> = []
    for (const rawName of requiredSpecNames) {
      const overridden = queryParamKeyOverrides[rawName]
      if (typeof overridden !== 'string' || !overridden.trim()) continue
      if (overridden === rawName) continue
      moves.push({ from: overridden, to: rawName })
    }

    if (!moves.length) return

    setQueryParams(prev => {
      let next = prev
      for (const { from, to } of moves) {
        if (!Object.prototype.hasOwnProperty.call(next, from)) continue
        const v = next[from]
        if (next === prev) next = { ...prev }
        delete next[from]
        if (!Object.prototype.hasOwnProperty.call(next, to)) next[to] = v
      }
      return next
    })
    setInactiveQueryParamNames(prev => {
      let next = prev
      for (const { from, to } of moves) next = renameFlagKey(next, from, to)
      return next
    })
    setQueryKeyOrder(prev => {
      let next = prev
      for (const { from, to } of moves) next = replaceKeyInOrder(next, from, to)
      return next
    })
    setQueryParamKeyOverrides(prev => {
      let changed = false
      const next = { ...prev }
      for (const rawName of requiredSpecNames) {
        if (!(rawName in next)) continue
        delete next[rawName]
        changed = true
      }
      return changed ? next : prev
    })
  }, [grouped.query, queryParamKeyOverrides])

  const headerParams = useMemo(
    () => normalizeHeaderParams(grouped.header, committedHeaders, headerKeyOrder),
    [grouped.header, committedHeaders, headerKeyOrder],
  )
  const headerSpecNames = useMemo(() => new Set(grouped.header.map(h => h.name)), [grouped.header])
  const visibleHeaderParams = useMemo(
    () => headerParams.filter(h => h.name.toLowerCase() !== 'authorization'),
    [headerParams],
  )

  useEffect(() => {
    const overriddenKeys = new Set(Object.values(queryParamKeyOverrides).filter(Boolean))
    const specVisible = grouped.query
      .filter(Boolean)
      .filter(p => !disabledQuerySpecNames.has(p.name))
      .map(p => (queryParamKeyOverrides[p.name] ?? p.name))
      .filter(Boolean)
    const extras = Object.keys(queryParams).filter(k => !querySpecNames.has(k) && !overriddenKeys.has(k))
    const visible = [...specVisible, ...extras]

    setQueryKeyOrder(prev => {
      const keep = new Set(visible)
      const next = prev.filter(k => keep.has(k))
      for (const k of visible) {
        if (!next.includes(k)) next.push(k)
      }
      return next
    })
  }, [disabledQuerySpecNames, grouped.query, queryParamKeyOverrides, queryParams, querySpecNames])

  useEffect(() => {
    const specVisible = grouped.header
      .filter(Boolean)
      .map(h => h.name)
      .filter(n => n && n.toLowerCase() !== 'authorization')
    const extras = Object.keys(committedHeaders).filter(k => k.toLowerCase() !== 'authorization')
    const visible = [...specVisible, ...extras]

    setHeaderKeyOrder(prev => {
      const keepNeedles = new Set(visible.map(k => k.toLowerCase()))
      let next = prev.filter(k => keepNeedles.has((k ?? '').toLowerCase()))
      for (const k of visible) {
        if (findKeyIndexCaseInsensitive(next, k) < 0) next = [...next, k]
      }
      return next
    })
  }, [committedHeaders, grouped.header])

  useEffect(() => {
    if (headerDraftRows.length > 0) return
    if (visibleHeaderParams.length > 0) return
    setHeaderDraftRows([{ id: uid('hrow'), name: '', value: '', isActive: true }])
  }, [headerDraftRows.length, visibleHeaderParams.length])

  useEffect(() => {
    if (queryDraftRows.length > 0) return
    if (queryParamsList.length > 0) return
    setQueryDraftRows([{ id: uid('qrow'), name: '', value: '', isActive: true }])
  }, [queryDraftRows.length, queryParamsList.length])

  const hasAnyEditableVisibleHeaderRow = useMemo(() => {
    return visibleHeaderParams.some(h => {
      const isSpec = headerSpecNames.has(h.name)
      return !isSpec
    })
  }, [envHeaders, headerSpecNames, requestBaseHeaders, visibleHeaderParams])

  const effectiveContentType = useMemo(() => {
    const activeHeaders = removeInactiveHeaders(effectiveHeaders, inactiveHeaderNames)
    const fromHeadersOrSpec = (activeHeaders['Content-Type'] || activeHeaders['content-type'] || props.request.body?.contentType || '').trim()
    return bodyFormat === 'auto' ? fromHeadersOrSpec : contentTypeForBodyFormat(bodyFormat)
  }, [bodyFormat, effectiveHeaders, inactiveHeaderNames, props.request.body?.contentType])
  const isMultipartForm = effectiveContentType.toLowerCase().includes('multipart/form-data')
  const methodAllowsBody = props.request.method !== 'GET' && props.request.method !== 'HEAD'
  const supportsFileSend = methodAllowsBody

  const resolvedBodyFormatForBeautify = useMemo((): BeautifyBodyFormat => {
    if (bodyFormat === 'auto') return inferBodyFormatFromContentType(effectiveContentType)
    if (bodyFormat === 'json' || bodyFormat === 'xml' || bodyFormat === 'yaml' || bodyFormat === 'text') return bodyFormat
    return 'text'
  }, [bodyFormat, effectiveContentType])

  function templateForBodyFormat(format: BodyFormat): string {
    switch (format) {
      case 'json': return '{\n  \n}'
      case 'xml': return '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  \n</root>'
      case 'yaml': return '---\nkey: value\n'
      case 'text': return ''
      case 'auto': return ''
    }
  }

  function pickBodyFormat(nextFormat: BodyFormat) {
    setBodyFormatMenuOpen(false)
    setIsBodyOpen(true)
    const isReplaceable = !bodyText.trim() || bodyText.trim() === templateForBodyFormat(bodyFormat).trim()
    setBodyFormat(nextFormat)
    if (isReplaceable) setBodyText(templateForBodyFormat(nextFormat))
  }

  useEffect(() => {
    if (!bodyFormatMenuOpen) return

    function update() {
      const wrap = bodyFormatMenuWrapRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      setBodyFormatMenuAnchor(prev => {
        const next = { left: rect.left, top: rect.bottom + 6, width: rect.width }
        if (prev.left === next.left && prev.top === next.top && prev.width === next.width) return prev
        return next
      })
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [bodyFormatMenuOpen])

  useEffect(() => {
    if (!bodyFormatMenuOpen) return

    function onPointerDown(e: PointerEvent) {
      const wrap = bodyFormatMenuWrapRef.current
      const t = e.target as Node | null
      if (wrap && t && wrap.contains(t)) return
      const panel = bodyFormatMenuPanelRef.current
      if (panel && t && panel.contains(t)) return
      setBodyFormatMenuOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setBodyFormatMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [bodyFormatMenuOpen])

  function addHeaderDraftRow() {
    setHeaderDraftRows(prev => [...prev, { id: uid('hrow'), name: '', value: '', isActive: true }])
  }

  function addQueryDraftRow() {
    setQueryDraftRows(prev => [...prev, { id: uid('qrow'), name: '', value: '', isActive: true }])
  }

  function parseFormFieldsFromBodyText(text: string): Record<string, string> {
    const raw = text.trim()
    if (!raw) return {}
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (!k.trim()) continue
        if (v === null || v === undefined) continue
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
      }
      return out
    } catch {
      return {}
    }
  }

  function buildSendSnapshot() {
    const headerDraftRowsToCommit = headerDraftRows.filter(r => r.name.trim() && r.value !== '')
    const hasDraftHeadersToCommit = headerDraftRowsToCommit.length > 0

    const nextHeaderOverridesForSend = hasDraftHeadersToCommit
      ? (() => {
        const next = { ...headerOverrides }
        for (const row of headerDraftRowsToCommit) {
          const key = row.name.trim()
          if (!key) continue
          next[key] = row.value
        }
        return next
      })()
      : headerOverrides

    const nextDisabledHeaderNamesForSend = hasDraftHeadersToCommit
      ? (() => {
        let changed = false
        const next = { ...disabledHeaderNames }
        for (const row of headerDraftRowsToCommit) {
          const key = row.name.trim()
          if (!key) continue
          if (key in next) {
            delete next[key]
            changed = true
          }
        }
        return changed ? next : disabledHeaderNames
      })()
      : disabledHeaderNames

    const nextInactiveHeaderNamesForSend = hasDraftHeadersToCommit
      ? (() => {
        let next = inactiveHeaderNames
        for (const row of headerDraftRowsToCommit) {
          const key = row.name.trim()
          if (!key) continue
          next = setFlagForHeaderName(next, key, row.isActive)
        }
        return next
      })()
      : inactiveHeaderNames

    const baseHeadersForSend = (() => {
      const merged = { ...envHeaders, ...requestBaseHeaders, ...nextHeaderOverridesForSend }
      for (const key of Object.keys(nextDisabledHeaderNamesForSend)) delete merged[key]
      return removeInactiveHeaders(merged, nextInactiveHeaderNamesForSend)
    })()

    const activeFileRows = fileRows.filter(r => r.isActive)
    const hasAnyFileInput = supportsFileSend && activeFileRows.some(r => !!r.file)
    const hasAnyBodyInput =
      !!bodyText.trim() ||
      hasAnyFileInput ||
      !!(methodAllowsBody && isMultipartForm && Object.keys(parseFormFieldsFromBodyText(bodyText)).length)
    const effectiveHeadersForSend = (() => {
      if (!hasAnyBodyInput) return baseHeadersForSend
      if (bodyFormat === 'auto') return baseHeadersForSend
      const next = { ...baseHeadersForSend }
      if (!headerIsInactive(nextInactiveHeaderNamesForSend, 'Content-Type')) next['Content-Type'] = contentTypeForBodyFormat(bodyFormat)
      return next
    })()

    const queryDraftRowsToCommit = queryDraftRows.filter(r => r.name.trim() && r.value !== '')
    const hasDraftQueryToCommit = queryDraftRowsToCommit.length > 0
    const effectiveQueryParamsForCommit = hasDraftQueryToCommit ? effectiveQueryParams : queryParams
    const nextInactiveQueryParamNamesForSend = hasDraftQueryToCommit
      ? (() => {
        let next = inactiveQueryParamNames
        for (const row of queryDraftRowsToCommit) {
          const key = row.name.trim()
          if (!key) continue
          next = setFlagForKey(next, key, row.isActive)
        }
        return next
      })()
      : inactiveQueryParamNames
    const effectiveQueryParamsForSend = (() => {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(effectiveQueryParamsForCommit)) {
        if (nextInactiveQueryParamNamesForSend[k]) continue
        out[k] = v
      }
      return out
    })()
    const effectiveDisabledQueryParamNamesForSend = hasDraftQueryToCommit
      ? (() => {
        let changed = false
        const next = { ...disabledQueryParamNames }
        for (const row of queryDraftRows) {
          const key = row.name.trim()
          if (!key) continue
          if (row.value === '') continue
          if (!querySpecNames.has(key)) continue
          if (key in next) {
            delete next[key]
            changed = true
          }
        }
        return changed ? next : disabledQueryParamNames
      })()
      : disabledQueryParamNames

    const formFields = supportsFileSend && effectiveContentType.toLowerCase().includes('multipart/form-data')
      ? parseFormFieldsFromBodyText(bodyText)
      : undefined

    const filesForMultipart = supportsFileSend && effectiveContentType.toLowerCase().includes('multipart/form-data')
      ? activeFileRows
        .map(r => ({ fieldName: r.fieldName.trim() || 'file', file: r.file }))
        .filter((x): x is { fieldName: string, file: File } => !!x.file)
      : undefined
    const firstFileForOctetStream = activeFileRows.find(r => r.file)?.file ?? null
    const fileForOctetStream = supportsFileSend ? firstFileForOctetStream : undefined

    const fileFieldName = (activeFileRows[0]?.fieldName || fileRows[0]?.fieldName || 'file').trim() || 'file'

    return {
      nextHeaderOverridesForSend,
      nextDisabledHeaderNamesForSend,
      nextInactiveHeaderNamesForSend,
      effectiveHeadersForSend,
      effectiveQueryParamsForCommit,
      nextInactiveQueryParamNamesForSend,
      effectiveQueryParamsForSend,
      effectiveDisabledQueryParamNamesForSend,
      formFields,
      filesForMultipart,
      fileForOctetStream,
      fileFieldName,
    }
  }

  async function send() {
    cancelInFlightSend()
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const runId = uid('run')
    props.onSendStart?.(props.request.id, runId)
    try {
      const snapshot = buildSendSnapshot()

      // Intentionally avoid mutating editor state on send.
      // In-flight updates (parent re-render) could cause visible checkbox flicker and mismatch
      // between what's sent and what the UI shows.

      props.onBeforeSend?.(props.request.id, {
        id: uid('hist'),
        createdAt: Date.now(),
        method: props.request.method,
        url: displayUrl,
        draft: {
          pathParams,
          queryParams: snapshot.effectiveQueryParamsForCommit,
          inactiveQueryParamNames: snapshot.nextInactiveQueryParamNamesForSend,
          queryParamKeyOverrides,
          disabledQueryParamNames: snapshot.effectiveDisabledQueryParamNamesForSend,
          headers: snapshot.effectiveHeadersForSend,
          headerOverrides: snapshot.nextHeaderOverridesForSend,
          disabledHeaderNames: snapshot.nextDisabledHeaderNamesForSend,
          inactiveHeaderNames: snapshot.nextInactiveHeaderNamesForSend,
          preSqlScript,
          postSqlScript,
           bodyText,
           bodyFormat,
           fileFieldName: snapshot.fileFieldName,
           fileFieldNames: fileRows.map(r => r.fieldName.trim()).filter(Boolean),
           fileRows: fileRows.map(r => ({ fieldName: r.fieldName.trim(), isActive: r.isActive })),
           baseUrlKey,
           urlTemplateOverride,
         },
      })

      const preSql = preSqlScript.trim()
      const postSql = postSqlScript.trim()
      const shouldRunSql = !!(preSql || postSql)

      const getSqlErrorResult = (statusText: string, message: string): RunResult => ({
        ok: false,
        status: 0,
        statusText,
        timeMs: 0,
        requestHeadersBytes: 0,
        requestBodyBytes: 0,
        requestBytes: 0,
        responseHeadersBytes: 0,
        responseBodyBytes: 0,
        responseBytes: 0,
        requestHeaders: {},
        responseHeaders: {},
        bodyText: message,
      })

      const getCanceledResult = (): RunResult => ({
        ok: false,
        status: 0,
        statusText: 'Canceled',
        timeMs: 0,
        requestHeadersBytes: 0,
        requestBodyBytes: 0,
        requestBytes: 0,
        responseHeadersBytes: 0,
        responseBodyBytes: 0,
        responseBytes: 0,
        requestHeaders: {},
        responseHeaders: {},
        bodyText: 'Request was canceled.',
      })

      if (shouldRunSql) {
        const env = props.environment
        if (!env) {
          props.onResult(props.request.id, getSqlErrorResult('SQL Failed', 'No environment selected.'), runId)
          return
        }

        const rawType = env.variables?.[DB_ENV_KEYS.type]
        const dbType = rawType === 'mysql' ? 'mysql' : 'postgres'
        const fromEnv = (env.variables?.[DB_ENV_KEYS.connectionString] ?? '').trim()
        const connectionString = fromEnv || buildDbConnectionString(getDbFormStateFromEnv(env))
        if (!connectionString) {
          props.onResult(
            props.request.id,
            getSqlErrorResult('SQL Failed', 'Missing database connection. Configure it in Environment settings.'),
            runId,
          )
          return
        }

        if (preSql) {
          const r = await runDbSql({
            type: dbType,
            connectionString,
            sql: applyVariablesForDisplay(preSql, variables),
          })
          if (!r.ok) {
            props.onResult(
              props.request.id,
              getSqlErrorResult('SQL Pre Script Failed', r.message || 'Pre script failed.'),
              runId,
            )
            return
          }
        }

        if (abortController.signal.aborted) {
          props.onResult(props.request.id, getCanceledResult(), runId)
          return
        }
      }

      let result = await runRequest({
        request: props.request,
        baseUrl,
        urlTemplateOverride,
        variables,
        pathParams,
        queryParams: snapshot.effectiveQueryParamsForSend,
        headers: snapshot.effectiveHeadersForSend,
        bodyText,
        files: snapshot.filesForMultipart,
        file: snapshot.fileForOctetStream,
        fileFieldName: snapshot.fileFieldName,
        formFields: snapshot.formFields,
        signal: abortController.signal,
      })

      if (shouldRunSql && postSql && props.environment) {
        if (abortController.signal.aborted) {
          props.onResult(props.request.id, getCanceledResult(), runId)
          return
        }
        const rawType = props.environment.variables?.[DB_ENV_KEYS.type]
        const dbType = rawType === 'mysql' ? 'mysql' : 'postgres'
        const fromEnv = (props.environment.variables?.[DB_ENV_KEYS.connectionString] ?? '').trim()
        const connectionString = fromEnv || buildDbConnectionString(getDbFormStateFromEnv(props.environment))
        if (connectionString) {
          const r = await runDbSql({
            type: dbType,
            connectionString,
            sql: applyVariablesForDisplay(postSql, variables),
          })
          if (!r.ok) {
            result = {
              ...result,
              ok: false,
              bodyText: `${result.bodyText}\n\n-- SQL Post Script Failed --\n${r.message || 'Post script failed.'}\n`,
            }
          }
        } else {
          result = {
            ...result,
            ok: false,
            bodyText: `${result.bodyText}\n\n-- SQL Post Script Failed --\nMissing database connection.\n`,
          }
        }
      }

      props.onResult(props.request.id, result, runId)
    } finally {
      if (abortControllerRef.current === abortController) abortControllerRef.current = null
      props.onSendEnd?.(props.request.id, runId)
    }
  }

  useEffect(() => {
    sendRef.current = () => void send()
    return () => {
      sendRef.current = null
    }
  }, [send])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return
      const target = e.target as HTMLElement | null
      if (target?.closest('dialog')) return
      if (!canSend || isSending) return
      commitFocusedValueFieldToState()
      e.preventDefault()
      e.stopPropagation()
      sendRef.current?.()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canSend, isSending])

  async function copyBodyText() {
    await copyText(bodyText)
    setBodyCopied(true)
    setTimeout(() => setBodyCopied(false), 900)
  }

  function applyBodyTextareaReplacement(rangeStart: number, rangeEnd: number, replacement: string, nextSelStart: number, nextSelEnd: number) {
    const ta = bodyTextareaRef.current
    if (!ta) return

    ta.focus()
    ta.selectionStart = rangeStart
    ta.selectionEnd = rangeEnd

    const ok = document.execCommand?.('insertText', false, replacement) ?? false
    if (!ok) ta.setRangeText(replacement, rangeStart, rangeEnd, 'preserve')

    ta.selectionStart = nextSelStart
    ta.selectionEnd = nextSelEnd
    setBodyText(ta.value)
  }

  function applyBodyEnterIndent() {
    const ta = bodyTextareaRef.current
    if (!ta) return

    const value = ta.value
    const selStart = ta.selectionStart ?? 0
    const selEnd = ta.selectionEnd ?? 0

    const lineStart = value.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1
    const lineEndBoundary = value.indexOf('\n', selEnd)
    const lineEnd = lineEndBoundary === -1 ? value.length : lineEndBoundary

    const linePrefix = value.slice(lineStart, selStart)
    const currentIndent = (value.slice(lineStart, lineEnd).match(/^[\t ]*/) ?? [''])[0]
    const indentUnit = currentIndent.includes('\t') ? '\t' : '  '

    const lastNonWs = (() => {
      for (let i = linePrefix.length - 1; i >= 0; i--) {
        const c = linePrefix[i]
        if (c !== ' ' && c !== '\t') return c
      }
      return ''
    })()

    const nextNonWs = (() => {
      const suffix = value.slice(selEnd, lineEnd)
      for (let i = 0; i < suffix.length; i++) {
        const c = suffix[i]
        if (c !== ' ' && c !== '\t') return c
      }
      return ''
    })()

    const shouldIncrease = lastNonWs === '{' || lastNonWs === '['
    const shouldSplitClose = shouldIncrease && (nextNonWs === '}' || nextNonWs === ']')

    if (shouldSplitClose) {
      const replacement = `\n${currentIndent}${indentUnit}\n${currentIndent}`
      const caret = selStart + (`\n${currentIndent}${indentUnit}`).length
      applyBodyTextareaReplacement(selStart, selEnd, replacement, caret, caret)
      return
    }

    const replacement = `\n${currentIndent}${shouldIncrease ? indentUnit : ''}`
    const caret = selStart + replacement.length
    applyBodyTextareaReplacement(selStart, selEnd, replacement, caret, caret)
  }

  function beautifyBodyText() {
    const ta = bodyTextareaRef.current
    const raw = ta?.value ?? bodyText
    try {
      const nextValue = beautifyBody(raw, resolvedBodyFormatForBeautify)
      if (ta) applyBodyTextareaReplacement(0, ta.value.length, nextValue, nextValue.length, nextValue.length)
      else setBodyText(nextValue)
    } catch {
      // keep silent: invalid input should not change button state
    }
  }

  function renderFilePicker() {
    const canDeleteRow = fileRows.length > 1

    return (
      <div className="section">
        <input
          ref={bodyFileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={e => {
            const next = e.target.files?.[0] ?? null
            const targetRowId = activeFileRowIdRef.current ?? fileRows[0]?.id ?? null
            const el = e.target as HTMLInputElement

            activeFileRowIdRef.current = null
            el.value = ''

            if (!targetRowId) return
            if (!next) return

            setFileRows(prev => prev.map(r => (r.id === targetRowId ? { ...r, file: next } : r)))
          }}
        />

        {fileRows.map(row => (
          <div key={row.id} className="formRow">
            <input
              className={`mono ${row.isActive ? '' : 'rowInactive'}`.trim()}
              value={row.fieldName}
              onChange={e => setFileRows(prev => prev.map(r => (r.id === row.id ? { ...r, fieldName: e.target.value } : r)))}
              placeholder="Key"
              aria-label="File field key"
            />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`chooseFileBtn ${row.isActive ? '' : 'rowInactive'}`.trim()}
                title={row.file ? row.file.name : 'Choose file'}
                style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                onClick={() => {
                  activeFileRowIdRef.current = row.id
                  bodyFileInputRef.current?.click()
                }}
              >
                <span className="chooseFileBtnLabel">{row.file ? row.file.name : 'Choose file'}</span>
              </button>

              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                <label className="checkRow rowCheck" title={row.isActive ? 'Active' : 'Inactive'}>
                  <input
                    type="checkbox"
                    className="checkInput"
                    checked={row.isActive}
                    aria-label={`Toggle file row ${row.fieldName.trim() || row.file?.name || ''}`.trim()}
                    onChange={e => setFileRows(prev => prev.map(r => (r.id === row.id ? { ...r, isActive: e.target.checked } : r)))}
                    onClick={e => e.stopPropagation()}
                  />
                  <span className="checkBox" aria-hidden="true" />
                </label>
                <ConfirmIconButton
                  className="rowDeleteBtn"
                  disabled={false}
                  onConfirm={() => {
                    if (row.file) {
                      setFileRows(prev => prev.map(r => (r.id === row.id ? { ...r, fieldName: '', file: null } : r)))
                      return
                    }
                    if (canDeleteRow) {
                      setFileRows(prev => prev.filter(r => r.id !== row.id))
                      return
                    }
                    setFileRows(prev => prev.map(r => (r.id === row.id ? { ...r, fieldName: '' } : r)))
                  }}
                  ariaLabel={row.file ? 'Remove file' : canDeleteRow ? 'Remove file row' : 'Clear file row'}
                  confirmAriaLabel={row.file ? 'Confirm remove file' : canDeleteRow ? 'Confirm remove file row' : 'Confirm clear file row'}
                  title={
                    row.file
                      ? 'Remove file'
                      : canDeleteRow
                        ? 'Remove file row'
                        : row.fieldName.trim()
                          ? 'Clear key'
                          : 'No file to remove'
                  }
                  confirmTitle={row.file ? 'Confirm remove file' : canDeleteRow ? 'Confirm remove file row' : 'Confirm clear key'}
                  icon={<CloseIcon size={18} />}
                />
              </div>
            </div>
          </div>
        ))}

      </div>
    )
  }

  function applyBodyTabIndent(isUnindent: boolean) {
    const ta = bodyTextareaRef.current
    if (!ta) return

    const value = ta.value
    const selStart = ta.selectionStart ?? 0
    const selEnd = ta.selectionEnd ?? 0

    const indent = '\t'
    const startLine = value.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1
    const endLineBoundary = value.indexOf('\n', selEnd)
    const endLine = endLineBoundary === -1 ? value.length : endLineBoundary

    const mid = value.slice(startLine, endLine)
    const lines = mid.split('\n')

    const removeIndentLen = (line: string) => {
      if (line.startsWith('\t')) return 1
      if (line.startsWith('  ')) return 2
      if (line.startsWith(' ')) return 1
      return 0
    }

    const isSingleLine = startLine === endLine || !mid.includes('\n')
    const isCollapsed = selStart === selEnd

    if (!isUnindent && isCollapsed && isSingleLine) {
      applyBodyTextareaReplacement(selStart, selEnd, indent, selStart + indent.length, selStart + indent.length)
      return
    }

    if (isUnindent && isCollapsed) {
      const len = removeIndentLen(value.slice(startLine, startLine + 2))
      if (len > 0) {
        const nextPos = Math.max(startLine, selStart - len)
        applyBodyTextareaReplacement(startLine, startLine + len, '', nextPos, nextPos)
      }
      return
    }

    if (!isUnindent) {
      const nextMid = lines.map(l => indent + l).join('\n')
      const nextSelStart = selStart + indent.length
      const nextSelEnd = selEnd + indent.length * lines.length
      applyBodyTextareaReplacement(startLine, endLine, nextMid, nextSelStart, nextSelEnd)
      return
    }

    const removeLens = lines.map(removeIndentLen)
    const totalRemoved = removeLens.reduce<number>((a, b) => a + b, 0)
    const firstRemoved = removeLens[0] ?? 0
    const nextMid = lines.map((l, i) => l.slice(removeLens[i] ?? 0)).join('\n')
    const nextSelStart = Math.max(startLine, selStart - firstRemoved)
    const nextSelEnd = Math.max(nextSelStart, selEnd - totalRemoved)
    applyBodyTextareaReplacement(startLine, endLine, nextMid, nextSelStart, nextSelEnd)
  }

  async function copyUrlText() {
    await copyText(displayUrl)
    setCopyOk(true)
    setTimeout(() => setCopyOk(false), 900)
  }

  async function copyCurlText() {
    const snapshot = buildSendSnapshot()
    const curl = buildCurlCommand({
      request: props.request,
      baseUrl,
      urlTemplateOverride,
      variables,
      pathParams,
      queryParams: snapshot.effectiveQueryParamsForSend,
      headers: snapshot.effectiveHeadersForSend,
      bodyText,
      files: snapshot.filesForMultipart,
      file: snapshot.fileForOctetStream,
      fileFieldName: snapshot.fileFieldName,
      formFields: snapshot.formFields,
    })
    await copyText(curl)
    setCopyOk(true)
    setTimeout(() => setCopyOk(false), 900)
  }

  function startUrlEdit(placeCursorAtEnd = false) {
    urlEditStartRef.current = urlEditorText.trim()
    setUrlDraftText(urlEditorText)
    setIsEditingUrl(true)
    window.setTimeout(() => {
      const input = urlInputRef.current
      if (!input) return
      input.focus()
      if (!placeCursorAtEnd) return
      const end = input.value.length
      input.setSelectionRange(end, end)
    }, 0)
  }

  function cancelUrlEdit() {
    setIsEditingUrl(false)
    setUrlDraftText('')
  }

  function commitUrlEdit(nextValue?: string) {
    const raw = (nextValue ?? urlInputRef.current?.value ?? urlDraftText).trim()
    setIsEditingUrl(false)
    if (raw === urlEditStartRef.current) return
    if (!raw) return
    const parsed = parseUrlInput(raw)

    const baseNorm = baseUrl.replace(/\/+$/, '')
    const baseScheme = /^https:\/\//i.test(baseNorm) ? 'https' : 'http'
    const baseWithoutScheme = baseNorm.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
    let parsedTemplate = parsed.template.trim()
    if (
      parsedTemplate &&
      !isAbsoluteUrl(parsedTemplate) &&
      !parsedTemplate.startsWith('//') &&
      baseWithoutScheme
    ) {
      const normalizedInput = parsedTemplate.replace(/^\/+/, '')
      if (normalizedInput.toLowerCase().startsWith(baseWithoutScheme.toLowerCase())) {
        parsedTemplate = `${baseScheme}://${normalizedInput}`
      }
    }
    const parsedNorm = parsedTemplate.replace(/\/+$/, '')

    const defaultAbsolute = (baseUrl ? joinUrlParts(baseUrl, props.request.path) : props.request.urlTemplate).trim()
    const defaultAbsoluteNorm = defaultAbsolute.replace(/\/+$/, '')

    const nextOverride = (() => {
      if (!parsedTemplate) return ''
      if (!baseNorm) return parsedTemplate
      if (parsedNorm === defaultAbsoluteNorm) return ''

      if (parsedNorm.startsWith(baseNorm)) {
        const rest = parsedTemplate.slice(baseNorm.length)
        const relative = rest.startsWith('/') ? rest : `/${rest}`
        return relative.trim() === props.request.path.trim() ? '' : relative
      }

      return parsedTemplate
    })()

    setUrlTemplateOverride(nextOverride)

    const specPathNames = props.request.params.filter(p => p.in === 'path').map(p => p.name).filter(Boolean)
    const nextPathNames = new Set<string>([...specPathNames, ...extractPathParamNamesFromTemplate(parsedTemplate || '')])
    setPathParams(prev => {
      let changed = false
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        if (nextPathNames.has(key)) continue
        delete next[key]
        changed = true
      }
      return changed ? next : prev
    })

    if (parsed.hasQuery) {
      setQueryParams(parsed.query)
      setQueryKeyOrder(Object.keys(parsed.query))
      setInactiveQueryParamNames({})
      setQueryParamKeyOverrides({})
      setDisabledQueryParamNames({})
      setQueryDraftRows([])
    }
  }

  useEffect(() => {
    setMethodMenuOpen(false)
    setCopyMenuOpen(false)
  }, [props.request.id])

  useEffect(() => {
    if (!copyMenuOpen) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null
      const wrap = copyMenuWrapRef.current
      if (t && wrap && wrap.contains(t)) return
      setCopyMenuOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setCopyMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [copyMenuOpen])

  useEffect(() => {
    if (!methodMenuOpen) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null
      const wrap = methodMenuWrapRef.current
      if (t && wrap && wrap.contains(t)) return
      setMethodMenuOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMethodMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [methodMenuOpen])

  const methodOptions: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

  return (
    <div className="editor">
      <div className="editorUrlWrap">
        <div
          className="mono editorUrl"
          title={displayUrl}
          role="button"
          tabIndex={0}
          onClick={() => {
            if (isEditingUrl) return
            startUrlEdit(true)
          }}
          onKeyDown={e => {
            if (isEditingUrl) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              startUrlEdit(true)
            }
          }}
          style={{ cursor: 'pointer' }}
        >
          <div className="editorUrlText">
            <div ref={methodMenuOpen ? methodMenuWrapRef : null} className="methodMenuWrap">
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
                  setMethodMenuOpen(v => !v)
                }}
                aria-label="Change method"
                title="Change method"
              >
                {props.request.method}
              </button>

              {methodMenuOpen ? (
                <div
                  className="methodMenuPanel"
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
                  {methodOptions.map(m => (
                    <button
                      key={m}
                      type="button"
                      className={`methodMenuItem mono ${m === props.request.method ? 'methodMenuItemActive' : ''}`}
                      role="menuitem"
                      onClick={() => {
                        setMethodMenuOpen(false)
                        props.onChangeMethod?.(m)
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="editorUrlMain">
              {isEditingUrl ? (
                <VariableAutocompleteField
                  ref={urlInputRef as any}
                  className="mono editorUrlInput"
                  value={urlDraftText}
                  suggestions={variableSuggestions}
                  onChangeValue={setUrlDraftText}
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitUrlEdit((e.currentTarget as HTMLInputElement).value)
                    if (e.key === 'Escape') cancelUrlEdit()
                  }}
                  onBlur={() => {
                    commitUrlEdit(urlInputRef.current?.value)
                  }}
                  style={{ flex: 1, minWidth: 0 }}
                />
              ) : (
                <span className="editorUrlValue">
                  {displayUrl}
                </span>
              )}

              {isEditingUrl ? (
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
                    {variableKeys.length ? (
                      variableKeys.map(k => (
                        <button
                          key={k}
                          type="button"
                          className={`selectMenuItem ${k === baseUrlKey ? 'selectMenuItemActive' : ''}`}
                          role="menuitem"
                          onMouseDown={e => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          onClick={() => setBaseUrlKey(k)}
                        >
                          <div className="mono">{k}</div>
                          {props.environment?.variables?.[k] ? (
                            <div className="varMenuDesc mono">{String(props.environment?.variables?.[k] ?? '')}</div>
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

          <div ref={copyMenuOpen ? copyMenuWrapRef : null} className="methodMenuWrap">
            <button
              type="button"
              className="iconBtn editorUrlActionBtn"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                setCopyMenuOpen(v => !v)
              }}
              aria-label="Copy"
              title="Copy"
              style={{ width: 28, height: 28 }}
            >
              {copyOk ? 'OK' : <CopyIcon />}
            </button>

            {copyMenuOpen ? (
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
                    setCopyMenuOpen(false)
                    void copyUrlText()
                  }}
                >
                  Copy URL
                </button>
                <button
                  type="button"
                  className="methodMenuItem mono"
                  role="menuitem"
                  onClick={() => {
                    setCopyMenuOpen(false)
                    void copyCurlText()
                  }}
                >
                  Copy cURL
                </button>
              </div>
            ) : null}
          </div>

          <div className="editorUrlSendWrap">
            <button
              className={`editorSendBtn ${isSending ? 'editorSendBtnCancel' : ''}`.trim()}
              onPointerDown={e => {
                e.stopPropagation()
                if (!isSending) commitFocusedValueFieldToState()
              }}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                if (isSending) cancelInFlightSend()
                else void send()
              }}
              disabled={!canSend && !isSending}
            >
              {isSending ? 'Cancel' : 'Send'}
            </button>
          </div>
        </div>

      </div>

      {!canSend && (
        <div className="small" style={{ color: '#ff9a9a' }}>
          Set Base URL in "Environment", otherwise the request won't be sent.
        </div>
      )}

      <div className="tabs">
        <button
          type="button"
          className={`tab ${headersTab === 'headers' ? 'tabActive' : ''}`}
          onClick={() => setHeadersTab('headers')}
          aria-pressed={headersTab === 'headers'}
        >
          Headers
        </button>
        <button
          type="button"
          className={`tab ${headersTab === 'authorization' ? 'tabActive' : ''}`}
          onClick={() => setHeadersTab('authorization')}
          aria-pressed={headersTab === 'authorization'}
        >
          Authorization
        </button>
        <button
          type="button"
          className={`tab ${headersTab === 'sql' ? 'tabActive' : ''}`}
          onClick={() => setHeadersTab('sql')}
          aria-pressed={headersTab === 'sql'}
        >
          SQL
        </button>
      </div>

      {headersTab === 'sql' ? (
        <SqlScriptsTab
          environment={props.environment}
          preSqlScript={preSqlScript}
          postSqlScript={postSqlScript}
          onChangePreSqlScript={setPreSqlScript}
          onChangePostSqlScript={setPostSqlScript}
        />
      ) : headersTab === 'authorization' ? (
        <AuthorizationTab
          value={committedHeaders.Authorization ?? ''}
          variableSuggestions={variableSuggestions}
          onChangeValue={next => setHeaderValueForRequest('Authorization', next)}
        />
      ) : (
        <div className="accordion">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ fontWeight: 600, opacity: 0.95 }}>Headers</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className="iconBtn addRowBtn"
                onClick={reloadFromGlobalHeaders}
                disabled={!hasDisabledEnvOnlyHeaders}
                aria-disabled={!hasDisabledEnvOnlyHeaders}
                aria-label="Reload from global headers"
                title={hasDisabledEnvOnlyHeaders ? 'Reload from global headers' : 'No deleted global headers'}
              >
                <ReloadIcon size={16} />
              </button>
              <button
                type="button"
                className="iconBtn addRowBtn"
                onClick={() => addHeaderDraftRow()}
                aria-label="Add header"
                title="Add header"
              >
                <span className="addRowGlyph">+</span>
              </button>
            </div>
          </div>

          <div className="section">
            {visibleHeaderParams.map(h => {
              const isSpec = headerSpecNames.has(h.name)
              const isInBase = Object.prototype.hasOwnProperty.call(requestBaseHeaders, h.name)
              const isInEnv = Object.prototype.hasOwnProperty.call(envHeaders, h.name)
              const isEnvOnly = !isInBase && isInEnv
              const value = committedHeaders[h.name] ?? ''
              return (
                <HeaderRow
                  key={h.name}
                  name={h.name}
                  value={value}
                  readOnlyName={isSpec}
                  required={isSpec ? h.required : false}
                  isActive={!headerIsInactive(inactiveHeaderNames, h.name)}
                  onToggleActive={isActive => {
                    setInactiveHeaderNames(prev => setFlagForHeaderName(prev, h.name, isActive))
                  }}
                  variableSuggestions={variableSuggestions}
                  historyItems={valueHistory.header[h.name] ?? []}
                  onRecordHistory={next => recordValueHistory('header', h.name, next)}
                  onPickHistory={next => {
                    setHeaderValueForRequest(h.name, next)
                    recordValueHistory('header', h.name, next)
                  }}
                  onDeleteHistoryItem={next => deleteValueHistoryItem('header', h.name, next)}
                  onClearAllHistory={clearAllValueHistory}
                  historyMenuId={`header:${h.name}`}
                  historyMenuOpenId={valueHistoryMenuOpenId}
                  historyMenuAnchor={valueHistoryMenuAnchor}
                  onToggleHistoryMenu={toggleValueHistoryMenu}
                  onCloseHistoryMenu={closeValueHistoryMenu}
                  historyMenuPanelRef={valueHistoryMenuPanelRef}
                  enumValues={isSpec ? h.enumValues : undefined}
                  enumMenuId={isSpec ? `enum:header:${h.name}` : undefined}
                  enumMenuOpenId={enumMenuOpenId}
                  enumMenuAnchor={enumMenuAnchor}
                  onToggleEnumMenu={toggleEnumMenu}
                  onCloseEnumMenu={closeEnumMenu}
                  enumMenuPanelRef={enumMenuPanelRef}
                  onChangeValue={nextValue => {
                    setHeaderValueForRequest(h.name, nextValue)
                  }}
                  onRename={
                    isSpec
                      ? undefined
                      : nextName => {
                        const nextKey = nextName.trim()
                        if (nextKey === h.name) return

                        if (!nextKey) {
                          setInactiveHeaderNames(prev => setFlagForHeaderName(prev, h.name, true))
                          setHeaderDraftRows(draftPrev => [...draftPrev, { id: uid('hrow'), name: '', value, isActive: true }])
                          if (isInBase) {
                            setDisabledHeaderNames(prev => ({ ...prev, [h.name]: true }))
                            setHeaderOverrides(prev => {
                              if (!Object.prototype.hasOwnProperty.call(prev, h.name)) return prev
                              const { [h.name]: _removed, ...rest } = prev
                              return rest
                            })
                            return
                          }
                          if (isInEnv) {
                            setDisabledHeaderNames(prev => ({ ...prev, [h.name]: true }))
                          }
                          setHeaderOverrides(prev => {
                            if (!Object.prototype.hasOwnProperty.call(prev, h.name)) return prev
                            const { [h.name]: _removed, ...rest } = prev
                            return rest
                          })
                          return
                        }

                        if (Object.prototype.hasOwnProperty.call(committedHeaders, nextKey)) return

                        setHeaderOverrides(prev => {
                          const next = { ...prev, [nextKey]: value }
                          if (Object.prototype.hasOwnProperty.call(next, h.name)) delete next[h.name]
                          return next
                        })
                        setDisabledHeaderNames(prev => {
                          const next = { ...prev }
                          if (isInBase || isInEnv) next[h.name] = true
                          delete next[nextKey]
                          return next
                        })
                        setInactiveHeaderNames(prev => {
                          const wasInactive = headerIsInactive(prev, h.name)
                          let next = setFlagForHeaderName(prev, h.name, true)
                          if (wasInactive) next = setFlagForHeaderName(next, nextKey, false)
                          return next
                        })
                        setHeaderKeyOrder(prev => replaceKeyInOrderCaseInsensitive(prev, h.name, nextKey))
                      }
                  }
                  onDelete={
                    isSpec
                      ? h.required
                        ? () => setHeaderValueForRequest(h.name, '')
                        : undefined
                      : () => {
                        setInactiveHeaderNames(prev => setFlagForHeaderName(prev, h.name, true))
                        const shouldEnsureEmptyRowAfterDelete =
                          isEnvOnly && headerDraftRows.length === 0 && !hasAnyEditableVisibleHeaderRow

                        const totalRows = visibleHeaderParams.length + headerDraftRows.length
                        const isLastRow = totalRows === 1

                        if (isLastRow) {
                          if (isInBase || isInEnv) {
                            setDisabledHeaderNames(prev => ({ ...prev, [h.name]: true }))
                            setHeaderOverrides(prev => {
                              if (!Object.prototype.hasOwnProperty.call(prev, h.name)) return prev
                              const { [h.name]: _removed, ...rest } = prev
                              return rest
                            })
                          } else {
                            setHeaderOverrides(prev => {
                              if (!Object.prototype.hasOwnProperty.call(prev, h.name)) return prev
                              const { [h.name]: _removed, ...rest } = prev
                              return rest
                            })
                          }
                          setHeaderDraftRows(prev => (prev.length ? [{ ...prev[0], name: '', value: '', isActive: true }, ...prev.slice(1)] : [{ id: uid('hrow'), name: '', value: '', isActive: true }]))
                          return
                        }

                        if (isInBase || isInEnv) {
                          setDisabledHeaderNames(prev => ({ ...prev, [h.name]: true }))
                          setHeaderOverrides(prev => {
                            if (!Object.prototype.hasOwnProperty.call(prev, h.name)) return prev
                            const { [h.name]: _removed, ...rest } = prev
                            return rest
                          })
                          if (shouldEnsureEmptyRowAfterDelete) {
                            setHeaderDraftRows(prev =>
                              prev.length ? prev : [{ id: uid('hrow'), name: '', value: '', isActive: true }],
                            )
                          }
                          return
                        }
                        setHeaderOverrides(prev => {
                          if (!Object.prototype.hasOwnProperty.call(prev, h.name)) return prev
                          const { [h.name]: _removed, ...rest } = prev
                          return rest
                        })
                        if (shouldEnsureEmptyRowAfterDelete) {
                          setHeaderDraftRows(prev =>
                            prev.length ? prev : [{ id: uid('hrow'), name: '', value: '', isActive: true }],
                          )
                        }
                      }
                  }
                />
              )
            })}

          {headerDraftRows.map(row => (
              <HeaderDraftRow
                key={row.id}
                rowId={row.id}
                name={row.name}
                value={row.value}
                isActive={row.isActive}
                onToggleActive={isActive => setHeaderDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, isActive } : r)))}
                onChangeName={nextName => setHeaderDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, name: nextName } : r)))}
                onChangeValue={nextValue => setHeaderDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, value: nextValue } : r)))}
                onCommit={() => commitHeaderDraftRowById(row.id)}
                variableSuggestions={variableSuggestions}
                historyItems={valueHistory.header[row.name.trim()] ?? []}
                onRecordHistory={next => recordValueHistory('header', row.name, next)}
                onPickHistory={next => {
                  setHeaderDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, value: next } : r)))
                  recordValueHistory('header', row.name, next)
                }}
                onDeleteHistoryItem={next => deleteValueHistoryItem('header', row.name, next)}
                onClearAllHistory={clearAllValueHistory}
                historyMenuId={`headerDraft:${row.id}`}
                historyMenuOpenId={valueHistoryMenuOpenId}
                historyMenuAnchor={valueHistoryMenuAnchor}
                onToggleHistoryMenu={toggleValueHistoryMenu}
                onCloseHistoryMenu={closeValueHistoryMenu}
                historyMenuPanelRef={valueHistoryMenuPanelRef}
                onDelete={() => {
                  setHeaderDraftRows(prev => {
                    if (prev.length === 1 && prev[0]?.id === row.id) {
                      if (visibleHeaderParams.length > 0) return []
                      return [{ ...prev[0], name: '', value: '', isActive: true }]
                    }
                    return prev.filter(r => r.id !== row.id)
                  })
                }}
              />
            ))}

          </div>
        </div>
      )}

      <details className="accordion" open>
        <summary>
          <span>Params</span>
          <span style={{ marginLeft: 'auto' }} />
          <button
            type="button"
            className="iconBtn addRowBtn"
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              addQueryDraftRow()
            }}
            aria-label="Add query param"
            title="Add query param"
          >
            <span className="addRowGlyph">+</span>
          </button>
        </summary>
        {pathParamsList.length > 0 && (
          <div className="section">
            <div className="sectionTitle">Path</div>
            {pathParamsList.map(p => ( 
              <ParamRow 
                key={p.name} 
                param={p} 
                store={pathParams} 
                setStore={setPathParams} 
                onClear={() => { 
                  setPathParams(prev => { 
                    if (!(p.name in prev)) return prev 
                    const next = { ...prev } 
                    delete next[p.name] 
                    return next 
                  }) 
                }} 
                variableSuggestions={variableSuggestions} 
                enumMenuId={`enum:path:${p.name}`}
                enumMenuOpenId={enumMenuOpenId}
                enumMenuAnchor={enumMenuAnchor}
                onToggleEnumMenu={toggleEnumMenu}
                onCloseEnumMenu={closeEnumMenu}
                enumMenuPanelRef={enumMenuPanelRef}
                historyItems={valueHistory.path[p.name] ?? []} 
                onRecordHistory={next => recordValueHistory('path', p.name, next)} 
                onPickHistory={next => { 
                  setPathParams(prev => ({ ...prev, [p.name]: next })) 
                  recordValueHistory('path', p.name, next)
                }}
                onDeleteHistoryItem={next => deleteValueHistoryItem('path', p.name, next)}
                onClearAllHistory={clearAllValueHistory}
                historyMenuId={`path:${p.name}`}
                historyMenuOpenId={valueHistoryMenuOpenId}
                historyMenuAnchor={valueHistoryMenuAnchor}
                onToggleHistoryMenu={toggleValueHistoryMenu}
                onCloseHistoryMenu={closeValueHistoryMenu}
                historyMenuPanelRef={valueHistoryMenuPanelRef}
              />
            ))}
          </div>
        )}

        <div className="section">
          <div className="sectionTitle">Query</div>
          {queryParamsList.map(p => {
            const rawName = p.name
            const isSpec = querySpecNames.has(rawName)
            const isRequiredSpecKey = isSpec && !!p.required
            const effectiveName =
              isRequiredSpecKey
                ? rawName
                : isSpec
                  ? (queryParamKeyOverrides[rawName] ?? rawName)
                  : rawName
            const value = queryParams[effectiveName] ?? ''
            const isActive = !inactiveQueryParamNames[effectiveName]
            const hint =
              typeof p.example === 'string' || typeof p.example === 'number'
                ? String(p.example)
                : p.schemaType || ''

            return (
              <QueryRow
                key={rawName}
                name={effectiveName}
                rawName={rawName}
                isSpec={isSpec}
                value={value}
                hint={isSpec ? hint : undefined}
                enumValues={isSpec ? p.enumValues : undefined}
                required={isSpec ? p.required : false}
                readOnlyName={isRequiredSpecKey}
                isActive={isActive}
                onToggleActive={nextActive => setInactiveQueryParamNames(prev => setFlagForKey(prev, effectiveName, nextActive))}
                variableSuggestions={variableSuggestions}
                historyItems={valueHistory.query[effectiveName] ?? []}
                onRecordHistory={next => recordValueHistory('query', effectiveName, next)}
                onPickHistory={next => {
                  setQueryParams(prev => {
                    const nextParams = { ...prev }
                    nextParams[effectiveName] = next
                    if (isSpec && effectiveName !== rawName) delete nextParams[rawName]
                    return nextParams
                  })
                  setInactiveQueryParamNames(prev => setFlagForKey(prev, effectiveName, true))
                  recordValueHistory('query', effectiveName, next)
                }}
                onDeleteHistoryItem={next => deleteValueHistoryItem('query', effectiveName, next)}
                onClearAllHistory={clearAllValueHistory}
                historyMenuId={`query:${effectiveName}`}
                historyMenuOpenId={valueHistoryMenuOpenId}
                historyMenuAnchor={valueHistoryMenuAnchor}
                onToggleHistoryMenu={toggleValueHistoryMenu}
                onCloseHistoryMenu={closeValueHistoryMenu}
                historyMenuPanelRef={valueHistoryMenuPanelRef}
                enumMenuId={isSpec ? `enum:query:${rawName}` : undefined}
                enumMenuOpenId={enumMenuOpenId}
                enumMenuAnchor={enumMenuAnchor}
                onToggleEnumMenu={toggleEnumMenu}
                onCloseEnumMenu={closeEnumMenu}
                enumMenuPanelRef={enumMenuPanelRef}
                onChangeValue={nextValue => {
                  setQueryParams(prev => {
                    const next = { ...prev }
                    next[effectiveName] = nextValue
                    if (isSpec && effectiveName !== rawName) delete next[rawName]
                    return next
                  })
                }}
                onRename={
                  isRequiredSpecKey
                    ? undefined
                    : nextName => {
                    const trimmed = nextName.trim()
                    if (trimmed === effectiveName) return

                    if (isSpec) {
                      if (!trimmed) {
                        setQueryParams(prev => {
                          if (!(effectiveName in prev) && !(rawName in prev)) return prev
                          const next = { ...prev }
                          delete next[effectiveName]
                          if (rawName !== effectiveName) delete next[rawName]
                          return next
                        })
                        setInactiveQueryParamNames(prev => {
                          let next = setFlagForKey(prev, effectiveName, true)
                          if (rawName !== effectiveName) next = setFlagForKey(next, rawName, true)
                          return next
                        })
                        return
                      }
                      setQueryParams(prev => renameStoreKey(prev, effectiveName, trimmed))
                      setInactiveQueryParamNames(prev => renameFlagKey(prev, effectiveName, trimmed))
                      setQueryParamKeyOverrides(prev => {
                        const next = { ...prev }
                        if (trimmed === rawName) delete next[rawName]
                        else next[rawName] = trimmed
                        return next
                      })
                      setInactiveQueryParamNames(prev => setFlagForKey(prev, trimmed, isActive))
                      setQueryKeyOrder(prev => replaceKeyInOrder(prev, effectiveName, trimmed))
                      return
                    }

                    if (!trimmed) {
                      setQueryDraftRows(prev => [...prev, { id: uid('qrow'), name: '', value, isActive: true }])
                      setQueryParams(prev => {
                        if (!(effectiveName in prev)) return prev
                        const next = { ...prev }
                        delete next[effectiveName]
                        return next
                      })
                      setInactiveQueryParamNames(prev => setFlagForKey(prev, effectiveName, true))
                      return
                    }

                    setQueryParams(prev => renameStoreKey(prev, effectiveName, trimmed))
                    setInactiveQueryParamNames(prev => renameFlagKey(prev, effectiveName, trimmed))
                    setQueryKeyOrder(prev => replaceKeyInOrder(prev, effectiveName, trimmed))
                  }
                }
                onDelete={isRequiredSpecKey ? () => {
                  setQueryParams(prev => {
                    if (!Object.prototype.hasOwnProperty.call(prev, effectiveName)) return prev
                    if (prev[effectiveName] === '') return prev
                    return { ...prev, [effectiveName]: '' }
                  })
                } : () => {
                  const totalRows = queryParamsList.length + queryDraftRows.length
                  const isLastRow = totalRows === 1

                  if (isLastRow) {
                    if (isSpec) {
                      setQueryParams(prev => {
                        if (!(effectiveName in prev) && !(rawName in prev)) return prev
                        const next = { ...prev }
                        delete next[effectiveName]
                        if (rawName !== effectiveName) delete next[rawName]
                        return next
                      })
                      setInactiveQueryParamNames(prev => {
                        let next = setFlagForKey(prev, effectiveName, true)
                        if (rawName !== effectiveName) next = setFlagForKey(next, rawName, true)
                        return next
                      })
                      setQueryParamKeyOverrides(prev => {
                        if (!(rawName in prev)) return prev
                        const next = { ...prev }
                        delete next[rawName]
                        return next
                      })
                      setDisabledQueryParamNames(prev => ({ ...prev, [rawName]: true }))
                      setQueryDraftRows(prev => (prev.length ? prev : [{ id: uid('qrow'), name: '', value: '', isActive: true }]))
                      return
                    }

                    setQueryParams(prev => {
                      if (!(effectiveName in prev) && !(rawName in prev)) return prev
                      const next = { ...prev }
                      delete next[effectiveName]
                      if (rawName !== effectiveName) delete next[rawName]
                      return next
                    })
                    setQueryDraftRows(prev => (prev.length ? [{ ...prev[0], name: '', value: '', isActive: true }, ...prev.slice(1)] : [{ id: uid('qrow'), name: '', value: '', isActive: true }]))
                    setInactiveQueryParamNames(prev => {
                      let next = setFlagForKey(prev, effectiveName, true)
                      if (rawName !== effectiveName) next = setFlagForKey(next, rawName, true)
                      return next
                    })
                    return
                  }

                  setQueryParams(prev => {
                    if (!(effectiveName in prev) && !(rawName in prev)) return prev
                    const next = { ...prev }
                    delete next[effectiveName]
                    if (rawName !== effectiveName) delete next[rawName]
                    return next
                  })
                  setInactiveQueryParamNames(prev => {
                    let next = setFlagForKey(prev, effectiveName, true)
                    if (rawName !== effectiveName) next = setFlagForKey(next, rawName, true)
                    return next
                  })
                  if (isSpec) {
                    setQueryParamKeyOverrides(prev => {
                      if (!(rawName in prev)) return prev
                      const next = { ...prev }
                      delete next[rawName]
                      return next
                    })
                    setDisabledQueryParamNames(prev => ({ ...prev, [rawName]: true }))
                  }
                }}
              />
            )
          })}

          {queryDraftRows.map(row => (
            <QueryDraftRow
              key={row.id}
              rowId={row.id}
              name={row.name}
              value={row.value}
              isActive={row.isActive}
              onToggleActive={isActive => setQueryDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, isActive } : r)))}
              onChangeName={nextName => setQueryDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, name: nextName } : r)))}
              onChangeValue={nextValue => setQueryDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, value: nextValue } : r)))}
              onCommit={() => commitQueryDraftRowById(row.id)}
              variableSuggestions={variableSuggestions}
              historyItems={valueHistory.query[row.name.trim()] ?? []}
              onRecordHistory={next => recordValueHistory('query', row.name, next)}
              onPickHistory={next => {
                setQueryDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, value: next } : r)))
                setQueryDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, isActive: true } : r)))
                recordValueHistory('query', row.name, next)
              }}
              onDeleteHistoryItem={next => deleteValueHistoryItem('query', row.name, next)}
              onClearAllHistory={clearAllValueHistory}
              historyMenuId={`queryDraft:${row.id}`}
              historyMenuOpenId={valueHistoryMenuOpenId}
              historyMenuAnchor={valueHistoryMenuAnchor}
              onToggleHistoryMenu={toggleValueHistoryMenu}
              onCloseHistoryMenu={closeValueHistoryMenu}
              historyMenuPanelRef={valueHistoryMenuPanelRef}
              onDelete={() => {
                setQueryDraftRows(prev => {
                  if (prev.length === 1 && prev[0]?.id === row.id) {
                    if (queryParamsList.length > 0) return []
                    return [{ ...prev[0], name: '', value: '', isActive: true }]
                  }
                  return prev.filter(r => r.id !== row.id)
                })
              }}
            />
          ))}
        </div>
      </details>

      <details
        className="accordion"
        open={isBodyOpen}
        onToggle={e => setIsBodyOpen(e.currentTarget.open)}
      >
        <summary>
          <span>Body</span>
          <span style={{ marginLeft: 'auto' }} />
          <div ref={bodyFormatMenuWrapRef} className="selectMenuWrap" style={{ width: 120 }}>
            <button
              type="button"
              className="selectMenuBtn mono bodyFormatMenuBtn"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                setBodyFormatMenuOpen(v => !v)
              }}
              aria-haspopup="menu"
              aria-expanded={bodyFormatMenuOpen}
              aria-label="Body format"
              title="Body format"
            >
              {labelForBodyFormat(bodyFormat)}
            </button>
          </div>
          <button
            type="button"
            className="bodyBeautifyBtn mono"
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              reloadExampleBodyText()
            }}
            aria-label="Reload example body"
            title={hasExampleBody ? 'Reload example body' : 'Clear body'}
          >
            <ReloadIcon size={16} />
          </button>
          <button
            type="button"
            className="bodyBeautifyBtn mono"
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              beautifyBodyText()
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
              void copyBodyText()
            }}
            aria-label="Copy body"
            title="Copy body"
            style={{ width: 32, height: 32 }}
          >
            {bodyCopied ? 'OK' : <CopyIcon />}
          </button>
          <ConfirmIconButton
            className="iconBtn"
            onConfirm={() => setBodyText('')}
            ariaLabel="Clear body"
            confirmAriaLabel="Confirm clear body"
            title="Clear body"
            confirmTitle="Confirm clear body"
            icon={<CloseIcon size={18} />}
          />
        </summary>
          <VariableAutocompleteField
            as="textarea"
            ref={bodyTextareaRef as any}
            className="mono editorTextarea"
            value={bodyText}
            spellCheck={false}
            suggestions={variableSuggestions}
            onChangeValue={setBodyText}
          onKeyDown={e => {
            if (e.ctrlKey || e.metaKey || e.altKey) return
            if (e.key === 'Tab') {
              e.preventDefault()
              e.stopPropagation()
              applyBodyTabIndent(e.shiftKey)
              return
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.stopPropagation()
              applyBodyEnterIndent()
              return
            }
            if (e.key === '"') {
              const ta = bodyTextareaRef.current
              if (!ta) return

              const selStart = ta.selectionStart ?? 0
              const selEnd = ta.selectionEnd ?? 0

              if (selStart === selEnd && ta.value[selStart] === '"') {
                e.preventDefault()
                e.stopPropagation()
                const nextPos = selStart + 1
                ta.selectionStart = nextPos
                ta.selectionEnd = nextPos
                return
              }

              e.preventDefault()
              e.stopPropagation()

              if (selStart !== selEnd) {
                const selected = ta.value.slice(selStart, selEnd)
                applyBodyTextareaReplacement(selStart, selEnd, `"${selected}"`, selStart + 1, selEnd + 1)
                return
              }

              applyBodyTextareaReplacement(selStart, selEnd, '""', selStart + 1, selStart + 1)
            }
            if (e.key === '{' || e.key === '[') {
              const ta = bodyTextareaRef.current
              if (!ta) return

              const selStart = ta.selectionStart ?? 0
              const selEnd = ta.selectionEnd ?? 0

              e.preventDefault()
              e.stopPropagation()

              const open = e.key
              const close = open === '{' ? '}' : ']'

              if (selStart !== selEnd) {
                const selected = ta.value.slice(selStart, selEnd)
                applyBodyTextareaReplacement(selStart, selEnd, `${open}${selected}${close}`, selStart + 1, selEnd + 1)
                return
              }

              applyBodyTextareaReplacement(selStart, selEnd, `${open}${close}`, selStart + 1, selStart + 1)
            }
          }}
          rows={18}
        />
      </details>

      {(
        <details
          className="accordion"
          open={isFileOpen}
          onToggle={e => setIsFileOpen(e.currentTarget.open)}
        >
          <summary>
            <span>File</span>
            <span style={{ marginLeft: 'auto' }} />
            <button
              type="button"
              className="iconBtn addRowBtn"
              aria-disabled={false}
              aria-label="Add file"
              title={isMultipartForm ? 'Add file' : 'Add file (multiple files are only sent for multipart/form-data)'}
              onPointerDown={e => e.stopPropagation()}
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  setIsFileOpen(true)
                  setFileRows(prev => [...prev, { id: uid('frow'), fieldName: '', file: null, isActive: true }])
                }}
              >
                <span className="addRowGlyph">+</span>
              </button>
          </summary>
          {renderFilePicker()}
        </details>
      )}

      {bodyFormatMenuOpen ? (
        <div
          ref={bodyFormatMenuPanelRef}
          className="selectMenuPanel"
          role="menu"
          style={{ position: 'fixed', left: bodyFormatMenuAnchor.left, top: bodyFormatMenuAnchor.top, width: bodyFormatMenuAnchor.width, zIndex: 200 }}
          onPointerDown={e => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={e => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          {(['auto', 'json', 'xml', 'yaml', 'text'] as BodyFormat[]).map(v => (
            <button
              key={v}
              type="button"
              className={`selectMenuItem ${bodyFormat === v ? 'selectMenuItemActive' : ''}`}
              role="menuitem"
              onClick={() => pickBodyFormat(v)}
            >
              {labelForBodyFormat(v)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
