import { useMemo, useState } from 'react'
import { safeJsonParse } from '../../shared/utils/http'
import type { RunResult } from './runRequest'
import { evaluateJsonSearch, JsonPathSearch, type JsonValue } from './JsonPathSearch'

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

  if (!props.result) {
    return <div className="small">Run a request to see the response.</div>
  }

  const result = props.result
  const tab = props.tab

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
        <span className={`badge ${statusClass(result.status)}`}>HTTP {result.status}</span>
        <span className="small">{result.statusText}</span>
        <span className="small">Time {result.timeMs} ms</span>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'body' ? 'tabActive' : ''}`} onClick={() => props.onTabChange('body')}>
          Body
        </button>
        <button className={`tab ${tab === 'headers' ? 'tabActive' : ''}`} onClick={() => props.onTabChange('headers')}>
          Headers
        </button>
      </div>

      {tab === 'body' ? (
        <div style={{ display: 'grid', gap: 10 }}>
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
          <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
            {bodyView.text}
          </pre>
        </div>
      ) : (
        <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(result.headers, null, 2)}
        </pre>
      )}
    </div>
  )
}
