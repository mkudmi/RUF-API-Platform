import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { safeJsonParse } from '../../shared/utils/http'
import { generateJsonSchema } from '../../shared/utils/jsonSchema'
import type { RunResult } from './runRequest'
import { evaluateJsonSearch, JsonPathSearch, type JsonValue } from './JsonPathSearch'

type FileSystemWritableFileStreamLike = {
  write: (data: string) => Promise<void>
  close: () => Promise<void>
}

type FileSystemFileHandleLike = {
  createWritable: () => Promise<FileSystemWritableFileStreamLike>
}

function CopyIcon(props: { size?: number }) {
  const size = props.size ?? 16
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M9 9h10v12H9V9Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function CloseIcon(props: { size?: number }) {
  const size = props.size ?? 16
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
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

function statusClass(status: number) {
  if (status >= 200 && status < 300) return 'status2xx'
  if (status >= 300 && status < 400) return 'status3xx'
  if (status >= 400 && status < 500) return 'status4xx'
  if (status >= 500 && status < 600) return 'status5xx'
  return 'statusOther'
}

export function ResponseViewer(props: {
  result: RunResult | null
  tab: 'body' | 'headers'
  onTabChange: (tab: 'body' | 'headers') => void
}) {
  const [bodyQuery, setBodyQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const [schemaMenuOpen, setSchemaMenuOpen] = useState(false)
  const [schemaCopyFeedback, setSchemaCopyFeedback] = useState(false)
  const [schemaFileBaseName, setSchemaFileBaseName] = useState('requestResponseSchema')
  const schemaMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const saveSchemaDialogRef = useRef<HTMLDialogElement | null>(null)
  const schemaFileNameInputRef = useRef<HTMLInputElement | null>(null)
  const schemaCloseTimerRef = useRef<number | null>(null)

  const parsed = useMemo(() => {
    if (!props.result) return null
    return safeJsonParse(props.result.bodyText)
  }, [props.result])

  const isJson = props.result ? parsed !== null : false

  const bodyView = useMemo(() => {
    if (!props.result) return { text: '', matchesCount: null as number | null, error: null as string | null }
    if (!isJson) return { text: props.result.bodyText, matchesCount: null as number | null, error: null as string | null }

    const q = bodyQuery.trim()
    if (!q) return { text: JSON.stringify(parsed, null, 2), matchesCount: null as number | null, error: null as string | null }

    const { matches, error } = evaluateJsonSearch(parsed as JsonValue, q)
    if (error) return { text: '', matchesCount: matches.length, error }
    if (!matches.length) return { text: '', matchesCount: 0, error: null as string | null }

    const out = Array.isArray(parsed) ? matches : (matches.length === 1 ? matches[0] : matches)
    return { text: JSON.stringify(out, null, 2), matchesCount: matches.length, error: null as string | null }
  }, [bodyQuery, isJson, parsed, props.result])

  const result = props.result
  const tab = props.tab
  const headersText = result ? JSON.stringify(result.headers, null, 2) : ''
  const copyPayload = tab === 'body' ? bodyView.text : headersText

  async function onCopy() {
    await copyText(copyPayload)
    setCopied(true)
    setTimeout(() => setCopied(false), 900)
  }

  const clearSchemaCloseTimer = useCallback(() => {
    if (schemaCloseTimerRef.current === null) return
    window.clearTimeout(schemaCloseTimerRef.current)
    schemaCloseTimerRef.current = null
  }, [])

  const closeSchemaMenu = useCallback(() => {
    clearSchemaCloseTimer()
    setSchemaCopyFeedback(false)
    setSchemaMenuOpen(false)
  }, [clearSchemaCloseTimer])

  useEffect(() => {
    if (!schemaMenuOpen) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null
      const wrap = schemaMenuWrapRef.current
      if (t && wrap && wrap.contains(t)) return
      closeSchemaMenu()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeSchemaMenu()
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeSchemaMenu, schemaMenuOpen])

  function getSchemaText() {
    if (!isJson) return null
    const schema = generateJsonSchema(parsed)
    return JSON.stringify(schema, null, 2)
  }

  async function copySchemaToClipboard() {
    const schemaText = getSchemaText()
    if (!schemaText) return
    await copyText(schemaText)
    setSchemaCopyFeedback(true)
    clearSchemaCloseTimer()
    schemaCloseTimerRef.current = window.setTimeout(() => {
      closeSchemaMenu()
    }, 900)
  }

  function openSaveSchemaDialog() {
    closeSchemaMenu()
    setSchemaFileBaseName('requestResponseSchema')
    saveSchemaDialogRef.current?.showModal()
    setTimeout(() => schemaFileNameInputRef.current?.focus(), 0)
  }

  function normalizeSchemaFileName(base: string) {
    const trimmed = base.trim() || 'requestResponseSchema'
    return trimmed.toLowerCase().endsWith('.json') ? trimmed : `${trimmed}.json`
  }

  async function saveSchemaWithName(baseName: string) {
    const schemaText = getSchemaText()
    if (!schemaText) return

    const fileName = normalizeSchemaFileName(baseName)

    try {
      const w = window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandleLike> }
      if (typeof w.showSaveFilePicker === 'function') {
        const handle = await w.showSaveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: 'JSON',
              accept: { 'application/json': ['.json'] },
            },
          ],
        })
        const writable = await handle.createWritable()
        await writable.write(schemaText)
        await writable.close()
      } else {
        const blob = new Blob([schemaText], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      if ((e as Error | null)?.name !== 'AbortError') throw e
    }
  }

  async function confirmSaveSchema() {
    await saveSchemaWithName(schemaFileBaseName)
    saveSchemaDialogRef.current?.close()
  }

  if (!result) return <div className="small">Run a request to see the response.</div>

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto auto 1fr', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className={`badge ${statusClass(result.status)}`}>HTTP {result.status}</span>
        <span className="small">{result.statusText}</span>
        <span className="small">Time {result.timeMs} ms</span>
      </div>

      <div className="tabs" style={{ marginTop: 10 }}>
        <button className={`tab ${tab === 'body' ? 'tabActive' : ''}`} onClick={() => props.onTabChange('body')}>
          Body
        </button>
        <button className={`tab ${tab === 'headers' ? 'tabActive' : ''}`} onClick={() => props.onTabChange('headers')}>
          Headers
        </button>
      </div>

      {tab === 'body' ? (
        <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', overflow: 'hidden' }}>
          <div style={{ marginTop: 10 }}>
            {isJson ? (
              <JsonPathSearch
                query={bodyQuery}
                onQueryChange={setBodyQuery}
                matchesCount={bodyView.matchesCount}
                error={bodyView.error}
              />
            ) : (
              <div className="small" style={{ opacity: 0.75 }}>
                Body is not valid JSON - search is disabled.
              </div>
            )}
          </div>
          <div style={{ position: 'relative', overflow: 'hidden', marginTop: 10, minHeight: 0 }}>
            <div style={{ position: 'absolute', top: 8, right: 24, zIndex: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
              {isJson ? (
                <div ref={schemaMenuOpen ? schemaMenuWrapRef : null} className="methodMenuWrap">
                  <button
                    type="button"
                    className="envBtn"
                    style={{ height: 32, padding: '0 10px', display: 'inline-flex', alignItems: 'center' }}
                    aria-haspopup="menu"
                    aria-expanded={schemaMenuOpen}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      clearSchemaCloseTimer()
                      setSchemaCopyFeedback(false)
                      setSchemaMenuOpen(v => !v)
                    }}
                    title="Generate JSON Schema"
                  >
                    Generate JSON Schema
                  </button>

                  {schemaMenuOpen ? (
                    <div
                      className="methodMenuPanel"
                      role="menu"
                      style={{ minWidth: '100%' }}
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
                        onClick={copySchemaToClipboard}
                        disabled={schemaCopyFeedback}
                      >
                        {schemaCopyFeedback ? 'Copied!' : 'Copy'}
                      </button>
                      <button type="button" className="methodMenuItem mono" role="menuitem" onClick={openSaveSchemaDialog}>
                        Save
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <button className="iconBtn" onClick={onCopy} title="Copy body" aria-label="Copy body">
                {copied ? 'OK' : <CopyIcon />}
              </button>
            </div>
            <div style={{ overflow: 'auto', height: '100%', paddingRight: isJson ? 260 : 48 }}>
              <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {bodyView.text}
              </pre>
            </div>

            <dialog ref={saveSchemaDialogRef} className="modal modalSmall" onClose={() => setSchemaFileBaseName('requestResponseSchema')}>
              <div className="modalHeader">
                <b>Save JSON Schema</b>
                <button className="iconBtn" onClick={() => saveSchemaDialogRef.current?.close()} aria-label="Close" title="Close">
                  <CloseIcon />
                </button>
              </div>

              <div className="small" style={{ marginBottom: 8 }}>
                File name
              </div>

              <input
                ref={schemaFileNameInputRef}
                className="mono"
                style={{ width: '100%' }}
                value={schemaFileBaseName}
                onChange={e => setSchemaFileBaseName(e.target.value)}
                placeholder="requestResponseSchema"
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmSaveSchema()
                }}
              />

              <div className="modalActions">
                <button type="button" onClick={confirmSaveSchema}>
                  Save
                </button>
              </div>
            </dialog>
          </div>
        </div>
      ) : (
        <div style={{ position: 'relative', overflow: 'hidden', marginTop: 10, minHeight: 0 }}>
          <button
            className="iconBtn"
            onClick={onCopy}
            title="Copy headers"
            aria-label="Copy headers"
            style={{ position: 'absolute', top: 8, right: 24, zIndex: 2 }}
          >
            {copied ? 'OK' : <CopyIcon />}
          </button>
          <div style={{ overflow: 'auto', height: '100%', paddingRight: 48 }}>
            <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
              {headersText}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
