import { useEffect, useMemo, useRef, useState } from 'react'
import type { Environment } from '../../shared/types/environment'
import { CloseIcon } from '../../shared/icons'

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

  function ensureTrailingEmptyRow<T extends { key: string; value: string }>(rows: T[]) {
    if (rows.length === 0) return [{ key: '', value: '' } as T]
    const last = rows[rows.length - 1]
    if (last.key.trim() || last.value) return [...rows, { key: '', value: '' } as T]
    return rows
  }

  const [baseUrlRow, setBaseUrlRow] = useState<VariableRow>({
    key: props.env.baseUrlKey,
    value: props.env.variables[props.env.baseUrlKey] ?? '',
  })
  const [variablesRows, setVariablesRows] = useState<VariableRow[]>(
    ensureTrailingEmptyRow(
      Object.entries(props.env.variables)
        .filter(([k]) => k !== props.env.baseUrlKey && k !== 'scheme')
        .map(([k, v]) => ({ key: k, value: v })),
    ),
  )

  const [headersRows, setHeadersRows] = useState<HeaderRow[]>(
    ensureTrailingEmptyRow(Object.entries(props.env.headers).map(([k, v]) => ({ key: k, value: v }))),
  )

  const [error, setError] = useState<string | null>(null)

  const hasAnyHeader = useMemo(() => headersRows.some(r => r.key.trim() || r.value), [headersRows])
  const hasAnyVariable = useMemo(() => {
    if (baseUrlRow.key.trim() || baseUrlRow.value) return true
    return variablesRows.some(r => r.key.trim() || r.value)
  }, [baseUrlRow.key, baseUrlRow.value, variablesRows])

  function openDialog() {
    setError(null)
    setBaseUrlRow({
      key: props.env.baseUrlKey,
      value: props.env.variables[props.env.baseUrlKey] ?? '',
    })
    setVariablesRows(
      ensureTrailingEmptyRow(
        Object.entries(props.env.variables)
          .filter(([k]) => k !== props.env.baseUrlKey && k !== 'scheme')
          .map(([k, v]) => ({ key: k, value: v })),
      ),
    )
    setHeadersRows(
      ensureTrailingEmptyRow(Object.entries(props.env.headers).map(([k, v]) => ({ key: k, value: v }))),
    )
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
      const normalizedBaseUrlKey = normalizeVarName(baseUrlRow.key)
      if (!normalizedBaseUrlKey) {
        setError('Ключ переменной Base URL обязателен.')
        return
      }

      const baseUrlValue = baseUrlRow.value.trim()
      const scheme =
        baseUrlValue.toLowerCase().startsWith('https://')
          ? 'https'
          : baseUrlValue.toLowerCase().startsWith('http://')
            ? 'http'
            : String(props.env.variables.scheme || 'http').toLowerCase() === 'https'
              ? 'https'
              : 'http'

      const variables: Record<string, string> = {
        scheme,
        [normalizedBaseUrlKey]: baseUrlValue,
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
      setError(e?.message || 'Некорректные настройки окружения.')
    }
  }

  function clearBaseUrlValue() {
    setBaseUrlRow(prev => ({ ...prev, value: '' }))
  }

  function updateVariableRow(i: number, next: VariableRow) {
    setVariablesRows(prev => prev.map((r, idx) => (idx === i ? next : r)))
  }

  function deleteVariableRow(i: number) {
    setVariablesRows(prev => ensureTrailingEmptyRow(prev.filter((_r, idx) => idx !== i)))
  }

  function updateHeaderRow(i: number, next: HeaderRow) {
    setHeadersRows(prev => prev.map((r, idx) => (idx === i ? next : r)))
  }

  function deleteHeaderRow(i: number) {
    setHeadersRows(prev => ensureTrailingEmptyRow(prev.filter((_r, idx) => idx !== i)))
  }

  function addNextVariableRowIfPossible(i: number) {
    setVariablesRows(prev => {
      const row = prev[i]
      const isLast = i === prev.length - 1
      if (!row || !isLast) return prev
      if (!row.key.trim() && !row.value) return prev
      return [...prev, { key: '', value: '' }]
    })
  }

  function addNextHeaderRowIfPossible(i: number) {
    setHeadersRows(prev => {
      const row = prev[i]
      const isLast = i === prev.length - 1
      if (!row || !isLast) return prev
      if (!row.key.trim() && !row.value) return prev
      return [...prev, { key: '', value: '' }]
    })
  }

  return (
    <dialog ref={dialogRef} className="modal" onClose={() => props.onClose()}>
      <div className="modalHeader">
        <b>Окружение: {props.collectionName}</b>
        <button className="iconBtn" onClick={close} aria-label="Close" title="Close">
          <CloseIcon size={18} />
        </button>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
            <div className="small">Variables</div>
          </div>

          {!hasAnyVariable && (
            <div className="small" style={{ marginBottom: 8 }}>
              Можно использовать переменные как <span className="mono">{'{{var}}'}</span> в URL, headers и body.
            </div>
          )}

          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 10 }}>
              <input
                className="mono"
                value={baseUrlRow.key}
                onChange={e => setBaseUrlRow(prev => ({ ...prev, key: e.target.value }))}
                placeholder="key"
              />
              <input
                className="mono"
                value={baseUrlRow.value}
                onChange={e => setBaseUrlRow(prev => ({ ...prev, value: e.target.value }))}
                placeholder="value"
              />
              <button
                className="headerDeleteBtn"
                onClick={clearBaseUrlValue}
                aria-label="Clear variable value"
                title="Clear variable value"
              >
                <CloseIcon size={18} />
              </button>
            </div>
            {variablesRows.map((row, i) => {
              const isLast = i === variablesRows.length - 1
              const canAdd = !!(row.key.trim() || row.value)
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 10 }}>
                  <input
                    className="mono"
                    value={row.key}
                    onChange={e => updateVariableRow(i, { ...row, key: e.target.value })}
                    placeholder="Key"
                  />
                  <input
                    className="mono"
                    value={row.value}
                    onChange={e => updateVariableRow(i, { ...row, value: e.target.value })}
                    placeholder="Value"
                  />
                  {isLast ? (
                    <button
                      className="headerDeleteBtn addRowBtn"
                      onClick={() => addNextVariableRowIfPossible(i)}
                      disabled={!canAdd}
                      aria-label="Add variable"
                      title={canAdd ? 'Add' : 'Fill key/value to add'}
                    >
                      <span className="addRowGlyph">+</span>
                    </button>
                  ) : (
                    <button
                      className="headerDeleteBtn"
                      onClick={() => deleteVariableRow(i)}
                      aria-label="Delete variable"
                      title="Delete"
                    >
                      <CloseIcon size={18} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
            <div className="small">Headers</div>
          </div>

          {!hasAnyHeader ? null : null}

          <div style={{ display: 'grid', gap: 8 }}>
            {headersRows.map((row, i) => {
              const isLast = i === headersRows.length - 1
              const canAdd = !!(row.key.trim() || row.value)
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 10 }}>
                  <input
                    className="mono"
                    value={row.key}
                    onChange={e => updateHeaderRow(i, { ...row, key: e.target.value })}
                    placeholder="Key"
                  />
                  <input
                    className="mono"
                    value={row.value}
                    onChange={e => updateHeaderRow(i, { ...row, value: e.target.value })}
                    placeholder="Value"
                  />
                  {isLast ? (
                    <button
                      className="headerDeleteBtn addRowBtn"
                      onClick={() => addNextHeaderRowIfPossible(i)}
                      disabled={!canAdd}
                      aria-label="Add header"
                      title={canAdd ? 'Add' : 'Fill key/value to add'}
                    >
                      <span className="addRowGlyph">+</span>
                    </button>
                  ) : (
                    <button
                      className="headerDeleteBtn"
                      onClick={() => deleteHeaderRow(i)}
                      aria-label="Delete header"
                      title="Delete"
                    >
                      <CloseIcon size={18} />
                    </button>
                  )}
                </div>
              )
            })}
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
