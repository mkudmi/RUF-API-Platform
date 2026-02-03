import { useMemo, useRef, useState } from 'react'
import { CloseIcon, CopyIcon } from '../../../shared/icons'
import { copyText } from '../../../shared/utils/clipboard'

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

export function JsonPathSearch(props: {
  query: string
  onQueryChange: (query: string) => void
  matchesCount: number | null
  error: string | null
  disabled?: boolean
}) {
  const query = props.query
  const disabled = !!props.disabled
  const [copyError, setCopyError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const helpDialogRef = useRef<HTMLDialogElement | null>(null)

  async function onCopy(label: string, text: string) {
    try {
      setCopyError(null)
      await copyText(text)
      setCopied(label)
      setTimeout(() => setCopied(null), 800)
    } catch (e: unknown) {
      setCopyError(errorMessage(e) || 'Failed to copy to clipboard.')
    }
  }

  const q = query.trim()
  const computed = useMemo(() => {
    const error = props.error || copyError
    const matchesCount = typeof props.matchesCount === 'number' ? props.matchesCount : null
    return { error, matchesCount }
  }, [copyError, props.error, props.matchesCount])

  return (
    <div className="accordion">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div className="sectionTitle">Search</div>
        <button
          className="iconBtn"
          onClick={() => helpDialogRef.current?.showModal()}
          title="Help"
          aria-label="Search help"
          style={{ width: 28, height: 28 }}
        >
          i
        </button>
      </div>

      <div
        className="jsonSearchQueryRow"
        style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, marginTop: 8 }}
      >
        <input
          className="mono"
          value={query}
          onChange={e => props.onQueryChange(e.target.value)}
          disabled={disabled}
          placeholder="Examples: id = 5 | id = 24, 25 | name ~ Max | height >= 166 | $..id"
        />
        <button
          type="button"
          className="iconBtn"
          onClick={() => onCopy('query', q)}
          disabled={!q}
          title="Copy query"
          aria-label="Copy query"
        >
          {copied === 'query' ? 'OK' : <CopyIcon />}
        </button>
        <button
          type="button"
          className="iconBtn"
          onClick={() => props.onQueryChange('')}
          disabled={!q}
          title="Clear"
          aria-label="Clear"
        >
          <CloseIcon />
        </button>
      </div>

      {computed.error && (
        <div className="small" style={{ color: '#ff9a9a', marginTop: 8 }}>
          {computed.error}
        </div>
      )}

      {q && !computed.error && computed.matchesCount !== null && (
        <div className="small" style={{ marginTop: 8 }}>
          Matches: <span className="mono">{computed.matchesCount}</span>
        </div>
      )}
    </div>
  )
}
