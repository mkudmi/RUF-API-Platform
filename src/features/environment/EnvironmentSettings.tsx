import { useEffect, useMemo, useRef, useState } from 'react'
import type { Environment } from '../../shared/types/environment'

type HeaderRow = { key: string; value: string }

export function EnvironmentSettings(props: {
  open: boolean
  collectionName: string
  env: Environment
  onSave: (env: Environment) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const [baseUrl, setBaseUrl] = useState(props.env.baseUrl)
  const [headersRows, setHeadersRows] = useState<HeaderRow[]>(
    Object.entries(props.env.headers).map(([k, v]) => ({ key: k, value: v })),
  )
  const [error, setError] = useState<string | null>(null)

  const hasAnyHeader = useMemo(() => headersRows.some(r => r.key.trim() || r.value), [headersRows])

  function openDialog() {
    setError(null)
    setBaseUrl(props.env.baseUrl)
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

  function reset() {
    setBaseUrl('')
    setHeadersRows([])
    setError(null)
  }

  function save() {
    setError(null)
    try {
      const headers: Record<string, string> = {}
      for (const row of headersRows) {
        const key = row.key.trim()
        if (!key) continue
        headers[key] = row.value ?? ''
      }
      props.onSave({
        baseUrl: baseUrl.trim(),
        headers,
      })
      close()
    } catch (e: any) {
      setError(e?.message || 'Invalid environment settings.')
    }
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
    <>
      <dialog
        ref={dialogRef}
        className="modal"
        onClose={() => props.onClose()}
      >
        <div className="modalHeader">
          <b>Окружение: {props.collectionName}</b>
          <button onClick={close}>Закрыть</button>
        </div>

        <div style={{display:'grid', gap:10}}>
          <div style={{display:'grid', gridTemplateColumns:'200px 1fr', gap:10, alignItems:'center'}}>
            <div className="small">Base URL</div>
            <input
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com"
            />
          </div>

          <div>
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom: 6}}>
              <div className="small">Headers</div>
              <button onClick={addHeaderRow}>+ Header</button>
            </div>

            {!hasAnyHeader && (
              <div className="small" style={{marginBottom: 8}}>
                Нет заголовков. Нажми <span className="mono">+ Header</span>, чтобы добавить.
              </div>
            )}

            <div style={{display:'grid', gap:8}}>
              {headersRows.map((row, i) => (
                <div key={i} style={{display:'grid', gridTemplateColumns:'220px 1fr auto', gap:10}}>
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
                    placeholder="Bearer ..."
                  />
                  <button onClick={() => deleteHeaderRow(i)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {error && <div className="small" style={{color:'#ff9a9a', marginTop: 8}}>{error}</div>}

        <div className="modalActions">
          <button onClick={reset}>Сбросить</button>
          <button onClick={save}>Сохранить</button>
        </div>
      </dialog>
    </>
  )
}
