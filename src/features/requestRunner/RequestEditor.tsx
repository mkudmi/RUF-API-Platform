import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Collection, HttpMethod, RequestItem, RequestParam } from '../../shared/types/collection'
import type { Environment } from '../../shared/types/environment'
import type { RequestDraft, RequestHistoryItem } from '../../shared/types/requestHistory'
import { CloseIcon, CopyIcon } from '../../shared/icons'
import { computeEffectiveBaseUrl, isAbsoluteUrl, joinUrlParts } from '../../shared/utils/url'
import { uid } from '../../shared/utils/id'
import { runRequest, type RunResult } from './runRequest'

const REQUEST_DRAFTS_KEY = 'ruf_request_drafts_v1'

function safeParseJson<T>(raw: string | null): T | null {
  try {
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
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
  return url.replaceAll(/\{([^}]+)\}/g, (_, key) => {
    const v = values[key]
    return v ? v : `{${key}}`
  })
}

function applyVariablesForDisplay(text: string, vars: Record<string, string>) {
  return text.replaceAll(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m: string, name: string) => vars[name] ?? '')
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
  
function ParamRow(props: {
  param: RequestParam
  store: Record<string, string>
  setStore: Dispatch<SetStateAction<Record<string, string>>>
}) {
  const value = props.store[props.param.name] ?? ''
  const hint =
    typeof props.param.example === 'string' || typeof props.param.example === 'number'
      ? String(props.param.example)
      : props.param.schemaType || ''

  return (
    <div className="formRow">
      <div className="formLabel mono">
        {props.param.name}
        {props.param.required ? <span className="reqStar">*</span> : null}
      </div>
      <input
        value={value}
        placeholder={hint}
        onChange={e => {
          const nextValue = e.target.value
          props.setStore(prev => {
            if (nextValue !== '') return { ...prev, [props.param.name]: nextValue }
            if (!(props.param.name in prev)) return prev
            const next = { ...prev }
            delete next[props.param.name]
            return next
          })
        }}
      />
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
  onChangeValue: (value: string) => void
  onRename?: (nextName: string) => void
  onDelete?: () => void
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
        <div className="formLabel mono">{props.name}</div>
      ) : (
        <input
          className="mono"
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
        <input
          className="mono"
          style={{ flex: 1, minWidth: 0 }}
          value={props.value}
          onChange={e => props.onChangeValue(e.target.value)}
          placeholder="Value"
        />
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
  value: string
  hint?: string
  required?: boolean
  onChangeValue: (value: string) => void
  onRename?: (nextName: string) => void
  onDelete?: () => void
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
        <input
          className="mono"
          style={{ flex: 1, minWidth: 0 }}
          value={draftName}
          onChange={e => setDraftName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setDraftName(props.name)
          }}
          onBlur={commitRename}
          placeholder="Key"
        />
        {props.required ? <span className="reqStar">*</span> : null}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          className="mono"
          style={{ flex: 1, minWidth: 0 }}
          value={props.value}
          onChange={e => props.onChangeValue(e.target.value)}
          placeholder={props.hint || 'Value'}
        />
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
  name: string
  value: string
  onChangeName: (nextName: string) => void
  onChangeValue: (nextValue: string) => void
  onDelete: () => void
}) {
  return (
    <div className="formRow">
      <input
        className="mono"
        value={props.name}
        onChange={e => props.onChangeName(e.target.value)}
        placeholder="Key"
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          className="mono"
          style={{ flex: 1, minWidth: 0 }}
          value={props.value}
          onChange={e => props.onChangeValue(e.target.value)}
          placeholder="Value"
        />
        <button
          className="rowDeleteBtn"
          onClick={props.onDelete}
          aria-label="Delete query param"
          title="Delete"
        >
          <CloseIcon size={18} />
        </button>
      </div>
    </div>
  )
}

function HeaderDraftRow(props: {
  name: string
  value: string
  onChangeName: (nextName: string) => void
  onChangeValue: (nextValue: string) => void
  onDelete: () => void
}) {
  return (
    <div className="formRow">
      <input
        className="mono"
        value={props.name}
        onChange={e => props.onChangeName(e.target.value)}
        placeholder="Key"
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          className="mono"
          style={{ flex: 1, minWidth: 0 }}
          value={props.value}
          onChange={e => props.onChangeValue(e.target.value)}
          placeholder="Value"
        />
        <button className="headerDeleteBtn" onClick={props.onDelete} aria-label="Delete header" title="Delete">
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

  const [pathParams, setPathParams] = useState<Record<string, string>>({})
  const [queryParams, setQueryParams] = useState<Record<string, string>>({})
  const [queryDraftRows, setQueryDraftRows] = useState<Array<{ id: string, name: string, value: string }>>([])
  const [queryParamKeyOverrides, setQueryParamKeyOverrides] = useState<Record<string, string>>({})
  const [disabledQueryParamNames, setDisabledQueryParamNames] = useState<Record<string, true>>({})
  const [headers, setHeaders] = useState<Record<string, string>>(() => ({
    ...(props.environment?.headers ?? {}),
    ...(props.request.headers ?? {}),
  }))
  const [headerDraftRows, setHeaderDraftRows] = useState<Array<{ id: string, name: string, value: string }>>([])
  const [bodyFile, setBodyFile] = useState<File | null>(null)
  const [fileFieldName, setFileFieldName] = useState('file')
  const [baseUrlKey, setBaseUrlKey] = useState('baseUrl')
  const [showBaseUrlPicker, setShowBaseUrlPicker] = useState(false)
  const [urlCopied, setUrlCopied] = useState(false)
  const [urlTemplateOverride, setUrlTemplateOverride] = useState('')
  const [isEditingUrl, setIsEditingUrl] = useState(false)
  const [urlDraftText, setUrlDraftText] = useState('')
  const [methodMenuOpen, setMethodMenuOpen] = useState(false)

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

  const effectiveHeaders = useMemo(() => {
    const next: Record<string, string> = { ...headers }
    for (const row of headerDraftRows) {
      const k = row.name.trim()
      if (!k) continue
      if (row.value === '') continue
      next[k] = row.value
    }
    return next
  }, [headerDraftRows, headers])

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
    for (const [k, v] of Object.entries(effectiveQueryParams)) {
      const nextK = applyVariablesForDisplay(k, variables)
      const nextV = applyVariablesForDisplay(v, variables)
      if (nextK && nextV !== '') usp.set(nextK, nextV)
    }
    const qs = usp.toString()
    if (!qs) return withPathParams
    return withPathParams + (withPathParams.includes('?') ? '&' : '?') + qs
  }, [baseUrl, effectiveQueryParams, pathParams, props.request.path, props.request.urlTemplate, variables, urlTemplateOverride])

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
    const nextHeaders = {
      ...(props.environment?.headers ?? {}),
      ...(props.request.headers ?? {}),
      ...(draft?.headers ?? {}),
    }

    const hasQueryParamsSpec = props.request.params.some(p => p.in === 'query')
    const hasQueryParamsStore = Object.keys(nextQueryParams).length > 0
    const shouldSeedQueryDraft = !hasQueryParamsSpec && !hasQueryParamsStore

    const hasHeadersSpec = props.request.params.some(p => p.in === 'header' && p.name.toLowerCase() !== 'authorization')
    const hasHeadersStore = Object.keys(nextHeaders).some(k => k.toLowerCase() !== 'authorization')
    const shouldSeedHeaderDraft = !hasHeadersSpec && !hasHeadersStore

    setPathParams(nextPathParams)
    setQueryParams(nextQueryParams)
    setQueryDraftRows(shouldSeedQueryDraft ? [{ id: uid('qrow'), name: '', value: '' }] : [])
    setQueryParamKeyOverrides(draft?.queryParamKeyOverrides ?? {})
    setDisabledQueryParamNames(draft?.disabledQueryParamNames ?? {})
    setHeaders(nextHeaders)
    setHeaderDraftRows(shouldSeedHeaderDraft ? [{ id: uid('hrow'), name: '', value: '' }] : [])
    setBaseUrlKey(draft?.baseUrlKey || props.environment?.baseUrlKey || 'baseUrl')
    setBodyText(draft?.bodyText ?? requestDefaultBodyText())
    setUrlTemplateOverride(draft?.urlTemplateOverride ?? '')
    setIsEditingUrl(false)
    setUrlDraftText('')
    setBodyFile(null)
    setFileFieldName(draft?.fileFieldName || 'file')
    setShowBaseUrlPicker(false)
  }, [props.environment, props.request.id])

  const applyDraftToken = props.applyDraft?.token ?? null
  useEffect(() => {
    if (!applyDraftToken || !props.applyDraft) return
    const draft = props.applyDraft.draft

    const nextPathParams = draft?.pathParams ?? {}
    const nextQueryParams = draft?.queryParams ?? defaultQueryParamsFromSpec(props.request.params)
    const nextHeaders = {
      ...(props.environment?.headers ?? {}),
      ...(props.request.headers ?? {}),
      ...(draft?.headers ?? {}),
    }

    const hasQueryParamsSpec = props.request.params.some(p => p.in === 'query')
    const hasQueryParamsStore = Object.keys(nextQueryParams).length > 0
    const shouldSeedQueryDraft = !hasQueryParamsSpec && !hasQueryParamsStore

    const hasHeadersSpec = props.request.params.some(p => p.in === 'header' && p.name.toLowerCase() !== 'authorization')
    const hasHeadersStore = Object.keys(nextHeaders).some(k => k.toLowerCase() !== 'authorization')
    const shouldSeedHeaderDraft = !hasHeadersSpec && !hasHeadersStore

    setPathParams(nextPathParams)
    setQueryParams(nextQueryParams)
    setQueryDraftRows(shouldSeedQueryDraft ? [{ id: uid('qrow'), name: '', value: '' }] : [])
    setQueryParamKeyOverrides(draft?.queryParamKeyOverrides ?? {})
    setDisabledQueryParamNames(draft?.disabledQueryParamNames ?? {})
    setHeaders(nextHeaders)
    setHeaderDraftRows(shouldSeedHeaderDraft ? [{ id: uid('hrow'), name: '', value: '' }] : [])
    setBaseUrlKey(draft?.baseUrlKey || props.environment?.baseUrlKey || 'baseUrl')
    setBodyText(draft?.bodyText ?? requestDefaultBodyText())
    setUrlTemplateOverride(draft?.urlTemplateOverride ?? '')
    setIsEditingUrl(false)
    setUrlDraftText('')
    setBodyFile(null)
    setFileFieldName(draft?.fileFieldName || 'file')
    setShowBaseUrlPicker(false)

    saveDraft(props.request.id, {
      pathParams: draft?.pathParams ?? {},
      queryParams: draft?.queryParams ?? defaultQueryParamsFromSpec(props.request.params),
      queryParamKeyOverrides: draft?.queryParamKeyOverrides ?? {},
      disabledQueryParamNames: draft?.disabledQueryParamNames ?? {},
      headers: draft?.headers ?? {},
      bodyText: draft?.bodyText ?? requestDefaultBodyText(),
      fileFieldName: draft?.fileFieldName || 'file',
      baseUrlKey: draft?.baseUrlKey || props.environment?.baseUrlKey || 'baseUrl',
      urlTemplateOverride: draft?.urlTemplateOverride ?? '',
    })
  }, [applyDraftToken, props.applyDraft, props.environment, props.request.headers, props.request.id, props.request.params])

  useEffect(() => {
    if (!props.request.id) return
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current)
    draftSaveTimerRef.current = window.setTimeout(() => {
      saveDraft(props.request.id, {
        pathParams,
        queryParams,
        queryParamKeyOverrides,
        disabledQueryParamNames,
        headers,
        bodyText,
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
    fileFieldName,
    headers,
    pathParams,
    props.request.id,
    queryParams,
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

  const headerParams = useMemo(() => normalizeHeaderParams(grouped.header, headers), [grouped.header, headers])
  const headerSpecNames = useMemo(() => new Set(grouped.header.map(h => h.name)), [grouped.header])
  const visibleHeaderParams = useMemo(
    () => headerParams.filter(h => h.name.toLowerCase() !== 'authorization'),
    [headerParams],
  )

  const effectiveContentType = useMemo(() => {
    return (effectiveHeaders['Content-Type'] || effectiveHeaders['content-type'] || props.request.body?.contentType || '').trim()
  }, [effectiveHeaders, props.request.body?.contentType])
  const isMultipartForm = effectiveContentType.toLowerCase().includes('multipart/form-data')
  const supportsFile = props.request.method !== 'GET' && props.request.method !== 'HEAD' && (
    isMultipartForm || effectiveContentType.toLowerCase().includes('application/octet-stream')
  )

  function addHeaderDraftRow() {
    setHeaderDraftRows(prev => [...prev, { id: uid('hrow'), name: '', value: '' }])
  }

  function addQueryDraftRow() {
    setQueryDraftRows(prev => [...prev, { id: uid('qrow'), name: '', value: '' }])
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
      const hasDraftHeadersToCommit = headerDraftRows.some(r => r.name.trim() && r.value !== '')
      const effectiveHeadersForSend = hasDraftHeadersToCommit ? effectiveHeaders : headers
      const hasDraftQueryToCommit = queryDraftRows.some(r => r.name.trim() && r.value !== '')
      const effectiveQueryParamsForSend = hasDraftQueryToCommit ? effectiveQueryParams : queryParams
      const effectiveDisabledQueryParamNamesForSend = hasDraftQueryToCommit
        ? (() => {
            let changed = false
            const next = { ...disabledQueryParamNames }
            for (const row of queryDraftRows) {
              const key = row.name.trim()
              if (!key) continue
              if (!querySpecNames.has(key)) continue
              if (key in next) {
                delete next[key]
                changed = true
              }
            }
            return changed ? next : disabledQueryParamNames
          })()
        : disabledQueryParamNames

      if (hasDraftHeadersToCommit) {
        setHeaders(effectiveHeadersForSend)
        setHeaderDraftRows(prev => prev.filter(r => !(r.name.trim() && r.value !== '')))
      }

      if (hasDraftQueryToCommit) {
        setQueryParams(effectiveQueryParamsForSend)
        setQueryDraftRows(prev => prev.filter(r => !(r.name.trim() && r.value !== '')))
        setDisabledQueryParamNames(effectiveDisabledQueryParamNamesForSend)
      }

      props.onBeforeSend?.(props.request.id, {
        id: uid('hist'),
        createdAt: Date.now(),
        method: props.request.method,
        url: displayUrl,
        draft: {
          pathParams,
          queryParams: effectiveQueryParamsForSend,
          queryParamKeyOverrides,
          disabledQueryParamNames: effectiveDisabledQueryParamNamesForSend,
          headers: effectiveHeadersForSend,
          bodyText,
          fileFieldName,
          baseUrlKey,
          urlTemplateOverride,
        },
      })

      const formFields = supportsFile && effectiveContentType.toLowerCase().includes('multipart/form-data')
        ? parseFormFieldsFromBodyText(bodyText)
        : undefined
      const result = await runRequest({
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
        <button onClick={send} disabled={isSending || !canSend}>
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
            <input
              ref={urlInputRef}
              className="mono"
              value={urlDraftText}
              onChange={e => setUrlDraftText(e.target.value)}
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

      <details className="accordion">
        <summary>Authorization</summary>
        <div className="section">
          <div className="formRow">
            <div className="formLabel mono">Authorization</div>
            <input
              className="mono"
              value={headers.Authorization ?? ''}
              onChange={e => {
                const v = e.target.value
                setHeaders(prev => {
                  if (v === '') {
                    const { Authorization: _removed, ...rest } = prev
                    return rest
                  }
                  return { ...prev, Authorization: v }
                })
              }}
              placeholder="Bearer …"
            />
          </div>

        </div>
      </details>

      <details className="accordion" open>
        <summary>
          <span>Headers</span>
          <span style={{ marginLeft: 'auto' }} />
          <button
            type="button"
            className="iconBtn addRowBtn"
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              addHeaderDraftRow()
            }}
            aria-label="Add header"
            title="Add header"
            style={{ width: 28, height: 28 }}
          >
            <span className="addRowGlyph">+</span>
          </button>
        </summary>

        <div className="section">
          {visibleHeaderParams.map(h => {
            const isSpec = headerSpecNames.has(h.name)
            const value = headers[h.name] ?? ''
            return (
              <HeaderRow
                key={h.name}
                name={h.name}
                value={value}
                readOnlyName={isSpec}
                onChangeValue={nextValue => setHeaders(prev => ({ ...prev, [h.name]: nextValue }))}
                onRename={
                  isSpec
                    ? undefined
                    : nextName => setHeaders(prev => {
                        const nextKey = nextName.trim()
                        if (nextKey === h.name) return prev
                        if (!nextKey) {
                          setHeaderDraftRows(draftPrev => [...draftPrev, { id: uid('hrow'), name: '', value }])
                          const { [h.name]: _removed, ...rest } = prev
                          return rest
                        }
                        if (Object.prototype.hasOwnProperty.call(prev, nextKey)) return prev
                        const { [h.name]: oldValue, ...rest } = prev
                        return { ...rest, [nextKey]: oldValue ?? '' }
                      })
                }
                onDelete={
                  isSpec
                    ? undefined
                    : () => setHeaders(prev => {
                        const { [h.name]: _removed, ...rest } = prev
                        return rest
                      })
                }
              />
            )
          })}

          {headerDraftRows.map(row => (
            <HeaderDraftRow
              key={row.id}
              name={row.name}
              value={row.value}
              onChangeName={nextName => setHeaderDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, name: nextName } : r)))}
              onChangeValue={nextValue => setHeaderDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, value: nextValue } : r)))}
              onDelete={() => setHeaderDraftRows(prev => prev.filter(r => r.id !== row.id))}
            />
          ))}

        </div>
      </details>

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
              <ParamRow key={p.name} param={p} store={pathParams} setStore={setPathParams} />
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
            const hint =
              typeof p.example === 'string' || typeof p.example === 'number'
                ? String(p.example)
                : p.schemaType || ''

            return (
              <QueryRow
                key={rawName}
                name={effectiveName}
                value={value}
                hint={isSpec ? hint : undefined}
                required={isSpec ? p.required : false}
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
                        return
                      }
                      setQueryParams(prev => renameStoreKey(prev, effectiveName, trimmed))
                      setQueryParamKeyOverrides(prev => {
                        const next = { ...prev }
                        if (trimmed === rawName) delete next[rawName]
                        else next[rawName] = trimmed
                        return next
                      })
                      return
                    }

                    if (!trimmed) {
                      setQueryDraftRows(prev => [...prev, { id: uid('qrow'), name: '', value }])
                      setQueryParams(prev => {
                        if (!(effectiveName in prev)) return prev
                        const next = { ...prev }
                        delete next[effectiveName]
                        return next
                      })
                      return
                    }

                    setQueryParams(prev => renameStoreKey(prev, effectiveName, trimmed))
                  }
                }
                onDelete={() => {
                  setQueryParams(prev => {
                    if (!(effectiveName in prev) && !(rawName in prev)) return prev
                    const next = { ...prev }
                    delete next[effectiveName]
                    if (rawName !== effectiveName) delete next[rawName]
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
              name={row.name}
              value={row.value}
              onChangeName={nextName => setQueryDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, name: nextName } : r)))}
              onChangeValue={nextValue => setQueryDraftRows(prev => prev.map(r => (r.id === row.id ? { ...r, value: nextValue } : r)))}
              onDelete={() => setQueryDraftRows(prev => prev.filter(r => r.id !== row.id))}
            />
          ))}
        </div>
      </details>

      {props.request.body && (
        <details className="accordion" open>
          <summary>
            <span>Body</span>
            <span style={{ marginLeft: 'auto' }} />
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
          <textarea
            className="mono editorTextarea"
            value={bodyText}
            onChange={e => setBodyText(e.target.value)}
            rows={12}
          />
        </details>
      )}
    </div>
  )
}
