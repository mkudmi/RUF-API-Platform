import { useEffect, useMemo, useRef, useState } from 'react'
import type { Environment } from '../../shared/types/environment'

type HeaderRow = { key: string; value: string }
type VariableRow = { key: string; value: string }

function normalizeVarName(raw: string) {
  return raw.trim().replaceAll(/\s+/g, '')
}

export function EnvironmentSettings(props: {
  open: boolean
  collectionName: string
  env: Environment
  onSave: (env: Environment) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  const [baseUrlKey, setBaseUrlKey] = useState(props.env.baseUrlKey)
  const [baseUrlValue, setBaseUrlValue] = useState(props.env.variables[props.env.baseUrlKey] ?? '')
  const [scheme, setScheme] = useState<'http' | 'https'>('http')
  const [variablesRows, setVariablesRows] = useState<VariableRow[]>(
    Object.entries(props.env.variables)
      .filter(([k]) => k !== props.env.baseUrlKey && k !== 'scheme')
      .map(([k, v]) => ({ key: k, value: v })),
  )

  const [headersRows, setHeadersRows] = useState<HeaderRow[]>(
    Object.entries(props.env.headers).map(([k, v]) => ({ key: k, value: v })),
  )

  const [error, setError] = useState<string | null>(null)

  const hasAnyHeader = useMemo(() => headersRows.some(r => r.key.trim() || r.value), [headersRows])
  const hasAnyVariable = useMemo(() => variablesRows.some(r => r.key.trim() || r.value), [variablesRows])

  function openDialog() {
    setError(null)
    setBaseUrlKey(props.env.baseUrlKey)
    setBaseUrlValue(props.env.variables[props.env.baseUrlKey] ?? '')
    setScheme((props.env.variables.scheme || 'http').toLowerCase() === 'https' ? 'https' : 'http')
    setVariablesRows(
      Object.entries(props.env.variables)
        .filter(([k]) => k !== props.env.baseUrlKey && k !== 'scheme')
        .map(([k, v]) => ({ key: k, value: v })),
    )
    setHeadersRows(Object.entries(props.env.headers).map(([k, v]) => ({ key: k, value: v })))
    dialogRef.current?.showModal()
  }

  function close() {
    dialogRef.current?.close()
  }

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (props.open) {
      if (!el.open) openDialog()
    } else {
      if (el.open) el.close()
    }
  }, [props.open, props.env])

  function save() {
    setError(null)
    try {
      const normalizedBaseUrlKey = normalizeVarName(baseUrlKey)
      if (!normalizedBaseUrlKey) {
        setError('Base URL key is required.')
        return
      }

      const variables: Record<string, string> = {
        scheme,
        [normalizedBaseUrlKey]: baseUrlValue.trim(),
      }
      for (const row of variablesRows) {
        const key = normalizeVarName(row.key)
        if (!key) continue
        if (key === normalizedBaseUrlKey) continue
        if (key === 'scheme') continue
        variables[key] = row.value ?? ''
      }

      const headers: Record<string, string> = {}
      for (const row of headersRows) {
        const key = row.key.trim()
        if (!key) continue
        headers[key] = row.value ?? ''
      }

      props.onSave({
        baseUrlKey: normalizedBaseUrlKey,
        variables,
        headers,
      })
      close()
    } catch (e: any) {
      setError(e?.message || 'Invalid environment settings.')
    }
  }

  function addVariableRow() {
    setVariablesRows(prev => [...prev, { key: '', value: '' }])
  }

  function updateVariableRow(i: number, next: VariableRow) {
    setVariablesRows(prev => prev.map((r, idx) => (idx === i ? next : r)))
  }

  function deleteVariableRow(i: number) {
    setVariablesRows(prev => prev.filter((_r, idx) => idx !== i))
  }

  function addHeaderRow() {
    setHeadersRows(prev => [...prev, { key: '', value: '' }])
  }

  function updateHeaderRow(i: number, next: HeaderRow) {
    setHeadersRows(prev => prev.map((r, idx) => (idx === i ? next : r)))
  }

  function deleteHeaderRow(i: number) {
    setHeadersRows(prev => prev.filter((_r, idx) => idx !== i))
  }

  return (
    <dialog ref={dialogRef} className="modal" onClose={() => props.onClose()}>
      <div className="modalHeader">
        <b>Окружение: {props.collectionName}</b>
        <button className="iconBtn" onClick={close} aria-label="Close">✕</button>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '200px 220px 1fr', gap: 10, alignItems: 'center' }}>
          <div className="small">Base URL</div>
          <input
            className="mono"
            value={baseUrlKey}
            onChange={e => setBaseUrlKey(e.target.value)}
            placeholder="baseUrl"
            title="Variable name"
          />
          <input
            value={baseUrlValue}
            onChange={e => setBaseUrlValue(e.target.value)}
            placeholder="https://api.example.com"
            title="Base URL value"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 10, alignItems: 'center' }}>
          <div className="small">Protocol</div>
          <select
            className="mono"
            value={scheme}
            onChange={e => setScheme((e.target.value === 'https' ? 'https' : 'http'))}
            title="Used when Base URL has no scheme"
          >
            <option value="http">http</option>
            <option value="https">https</option>
          </select>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
            <div className="small">Variables</div>
            <button onClick={addVariableRow}>+ Var</button>
          </div>

          {!hasAnyVariable && (
            <div className="small" style={{ marginBottom: 8 }}>
              Можно использовать переменные как <span className="mono">{'{{var}}'}</span> в URL, headers и body.
            </div>
          )}

          <div style={{ display: 'grid', gap: 8 }}>
            {variablesRows.map((row, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 10 }}>
                <input
                  className="mono"
                  value={row.key}
                  onChange={e => updateVariableRow(i, { ...row, key: e.target.value })}
                  placeholder="token"
                />
                <input
                  className="mono"
                  value={row.value}
                  onChange={e => updateVariableRow(i, { ...row, value: e.target.value })}
                  placeholder="..."
                />
                <button className="iconBtn" style={{ width: 32, height: 32 }} onClick={() => deleteVariableRow(i)} aria-label="Delete variable">✕</button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
            <div className="small">Headers</div>
            <button onClick={addHeaderRow}>+ Header</button>
          </div>

          {!hasAnyHeader && (
            <div className="small" style={{ marginBottom: 8 }}>
              Добавь заголовки (например, <span className="mono">Authorization</span>).
            </div>
          )}

          <div style={{ display: 'grid', gap: 8 }}>
            {headersRows.map((row, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 10 }}>
                <input
                  className="mono"
                  value={row.key}
                  onChange={e => updateHeaderRow(i, { ...row, key: e.target.value })}
                  placeholder="Authorization"
                />
                <input
                  className="mono"
                  value={row.value}
                  onChange={e => updateHeaderRow(i, { ...row, value: e.target.value })}
                  placeholder="Bearer {{token}}"
                />
                <button className="iconBtn" style={{ width: 32, height: 32 }} onClick={() => deleteHeaderRow(i)} aria-label="Delete header">✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="small" style={{ color: '#ff9a9a', marginTop: 8 }}>{error}</div>}

      <div className="modalActions">
        <button onClick={save}>Сохранить</button>
      </div>
    </dialog>
  )
}
