import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { Collection, HttpMethod, RequestItem, RequestParam } from '../../shared/types/collection'
import type { Environment } from '../../shared/types/environment'
import type { RequestDraft, RequestHistoryItem } from '../../shared/types/requestHistory'
import { CloseIcon, CopyIcon, ReloadIcon, StarIcon } from '../../shared/icons'
import { computeEffectiveBaseUrl, isAbsoluteUrl, joinUrlParts } from '../../shared/utils/url'
import { uid } from '../../shared/utils/id'
import { runRequest, type RunResult } from './runRequest'
import { beautifyBody, type BeautifyBodyFormat } from './bodyBeautify'
import { DB_ENV_KEYS, buildDbConnectionString, getDbFormStateFromEnv, runDbSql } from '../environment/dbConnection'
import { SqlScriptsTab } from './SqlScriptsTab'
import { AuthorizationTab } from './AuthorizationTab'
import { getVariableSuggestions, resolveVariableValue, type VariableSuggestion } from '../../shared/utils/variables'
import { VariableAutocompleteField } from '../../components/VariableAutocompleteField'

const REQUEST_DRAFTS_KEY = 'ruf_request_drafts_v1'
const VALUE_HISTORY_KEY = 'ruf_value_history_v1'

type BodyFormat = NonNullable<RequestDraft['bodyFormat']>
type ValueHistoryKind = 'header' | 'query' | 'path'
type ValueHistoryStore = Record<ValueHistoryKind, Record<string, string[]>>

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

function inferBodyFormatFromContentType(contentType: string): Exclude<BodyFormat, 'auto'> {
  const ct = (contentType || '').toLowerCase()
  if (ct.includes('json')) return 'json'
  if (ct.includes('yaml') || ct.includes('yml')) return 'yaml'
  if (ct.includes('xml')) return 'xml'
  if (ct.includes('text/plain')) return 'text'
  return 'text'
}


function safeParseJson<T>(raw: string | null): T | null {
  try {
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function loadValueHistory(): ValueHistoryStore {
  const parsed = safeParseJson<any>(localStorage.getItem(VALUE_HISTORY_KEY))
  const empty: ValueHistoryStore = { header: {}, query: {}, path: {} }
  if (!parsed || typeof parsed !== 'object') return empty
  const obj = parsed as Partial<ValueHistoryStore>
  return {
    header: obj.header && typeof obj.header === 'object' ? obj.header : {},
    query: obj.query && typeof obj.query === 'object' ? obj.query : {},
    path: obj.path && typeof obj.path === 'object' ? obj.path : {},
  }
}

function saveValueHistory(store: ValueHistoryStore) {
  localStorage.setItem(VALUE_HISTORY_KEY, JSON.stringify(store))
}

function addValueHistoryEntry(
  prev: ValueHistoryStore,
  kind: ValueHistoryKind,
  keyRaw: string,
  valueRaw: string,
  maxItems = 10,
): ValueHistoryStore {
  const key = keyRaw.trim()
  const value = valueRaw.trim()
  if (!key || !value) return prev

  const prevByKind = prev[kind] ?? {}
  const prevList = prevByKind[key] ?? []
  const nextList = [value, ...prevList.filter(v => v !== value)].slice(0, maxItems)
  if (prevList.length === nextList.length && prevList.every((v, i) => v === nextList[i])) return prev

  return {
    ...prev,
    [kind]: {
      ...prevByKind,
      [key]: nextList,
    },
  }
}

function removeValueHistoryEntry(
  prev: ValueHistoryStore,
  kind: ValueHistoryKind,
  keyRaw: string,
  valueRaw: string,
): ValueHistoryStore {
  const key = keyRaw.trim()
  const value = valueRaw.trim()
  if (!key || !value) return prev

  const prevByKind = prev[kind] ?? {}
  const prevList = prevByKind[key] ?? []
  if (!prevList.length) return prev

  const nextList = prevList.filter(v => v !== value)
  if (nextList.length === prevList.length) return prev

  const nextByKind: Record<string, string[]> = { ...prevByKind }
  if (nextList.length) nextByKind[key] = nextList
  else delete nextByKind[key]

  return { ...prev, [kind]: nextByKind }
}

function loadDraft(requestId: string): RequestDraft | null {
  const parsed = safeParseJson<any>(localStorage.getItem(REQUEST_DRAFTS_KEY))
  if (!parsed || typeof parsed !== 'object') return null
  const draft = (parsed as any)[requestId]
  if (!draft || typeof draft !== 'object') return null
  return draft as RequestDraft
}

function saveDraft(requestId: string, draft: RequestDraft) {
  const parsed = safeParseJson<any>(localStorage.getItem(REQUEST_DRAFTS_KEY))
  const next = parsed && typeof parsed === 'object' ? parsed : {}
  next[requestId] = draft
  localStorage.setItem(REQUEST_DRAFTS_KEY, JSON.stringify(next))
}

async function copyText(text: string) {
  if (globalThis.isSecureContext && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}

function applyPathParamsForDisplay(url: string, values: Record<string, string>) {
  let out = url

  out = out.replaceAll(/\/\{([^}]+)\}/g, (m: string, key: string) => {
    const v = (values[key] ?? '').trim()
    if (!v) return ''
    return m
  })

  out = out.replaceAll(/\{([^}]+)\}/g, (_m: string, key: string) => {
    const v = (values[key] ?? '').trim()
    return v
  })

  out = out.replaceAll(/\/{2,}/g, '/')
  return out
}

function applyVariablesForDisplay(text: string, vars: Record<string, string>) {
  return text.replaceAll(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m: string, name: string) => resolveVariableValue(name, vars) ?? '')
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

function ParamRow(props: { 
  param: RequestParam 
  store: Record<string, string> 
  setStore: Dispatch<SetStateAction<Record<string, string>>> 
  onClear?: () => void 
  variableSuggestions: VariableSuggestion[] 
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
      </div> 
      {props.onClear ? ( 
        <button 
          type="button" 
          className="rowDeleteBtn" 
          onClick={e => { 
            e.preventDefault() 
            e.stopPropagation() 
            props.onClear?.() 
          }} 
          disabled={!value} 
          aria-disabled={!value} 
          aria-label={`Clear path param ${props.param.name}`} 
          title={value ? 'Clear' : 'Empty'} 
        > 
          <CloseIcon size={18} /> 
        </button> 
      ) : null} 
      </div> 
    </div> 
  ) 
} 

function normalizeHeaderParams(requestHeaders: RequestParam[], headersStore: Record<string, string>) {
  const spec = requestHeaders.filter(Boolean)
  const out: RequestParam[] = [...spec]
  for (const k of Object.keys(headersStore)) {
    if (spec.some(x => x.name === k)) continue
    out.push({ name: k, in: 'header', required: false })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
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
}) {
  const [draftName, setDraftName] = useState(props.name)

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
      {props.readOnlyName ? (
        <div className={`formLabel mono ${props.isActive ? '' : 'rowInactive'}`.trim()}>{props.name}</div>
      ) : (
        <input
          className={`mono ${props.isActive ? '' : 'rowInactive'}`.trim()}
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
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div
          style={{ position: 'relative', flex: 1, minWidth: 0 }}
          data-value-history-anchor
          data-commit-kind="header"
          data-commit-key={props.name}
        >
          <VariableAutocompleteField
            className={`mono valueHistoryInput ${props.isActive ? '' : 'rowInactive'}`.trim()}
            value={props.value}
            suggestions={props.variableSuggestions}
            onChangeValue={props.onChangeValue}
            onBlur={e => props.onRecordHistory((e.target as HTMLInputElement | HTMLTextAreaElement).value ?? props.value)}
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
            aria-label={`Toggle ${props.name}`}
            onChange={e => props.onToggleActive(e.target.checked)}
            onClick={e => e.stopPropagation()}
          />
          <span className="checkBox" aria-hidden="true" />
        </label>
        {props.onDelete ? (
          <button className="headerDeleteBtn" onClick={props.onDelete} aria-label={`Delete header ${props.name}`} title="Delete">
            <CloseIcon size={18} />
          </button>
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
}) {
  const [draftName, setDraftName] = useState(props.name)

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
          {props.required ? <span className="reqStar keyReqStar">*</span> : null}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div
          style={{ position: 'relative', flex: 1, minWidth: 0 }}
          data-value-history-anchor
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
          <button
            className="rowDeleteBtn"
            onClick={props.onDelete}
            aria-label={`Delete query param ${props.name}`}
            title="Delete"
          >
            <CloseIcon size={18} />
          </button>
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
            onBlur={e => props.onRecordHistory((e.target as HTMLInputElement | HTMLTextAreaElement).value ?? props.value)}
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
        <button
          className="rowDeleteBtn"
          onClick={canDelete ? props.onDelete : undefined}
          disabled={!canDelete}
          aria-disabled={!canDelete}
          aria-label="Delete query param"
          title={canDelete ? 'Delete' : 'Cannot delete'}
        >
          <CloseIcon size={18} />
        </button>
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
            onBlur={e => props.onRecordHistory((e.target as HTMLInputElement | HTMLTextAreaElement).value ?? props.value)}
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
        <button
          className="headerDeleteBtn"
          onClick={canDelete ? props.onDelete : undefined}
          disabled={!canDelete}
          aria-disabled={!canDelete}
          aria-label="Delete header"
          title={canDelete ? 'Delete' : 'Cannot delete'}
        >
          <CloseIcon size={18} />
        </button>
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
  const urlInputRef = useRef<HTMLInputElement | null>(null)
  const urlEditStartRef = useRef('')
  const ignoreNextUrlBlurCommitRef = useRef(false)
  const methodMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const valueHistoryMenuPanelRef = useRef<HTMLDivElement | null>(null)

  const [pathParams, setPathParams] = useState<Record<string, string>>({})
  const [queryParams, setQueryParams] = useState<Record<string, string>>({})
  const [queryDraftRows, setQueryDraftRows] = useState<Array<{ id: string, name: string, value: string, isActive: boolean }>>([])
  const [queryParamKeyOverrides, setQueryParamKeyOverrides] = useState<Record<string, string>>({})
  const [disabledQueryParamNames, setDisabledQueryParamNames] = useState<Record<string, true>>({})
  const [inactiveQueryParamNames, setInactiveQueryParamNames] = useState<Record<string, true>>({})
  const [headerOverrides, setHeaderOverrides] = useState<Record<string, string>>({})
  const [disabledHeaderNames, setDisabledHeaderNames] = useState<Record<string, true>>({})
  const [inactiveHeaderNames, setInactiveHeaderNames] = useState<Record<string, true>>({})
  const [headerDraftRows, setHeaderDraftRows] = useState<Array<{ id: string, name: string, value: string, isActive: boolean }>>([])
  const [valueHistory, setValueHistory] = useState<ValueHistoryStore>(() => loadValueHistory())
  const [valueHistoryMenuOpenId, setValueHistoryMenuOpenId] = useState<string | null>(null)
  const [valueHistoryMenuAnchor, setValueHistoryMenuAnchor] = useState<{ left: number, top: number, width: number } | null>(null)
  const [bodyFile, setBodyFile] = useState<File | null>(null)
  const [fileFieldName, setFileFieldName] = useState('file')
  const [baseUrlKey, setBaseUrlKey] = useState('baseUrl')
  const [showBaseUrlPicker, setShowBaseUrlPicker] = useState(false)
  const [urlCopied, setUrlCopied] = useState(false)
  const [urlTemplateOverride, setUrlTemplateOverride] = useState('')
  const [isEditingUrl, setIsEditingUrl] = useState(false)
  const [urlDraftText, setUrlDraftText] = useState('')
  const [methodMenuOpen, setMethodMenuOpen] = useState(false)
  const [headersTab, setHeadersTab] = useState<'headers' | 'authorization' | 'sql'>('headers')

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

  function toggleValueHistoryMenu(menuId: string, anchorEl: HTMLElement) {
    if (valueHistoryMenuOpenId === menuId) {
      closeValueHistoryMenu()
      return
    }

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
    const keys = Object.keys(envVars).filter(k => k !== 'scheme').sort((a, b) => a.localeCompare(b))
    if (!keys.length && baseUrlKey) return [baseUrlKey]
    if (baseUrlKey && !keys.includes(baseUrlKey)) return [...keys, baseUrlKey].sort((a, b) => a.localeCompare(b))
    return keys
  }, [baseUrlKey, props.environment])

  const [bodyText, setBodyText] = useState('')
  const [bodyCopied, setBodyCopied] = useState(false)
  const [isBodyOpen, setIsBodyOpen] = useState(!!props.request.body)
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

  function requestDefaultBodyText() {
    const b = props.request.body?.example
    if (b === undefined) return ''
    if (typeof b === 'string') return b
    return JSON.stringify(b, null, 2)
  }

  useEffect(() => {
    const draft = loadDraft(props.request.id)
    const nextPathParams = draft?.pathParams ?? {}
    const nextQueryParams = draft?.queryParams ?? defaultQueryParamsFromSpec(props.request.params)
    const nextInactiveQueryParamNames =
      draft?.inactiveQueryParamNames && typeof draft.inactiveQueryParamNames === 'object' ? draft.inactiveQueryParamNames : {}

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
      draft?.inactiveHeaderNames && typeof draft.inactiveHeaderNames === 'object' ? draft.inactiveHeaderNames : {}

    const headersForSeedCheck = (() => {
      const next: Record<string, string> = { ...env, ...base, ...nextHeaderOverrides }
      for (const key of Object.keys(nextDisabledHeaderNames)) delete next[key]
      return next
    })()

    const hasQueryParamsSpec = props.request.params.some(p => p.in === 'query')
    const hasQueryParamsStore = Object.keys(nextQueryParams).length > 0
    const shouldSeedQueryDraft = !hasQueryParamsSpec && !hasQueryParamsStore

    const hasHeadersSpec = props.request.params.some(p => p.in === 'header' && p.name.toLowerCase() !== 'authorization')
    const hasHeadersStore = Object.keys(headersForSeedCheck).some(k => k.toLowerCase() !== 'authorization')
    const shouldSeedHeaderDraft = !hasHeadersSpec && !hasHeadersStore

    setPathParams(nextPathParams)
    setQueryParams(nextQueryParams)
    setQueryDraftRows(shouldSeedQueryDraft ? [{ id: uid('qrow'), name: '', value: '', isActive: true }] : [])
    setQueryParamKeyOverrides(draft?.queryParamKeyOverrides ?? {})
    setDisabledQueryParamNames(draft?.disabledQueryParamNames ?? {})
    setInactiveQueryParamNames(nextInactiveQueryParamNames)
    setHeaderOverrides(nextHeaderOverrides)
    setDisabledHeaderNames(nextDisabledHeaderNames)
    setInactiveHeaderNames(nextInactiveHeaderNames)
    setHeaderDraftRows(shouldSeedHeaderDraft ? [{ id: uid('hrow'), name: '', value: '', isActive: true }] : [])
    setBaseUrlKey(draft?.baseUrlKey || props.environment?.baseUrlKey || 'baseUrl')
    const nextBodyText = draft?.bodyText ?? requestDefaultBodyText()
    setBodyText(nextBodyText)
    setIsBodyOpen(!!props.request.body)
    setBodyFormat(draft?.bodyFormat ?? 'auto')
    setUrlTemplateOverride(draft?.urlTemplateOverride ?? '')
    setIsEditingUrl(false)
    setUrlDraftText('')
    setBodyFile(null)
    setFileFieldName(draft?.fileFieldName || 'file')
    setShowBaseUrlPicker(false)
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

    const headersForSeedCheck = (() => {
      const next: Record<string, string> = { ...env, ...base, ...nextHeaderOverrides }
      for (const key of Object.keys(nextDisabledHeaderNames)) delete next[key]
      return next
    })()

    const hasQueryParamsSpec = props.request.params.some(p => p.in === 'query')
    const hasQueryParamsStore = Object.keys(nextQueryParams).length > 0
    const shouldSeedQueryDraft = !hasQueryParamsSpec && !hasQueryParamsStore

    const hasHeadersSpec = props.request.params.some(p => p.in === 'header' && p.name.toLowerCase() !== 'authorization')
    const hasHeadersStore = Object.keys(headersForSeedCheck).some(k => k.toLowerCase() !== 'authorization')
    const shouldSeedHeaderDraft = !hasHeadersSpec && !hasHeadersStore

    setPathParams(nextPathParams)
    setQueryParams(nextQueryParams)
    setQueryDraftRows(shouldSeedQueryDraft ? [{ id: uid('qrow'), name: '', value: '', isActive: true }] : [])
    setQueryParamKeyOverrides(draft?.queryParamKeyOverrides ?? {})
    setDisabledQueryParamNames(draft?.disabledQueryParamNames ?? {})
    setInactiveQueryParamNames(nextInactiveQueryParamNames)
    setHeaderOverrides(nextHeaderOverrides)
    setDisabledHeaderNames(nextDisabledHeaderNames)
    setInactiveHeaderNames(nextInactiveHeaderNames)
    setHeaderDraftRows(shouldSeedHeaderDraft ? [{ id: uid('hrow'), name: '', value: '', isActive: true }] : [])
    setBaseUrlKey(draft?.baseUrlKey || props.environment?.baseUrlKey || 'baseUrl')
    const nextBodyText = draft?.bodyText ?? requestDefaultBodyText()
    setBodyText(nextBodyText)
    setIsBodyOpen(!!props.request.body)
    setBodyFormat(draft?.bodyFormat ?? 'auto')
    setUrlTemplateOverride(draft?.urlTemplateOverride ?? '')
    setIsEditingUrl(false)
    setUrlDraftText('')
    setBodyFile(null)
    setFileFieldName(draft?.fileFieldName || 'file')
    setShowBaseUrlPicker(false)
    setPreSqlScript(draft?.preSqlScript ?? '')
    setPostSqlScript(draft?.postSqlScript ?? '')

    saveDraft(props.request.id, {
      pathParams: draft?.pathParams ?? {},
      queryParams: draft?.queryParams ?? defaultQueryParamsFromSpec(props.request.params),
      inactiveQueryParamNames: nextInactiveQueryParamNames,
      queryParamKeyOverrides: draft?.queryParamKeyOverrides ?? {},
      disabledQueryParamNames: draft?.disabledQueryParamNames ?? {},
      preSqlScript: draft?.preSqlScript ?? '',
      postSqlScript: draft?.postSqlScript ?? '',
      headerOverrides: nextHeaderOverrides,
      disabledHeaderNames: nextDisabledHeaderNames,
      inactiveHeaderNames: nextInactiveHeaderNames,
      bodyText: nextBodyText,
      bodyFormat: draft?.bodyFormat ?? 'auto',
      fileFieldName: draft?.fileFieldName || 'file',
      baseUrlKey: draft?.baseUrlKey || props.environment?.baseUrlKey || 'baseUrl',
      urlTemplateOverride: draft?.urlTemplateOverride ?? '',
    })
  }, [applyDraftToken])

  useEffect(() => {
    if (!props.request.id) return
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current)
    draftSaveTimerRef.current = window.setTimeout(() => {
      saveDraft(props.request.id, {
        pathParams,
        queryParams,
        inactiveQueryParamNames,
        queryParamKeyOverrides,
        disabledQueryParamNames,
        preSqlScript,
        postSqlScript,
        headerOverrides,
        disabledHeaderNames,
        inactiveHeaderNames,
        bodyText,
        bodyFormat,
        fileFieldName,
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
    fileFieldName,
    headerOverrides,
    pathParams,
    postSqlScript,
    preSqlScript,
    props.request.id,
    queryParams,
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
    return out
  }, [disabledQuerySpecNames, grouped.query, queryParams, queryParamKeyOverrides, querySpecNames])

  const headerParams = useMemo(
    () => normalizeHeaderParams(grouped.header, committedHeaders),
    [grouped.header, committedHeaders],
  )
  const headerSpecNames = useMemo(() => new Set(grouped.header.map(h => h.name)), [grouped.header])
  const visibleHeaderParams = useMemo(
    () => headerParams.filter(h => h.name.toLowerCase() !== 'authorization'),
    [headerParams],
  )

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
  const supportsFile = props.request.method !== 'GET' && props.request.method !== 'HEAD' && (
    isMultipartForm || effectiveContentType.toLowerCase().includes('application/octet-stream')
  )

  const resolvedBodyFormatForBeautify = useMemo((): Exclude<BodyFormat, 'auto'> => {
    if (bodyFormat !== 'auto') return bodyFormat
    return inferBodyFormatFromContentType(effectiveContentType)
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

  async function send() {
    const runId = uid('run')
    props.onSendStart?.(props.request.id, runId)
    try {
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

      const hasAnyBodyInput =
        !!bodyText.trim() ||
        !!(supportsFile && bodyFile) ||
        !!(supportsFile && isMultipartForm && Object.keys(parseFormFieldsFromBodyText(bodyText)).length)
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
          queryParams: effectiveQueryParamsForCommit,
          inactiveQueryParamNames: nextInactiveQueryParamNamesForSend,
          queryParamKeyOverrides,
          disabledQueryParamNames: effectiveDisabledQueryParamNamesForSend,
          headers: effectiveHeadersForSend,
          headerOverrides: nextHeaderOverridesForSend,
          disabledHeaderNames: nextDisabledHeaderNamesForSend,
          inactiveHeaderNames: nextInactiveHeaderNamesForSend,
          preSqlScript,
          postSqlScript,
          bodyText,
          bodyFormat,
          fileFieldName,
          baseUrlKey,
          urlTemplateOverride,
        },
      })

      const formFields = supportsFile && effectiveContentType.toLowerCase().includes('multipart/form-data')
        ? parseFormFieldsFromBodyText(bodyText)
        : undefined

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
        headers: {},
        bodyText: message,
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
      }

      let result = await runRequest({
        request: props.request,
        baseUrl,
        urlTemplateOverride,
        variables,
        pathParams,
        queryParams: effectiveQueryParamsForSend,
        headers: effectiveHeadersForSend,
        bodyText,
        file: supportsFile ? bodyFile : undefined,
        fileFieldName: supportsFile ? fileFieldName : undefined,
        formFields,
      })

      if (shouldRunSql && postSql && props.environment) {
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
      const nextValue = beautifyBody(raw, resolvedBodyFormatForBeautify as BeautifyBodyFormat)
      if (ta) applyBodyTextareaReplacement(0, ta.value.length, nextValue, nextValue.length, nextValue.length)
      else setBodyText(nextValue)
    } catch {
      // keep silent: invalid input should not change button state
    }
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
    setUrlCopied(true)
    setTimeout(() => setUrlCopied(false), 900)
  }

  function startUrlEdit() {
    setShowBaseUrlPicker(false)
    urlEditStartRef.current = displayUrl.trim()
    setUrlDraftText(displayUrl)
    setIsEditingUrl(true)
    window.setTimeout(() => urlInputRef.current?.focus(), 0)
  }

  function cancelUrlEdit() {
    setIsEditingUrl(false)
    setUrlDraftText('')
  }

  function commitUrlEdit() {
    const raw = urlDraftText.trim()
    setIsEditingUrl(false)
    if (raw === urlEditStartRef.current) return
    if (!raw) return
    const parsed = parseUrlInput(raw)
    if (parsed.template) setUrlTemplateOverride(parsed.template)
    if (parsed.hasQuery) {
      setQueryParams(parsed.query)
      setQueryParamKeyOverrides({})
      setDisabledQueryParamNames({})
      setQueryDraftRows([])
    }
  }

  useEffect(() => {
    setMethodMenuOpen(false)
  }, [props.request.id])

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
      <div className="editorHeader">
        <div className="editorTitle">
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
          <span className="editorRequestName">{props.request.name}</span>
        </div>
        <button
          onPointerDown={() => commitFocusedValueFieldToState()}
          onClick={send}
          disabled={isSending || !canSend}
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>

      <div>
        <div
          className="mono editorUrl"
          title={displayUrl}
          role="button"
          tabIndex={0}
          onClick={() => {
            if (isEditingUrl) return
            setShowBaseUrlPicker(v => !v)
          }}
          onKeyDown={e => {
            if (isEditingUrl) return
            if (e.key === 'Enter' || e.key === ' ') setShowBaseUrlPicker(v => !v)
            if (e.key === 'Escape') setShowBaseUrlPicker(false)
          }}
          style={{ cursor: 'pointer' }}
        >
          <button
            type="button"
            className="iconBtn"
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              void copyUrlText()
            }}
            aria-label="Copy URL"
            title="Copy URL"
            style={{ width: 28, height: 28 }}
          >
            {urlCopied ? 'OK' : <CopyIcon />}
          </button>

          {isEditingUrl ? (
            <VariableAutocompleteField
              ref={urlInputRef as any}
              className="mono"
              value={urlDraftText}
              suggestions={variableSuggestions}
              onChangeValue={setUrlDraftText}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                if (e.key === 'Enter') commitUrlEdit()
                if (e.key === 'Escape') cancelUrlEdit()
              }}
              onBlur={() => {
                if (ignoreNextUrlBlurCommitRef.current) {
                  ignoreNextUrlBlurCommitRef.current = false
                  return
                }
                commitUrlEdit()
              }}
              style={{ flex: 1, minWidth: 0 }}
            />
          ) : (
            <span className="editorUrlText">
              {displayUrl}
            </span>
          )}

          <button
            type="button"
            className="iconBtn"
            onMouseDown={e => {
              if (!isEditingUrl) return
              e.preventDefault()
              e.stopPropagation()
              ignoreNextUrlBlurCommitRef.current = true
            }}
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              if (isEditingUrl) {
                cancelUrlEdit()
                return
              }
              startUrlEdit()
            }}
            aria-label={isEditingUrl ? 'Close URL editor' : 'Edit URL'}
            title={isEditingUrl ? 'Close' : 'Edit URL'}
            style={{ width: 28, height: 28 }}
          >
            {isEditingUrl ? '✕' : '✎'}
          </button>
        </div>

        {showBaseUrlPicker && (
          <div style={{ marginTop: 6, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="small">Base URL var:</span>
            <select
              className="mono"
              value={baseUrlKey}
              onChange={e => {
                setBaseUrlKey(e.target.value)
                setShowBaseUrlPicker(false)
              }}
            >
              {variableKeys.map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!canSend && (
        <div className="small" style={{ color: '#ff9a9a' }}>
          Укажи Base URL в «Окружение», иначе запрос не отправится.
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
                style={{ width: 28, height: 28 }}
              >
                <ReloadIcon size={16} />
              </button>
              <button
                type="button"
                className="iconBtn addRowBtn"
                onClick={() => addHeaderDraftRow()}
                aria-label="Add header"
                title="Add header"
                style={{ width: 28, height: 28 }}
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
                      }
                  }
                  onDelete={
                    isSpec
                      ? undefined
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
            style={{ width: 28, height: 28 }}
          >
            <span className="addRowGlyph">+</span>
          </button>
        </summary>
        {grouped.path.length > 0 && (
          <div className="section">
            <div className="sectionTitle">Path</div>
            {grouped.path.map(p => ( 
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
            const effectiveName = isSpec ? (queryParamKeyOverrides[rawName] ?? rawName) : rawName
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
                required={isSpec ? p.required : false}
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
                onChangeValue={nextValue => {
                  setQueryParams(prev => {
                    const next = { ...prev }
                    next[effectiveName] = nextValue
                    if (isSpec && effectiveName !== rawName) delete next[rawName]
                    return next
                  })
                }}
                onRename={
                  nextName => {
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
                  }
                }
                onDelete={() => {
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
                      setDisabledQueryParamNames(prev => {
                        if (!(rawName in prev)) return prev
                        const next = { ...prev }
                        delete next[rawName]
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
        </summary>
        {supportsFile && (
          <div className="section" style={{ marginBottom: 10 }}>
            <div className="formRow">
              <div className="formLabel mono">file</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  ref={bodyFileInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={e => setBodyFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  className="chooseFileBtn"
                  onClick={() => bodyFileInputRef.current?.click()}
                >
                  Choose file
                </button>
                {bodyFile ? <span className="small mono">{bodyFile.name}</span> : null}
              </div>
            </div>
            {isMultipartForm && (
              <div className="formRow">
                <div className="formLabel mono">field</div>
                <input
                  className="mono"
                  value={fileFieldName}
                  onChange={e => setFileFieldName(e.target.value)}
                  placeholder="file"
                />
              </div>
            )}
          </div>
        )}
        <VariableAutocompleteField
          as="textarea"
          ref={bodyTextareaRef as any}
          className="mono editorTextarea"
          value={bodyText}
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
