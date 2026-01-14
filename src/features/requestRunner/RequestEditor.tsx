import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Collection, RequestItem, RequestParam } from '../../shared/types/collection'
import type { Environment } from '../../shared/types/environment'
import { computeEffectiveBaseUrl, joinUrlParts } from '../../shared/utils/url'
import { runRequest, type RunResult } from './runRequest'

const REQUEST_DRAFTS_KEY = 'ruf_request_drafts_v1'

type RequestDraft = {
  pathParams?: Record<string, string>
  queryParams?: Record<string, string>
  headers?: Record<string, string>
  bodyText?: string
  fileFieldName?: string
}

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

function applyPathParamsForDisplay(url: string, values: Record<string, string>) {
  return url.replaceAll(/\{([^}]+)\}/g, (_, key) => {
    const v = values[key]
    return v ? v : `{${key}}`
  })
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
        onChange={e => props.setStore(prev => ({ ...prev, [props.param.name]: e.target.value }))}
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
    if (!next || next === props.name) {
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
      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
        <input
          className="mono"
          style={{ flex: 1, minWidth: 0 }}
          value={props.value}
          onChange={e => props.onChangeValue(e.target.value)}
          placeholder="Value"
        />
        {props.onDelete ? (
          <button className="headerDeleteBtn" onClick={props.onDelete} aria-label={`Delete header ${props.name}`} title="Delete">
            ✕
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function RequestEditor(props: {
  environment?: Environment
  collection: Collection
  request: RequestItem
  onResult: (r: RunResult) => void
}) {
  const baseUrl = computeEffectiveBaseUrl(props.environment?.baseUrl, props.collection.baseUrl)
  const bodyFileInputRef = useRef<HTMLInputElement | null>(null)

  const [pathParams, setPathParams] = useState<Record<string, string>>({})
  const [queryParams, setQueryParams] = useState<Record<string, string>>({})
  const [headers, setHeaders] = useState<Record<string, string>>(() => ({
    ...(props.environment?.headers ?? {}),
    ...(props.request.headers ?? {}),
  }))
  const [newHeaderName, setNewHeaderName] = useState('')
  const [newHeaderValue, setNewHeaderValue] = useState('')
  const [newParamKey, setNewParamKey] = useState('')
  const [newParamValue, setNewParamValue] = useState('')
  const [bodyFile, setBodyFile] = useState<File | null>(null)
  const [fileFieldName, setFileFieldName] = useState('file')

  const displayUrl = useMemo(() => {
    const url = baseUrl
      ? joinUrlParts(baseUrl, props.request.path)
      : props.request.urlTemplate
    return applyPathParamsForDisplay(url, pathParams)
  }, [baseUrl, pathParams, props.request.path, props.request.urlTemplate])

  const [bodyText, setBodyText] = useState('')
  const [sending, setSending] = useState(false)
  const draftSaveTimerRef = useRef<number | null>(null)

  function requestDefaultBodyText() {
    const b = props.request.body?.example
    if (b === undefined) return ''
    if (typeof b === 'string') return b
    return JSON.stringify(b, null, 2)
  }

  useEffect(() => {
    const draft = loadDraft(props.request.id)
    setPathParams(draft?.pathParams ?? {})
    setQueryParams(draft?.queryParams ?? {})
    setHeaders({
      ...(props.environment?.headers ?? {}),
      ...(props.request.headers ?? {}),
      ...(draft?.headers ?? {}),
    })
    setBodyText(draft?.bodyText ?? requestDefaultBodyText())
    setNewHeaderName('')
    setNewHeaderValue('')
    setNewParamKey('')
    setNewParamValue('')
    setBodyFile(null)
    setFileFieldName(draft?.fileFieldName || 'file')
  }, [props.environment, props.request.id])

  useEffect(() => {
    if (!props.request.id) return
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current)
    draftSaveTimerRef.current = window.setTimeout(() => {
      saveDraft(props.request.id, {
        pathParams,
        queryParams,
        headers,
        bodyText,
        fileFieldName,
      })
    }, 200)
    return () => {
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current)
      draftSaveTimerRef.current = null
    }
  }, [bodyText, fileFieldName, headers, pathParams, props.request.id, queryParams])

  const grouped = useMemo(() => {
    const p = props.request.params
    return {
      path: p.filter(x => x.in === 'path'),
      query: p.filter(x => x.in === 'query'),
      header: p.filter(x => x.in === 'header'),
    }
  }, [props.request.params])

  const headerParams = useMemo(() => normalizeHeaderParams(grouped.header, headers), [grouped.header, headers])
  const headerSpecNames = useMemo(() => new Set(grouped.header.map(h => h.name)), [grouped.header])
  const visibleHeaderParams = useMemo(
    () => headerParams.filter(h => h.name.toLowerCase() !== 'authorization'),
    [headerParams],
  )

  const effectiveContentType = useMemo(() => {
    return (headers['Content-Type'] || headers['content-type'] || props.request.body?.contentType || '').trim()
  }, [headers, props.request.body?.contentType])
  const isMultipartForm = effectiveContentType.toLowerCase().includes('multipart/form-data')
  const supportsFile = props.request.method !== 'GET' && props.request.method !== 'HEAD' && (
    isMultipartForm || effectiveContentType.toLowerCase().includes('application/octet-stream')
  )

  function addHeader() {
    const name = newHeaderName.trim()
    if (!name) return
    setHeaders(prev => ({ ...prev, [name]: newHeaderValue }))
    setNewHeaderName('')
    setNewHeaderValue('')
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

  function addQueryParam() {
    const key = newParamKey.trim()
    if (!key) return
    setQueryParams(prev => ({ ...prev, [key]: newParamValue }))
    setNewParamKey('')
    setNewParamValue('')
  }

  async function send() {
    setSending(true)
    try {
      const formFields = supportsFile && effectiveContentType.toLowerCase().includes('multipart/form-data')
        ? parseFormFieldsFromBodyText(bodyText)
        : undefined
      const result = await runRequest({
        request: props.request,
        baseUrl,
        pathParams,
        queryParams,
        headers,
        bodyText,
        file: supportsFile ? bodyFile : undefined,
        fileFieldName: supportsFile ? fileFieldName : undefined,
        formFields,
      })
      props.onResult(result)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="editor">
      <div className="editorHeader">
        <div className="editorTitle">
          <span className="badge mono">{props.request.method}</span>
          <span style={{ fontWeight: 600 }}>{props.request.name}</span>
        </div>
        <button onClick={send} disabled={sending || !baseUrl}>
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>

      <div className="mono editorUrl" title={displayUrl}>
        {displayUrl}
      </div>

      {!baseUrl && (
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
        <summary>Headers</summary>

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
                        if (!nextKey || nextKey === h.name) return prev
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

          <div className="headerAdd">
            <input
              className="mono"
              value={newHeaderName}
              onChange={e => setNewHeaderName(e.target.value)}
              placeholder="Key"
            />
            <input
              className="mono"
              value={newHeaderValue}
              onChange={e => setNewHeaderValue(e.target.value)}
              placeholder="Value"
            />
            <button onClick={addHeader} disabled={!newHeaderName.trim()}>
              Add
            </button>
          </div>

        </div>
      </details>

      <details className="accordion" open>
        <summary>Params</summary>
        {grouped.path.length === 0 && grouped.query.length === 0 && (
          <div className="section">
            <div className="headerAdd">
              <input
                className="mono"
                value={newParamKey}
                onChange={e => setNewParamKey(e.target.value)}
                placeholder="Key"
              />
              <input
                className="mono"
                value={newParamValue}
                onChange={e => setNewParamValue(e.target.value)}
                placeholder="Value"
              />
              <button onClick={addQueryParam} disabled={!newParamKey.trim()}>
                Add
              </button>
            </div>
          </div>
        )}

        {grouped.path.length > 0 && (
          <div className="section">
            <div className="sectionTitle">Path</div>
            {grouped.path.map(p => (
              <ParamRow key={p.name} param={p} store={pathParams} setStore={setPathParams} />
            ))}
          </div>
        )}

        {grouped.query.length > 0 && (
          <div className="section">
            <div className="sectionTitle">Query</div>
            {grouped.query.map(p => (
              <ParamRow key={p.name} param={p} store={queryParams} setStore={setQueryParams} />
            ))}
          </div>
        )}
      </details>

      {props.request.body && (
        <details className="accordion" open>
          <summary>Body</summary>
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
