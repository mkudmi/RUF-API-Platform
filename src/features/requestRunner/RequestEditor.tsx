import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { Collection, RequestItem, RequestParam } from '../../shared/types/collection'
import type { Environment } from '../../shared/types/environment'
import { computeEffectiveBaseUrl, joinUrlParts } from '../../shared/utils/url'
import { runRequest, type RunResult } from './runRequest'

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

export function RequestEditor(props: {
  environment?: Environment
  collection: Collection
  request: RequestItem
  onResult: (r: RunResult) => void
}) {
  const baseUrl = computeEffectiveBaseUrl(props.environment?.baseUrl, props.collection.baseUrl)

  const displayUrl = useMemo(() => {
    if (baseUrl) return joinUrlParts(baseUrl, props.request.path)
    if (props.request.urlTemplate.includes('{{baseUrl}}')) return props.request.urlTemplate
    return props.request.urlTemplate
  }, [baseUrl, props.request.path, props.request.urlTemplate])

  const [pathParams, setPathParams] = useState<Record<string, string>>({})
  const [queryParams, setQueryParams] = useState<Record<string, string>>({})
  const [headers, setHeaders] = useState<Record<string, string>>(() => ({ ...(props.environment?.headers ?? {}) }))
  const [newHeaderName, setNewHeaderName] = useState('')
  const [newHeaderValue, setNewHeaderValue] = useState('')

  const [bodyText, setBodyText] = useState(() => {
    const b = props.request.body?.example
    if (b === undefined) return ''
    if (typeof b === 'string') return b
    return JSON.stringify(b, null, 2)
  })
  const [sending, setSending] = useState(false)

  useEffect(() => {
    setHeaders({ ...(props.environment?.headers ?? {}) })
    setNewHeaderName('')
    setNewHeaderValue('')
  }, [props.environment])

  const grouped = useMemo(() => {
    const p = props.request.params
    return {
      path: p.filter(x => x.in === 'path'),
      query: p.filter(x => x.in === 'query'),
      header: p.filter(x => x.in === 'header'),
    }
  }, [props.request.params])

  const headerParams = useMemo(() => normalizeHeaderParams(grouped.header, headers), [grouped.header, headers])

  function addHeader() {
    const name = newHeaderName.trim()
    if (!name) return
    setHeaders(prev => ({ ...prev, [name]: newHeaderValue }))
    setNewHeaderName('')
    setNewHeaderValue('')
  }

  async function send() {
    setSending(true)
    try {
      const result = await runRequest({
        request: props.request,
        baseUrl,
        pathParams,
        queryParams,
        headers,
        bodyText,
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

      <details className="accordion" open>
        <summary>Headers</summary>

        <div className="section">
          {headerParams.length ? (
            headerParams.map(h => <ParamRow key={h.name} param={h} store={headers} setStore={setHeaders} />)
          ) : (
            <div className="small">Нет заголовков.</div>
          )}

          <div className="formRow">
            <div className="formLabel mono">+</div>
            <div className="headerAdd">
              <input
                className="mono"
                value={newHeaderName}
                onChange={e => setNewHeaderName(e.target.value)}
                placeholder="Header name"
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

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => setHeaders(prev => ({ ...prev, Authorization: prev.Authorization ?? 'Bearer ' }))}>
              + Authorization
            </button>
            <button onClick={() => setHeaders({})}>Clear headers</button>
          </div>
        </div>
      </details>

      <details className="accordion" open>
        <summary>Params</summary>
        {grouped.path.length === 0 && grouped.query.length === 0 && <div className="small">Нет параметров.</div>}

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
          <div className="small" style={{ marginBottom: 8 }}>
            Content-Type: <span className="badge mono">{props.request.body.contentType}</span>
          </div>
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
