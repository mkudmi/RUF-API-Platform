import { useMemo, useState } from 'react'
import { safeJsonParse } from '../../shared/utils/http'
import type { RunResult } from './runRequest'
import { evaluateJsonSearch, JsonPathSearch, type JsonValue } from './JsonPathSearch'

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

  if (!props.result) return <div className="small">Run a request to see the response.</div>

  const result = props.result
  const tab = props.tab
  const headersText = JSON.stringify(result.headers, null, 2)
  const copyPayload = tab === 'body' ? bodyView.text : headersText

  async function onCopy() {
    await copyText(copyPayload)
    setCopied(true)
    setTimeout(() => setCopied(false), 900)
  }

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
            <button
              className="iconBtn"
              onClick={onCopy}
              title="Copy body"
              aria-label="Copy body"
              style={{ position: 'absolute', top: 8, right: 24, zIndex: 2 }}
            >
              {copied ? 'OK' : <CopyIcon />}
            </button>
            <div style={{ overflow: 'auto', height: '100%', paddingRight: 48 }}>
              <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {bodyView.text}
              </pre>
            </div>
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
