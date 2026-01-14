import { safeJsonParse } from '../../shared/utils/http'
import type { RunResult } from './runRequest'
import { useState } from 'react'

function statusClass(status: number) {
  if (status >= 200 && status < 300) return 'status2xx'
  if (status >= 300 && status < 400) return 'status3xx'
  if (status >= 400 && status < 500) return 'status4xx'
  if (status >= 500 && status < 600) return 'status5xx'
  return 'statusOther'
}

export function ResponseViewer(props: { result: RunResult | null }) {
  if (!props.result) {
    return <div className="small">Нет ответа — отправь запрос.</div>
  }

  const parsed = safeJsonParse(props.result.bodyText)
  const pretty = parsed ? JSON.stringify(parsed, null, 2) : props.result.bodyText
  const [tab, setTab] = useState<'body' | 'headers'>('body')

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
        <span className={`badge ${statusClass(props.result.status)}`}>HTTP {props.result.status}</span>
        <span className="small">{props.result.statusText}</span>
        <span className="small">⏱ {props.result.timeMs} ms</span>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'body' ? 'tabActive' : ''}`} onClick={() => setTab('body')}>
          Body
        </button>
        <button className={`tab ${tab === 'headers' ? 'tabActive' : ''}`} onClick={() => setTab('headers')}>
          Headers
        </button>
      </div>

      {tab === 'body' ? (
        <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
          {pretty}
        </pre>
      ) : (
        <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(props.result.headers, null, 2)}
        </pre>
      )}
    </div>
  )
}
