import { useEffect, useMemo, useRef, useState } from 'react'
import type { Environment } from '../../../shared/types/environment'
import { CloseIcon } from '../../../shared/icons'
import {
  buildDbConnectionString,
  getDbConnectionStringPreview,
  getDbFormStateFromEnv,
  hasDbConfigInEnv,
  isDbEnvKey,
  mergeDbIntoVariables,
  runDbConnectionTest,
} from '../utils/dbConnection'
import type { DbType, PgSslMode } from '../utils/dbConnection'

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
  const dbTypeMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const dbSslModeMenuWrapRef = useRef<HTMLDivElement | null>(null)

  function ensureTrailingEmptyRow<T extends { key: string; value: string }>(rows: T[]) {
    if (rows.length === 0) return [{ key: '', value: '' } as T]
    const last = rows[rows.length - 1]
    if (last.key.trim() || last.value) return [...rows, { key: '', value: '' } as T]
    return rows
  }

  function shouldHideVariableKeyFromVariablesList(key: string) {
    return isDbEnvKey(key)
  }

  const [baseUrlRow, setBaseUrlRow] = useState<VariableRow>({
    key: props.env.baseUrlKey,
    value: props.env.variables[props.env.baseUrlKey] ?? '',
  })
  const [variablesRows, setVariablesRows] = useState<VariableRow[]>(
    ensureTrailingEmptyRow(
      Object.entries(props.env.variables)
        .filter(([k]) => k !== props.env.baseUrlKey && k !== 'scheme' && !shouldHideVariableKeyFromVariablesList(k))
        .map(([k, v]) => ({ key: k, value: v })),
    ),
  )

  const [headersRows, setHeadersRows] = useState<HeaderRow[]>(
    ensureTrailingEmptyRow(Object.entries(props.env.headers).map(([k, v]) => ({ key: k, value: v }))),
  )

  const initialDb = useMemo(() => getDbFormStateFromEnv(props.env), [props.env])
  const [dbType, setDbType] = useState<DbType>(() => initialDb.type)
  const [dbSslMode, setDbSslMode] = useState<PgSslMode>(() => initialDb.sslmode)
  const [dbHost, setDbHost] = useState(() => initialDb.host)
  const [dbPort, setDbPort] = useState(() => initialDb.port)
  const [dbDatabase, setDbDatabase] = useState(() => initialDb.database)
  const [dbUsername, setDbUsername] = useState(() => initialDb.username)
  const [dbPassword, setDbPassword] = useState(() => initialDb.password)
  const [dbShowPassword, setDbShowPassword] = useState(false)
  const [dbTypeMenuOpen, setDbTypeMenuOpen] = useState(false)
  const [dbSslModeMenuOpen, setDbSslModeMenuOpen] = useState(false)
  const [dbAccordionOpen, setDbAccordionOpen] = useState(() => hasDbConfigInEnv(props.env))
  const [dbTestInFlight, setDbTestInFlight] = useState(false)
  const [dbTestError, setDbTestError] = useState<string | null>(null)
  const [dbTestLog, setDbTestLog] = useState<string | null>(null)
  const [dbTestOkMs, setDbTestOkMs] = useState<number | null>(null)
  const dbTestOkResetTimerRef = useRef<number | null>(null)

  const dbConnectionString = useMemo(
    () =>
      buildDbConnectionString({
        type: dbType,
        sslmode: dbSslMode,
        host: dbHost,
        port: dbPort,
        database: dbDatabase,
        username: dbUsername,
        password: dbPassword,
      }),
    [dbDatabase, dbHost, dbPassword, dbPort, dbSslMode, dbType, dbUsername],
  )

  const dbConnectionStringPreview = useMemo(() => {
    return getDbConnectionStringPreview(dbConnectionString, dbShowPassword)
  }, [dbConnectionString, dbShowPassword])

  const [error, setError] = useState<string | null>(null)

  const hasAnyHeader = useMemo(() => headersRows.some(r => r.key.trim() || r.value), [headersRows])
  const hasAnyVariable = useMemo(() => {
    if (baseUrlRow.key.trim() || baseUrlRow.value) return true
    return variablesRows.some(r => r.key.trim() || r.value)
  }, [baseUrlRow.key, baseUrlRow.value, variablesRows])

  function openDialog() {
    setError(null)
    setDbTestError(null)
    setDbTestLog(null)
    setDbTestOkMs(null)
    if (dbTestOkResetTimerRef.current) {
      window.clearTimeout(dbTestOkResetTimerRef.current)
      dbTestOkResetTimerRef.current = null
    }
    setDbTestInFlight(false)
    setBaseUrlRow({
      key: props.env.baseUrlKey,
      value: props.env.variables[props.env.baseUrlKey] ?? '',
    })
    setVariablesRows(
      ensureTrailingEmptyRow(
        Object.entries(props.env.variables)
          .filter(([k]) => k !== props.env.baseUrlKey && k !== 'scheme' && !shouldHideVariableKeyFromVariablesList(k))
          .map(([k, v]) => ({ key: k, value: v })),
      ),
    )
    setHeadersRows(
      ensureTrailingEmptyRow(Object.entries(props.env.headers).map(([k, v]) => ({ key: k, value: v }))),
    )
    const nextDb = getDbFormStateFromEnv(props.env)
    setDbType(nextDb.type)
    setDbSslMode(nextDb.sslmode)
    setDbHost(nextDb.host)
    setDbPort(nextDb.port)
    setDbDatabase(nextDb.database)
    setDbUsername(nextDb.username)
    setDbPassword(nextDb.password)
    setDbShowPassword(false)
    setDbAccordionOpen(hasDbConfigInEnv(props.env))
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

  useEffect(() => {
    if (!dbTypeMenuOpen) return

    function onPointerDown(e: PointerEvent) {
      const wrap = dbTypeMenuWrapRef.current
      const t = e.target as Node | null
      if (wrap && t && wrap.contains(t)) return
      setDbTypeMenuOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setDbTypeMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [dbTypeMenuOpen])

  useEffect(() => {
    if (!dbSslModeMenuOpen) return

    function onPointerDown(e: PointerEvent) {
      const wrap = dbSslModeMenuWrapRef.current
      const t = e.target as Node | null
      if (wrap && t && wrap.contains(t)) return
      setDbSslModeMenuOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setDbSslModeMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [dbSslModeMenuOpen])

  function setDbTypeAndMaybeDefaultPort(nextType: DbType) {
    setDbType(nextType)
    setDbSslModeMenuOpen(false)
    setDbPort(prev => {
      const raw = prev.trim()
      if (!raw) return nextType === 'mysql' ? '3306' : '5432'
      if (nextType === 'mysql' && raw === '5432') return '3306'
      if (nextType === 'postgres' && raw === '3306') return '5432'
      return prev
    })
  }

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

      let variables: Record<string, string> = {
        scheme,
        [normalizedBaseUrlKey]: baseUrlValue,
      }
      for (const row of variablesRows) {
        const key = normalizeVarName(row.key)
        if (!key) continue
        if (key === normalizedBaseUrlKey) continue
        if (key === 'scheme') continue
        if (shouldHideVariableKeyFromVariablesList(key)) continue
        variables[key] = row.value ?? ''
      }

      variables = mergeDbIntoVariables(variables, {
        type: dbType,
        sslmode: dbSslMode,
        host: dbHost,
        port: dbPort,
        database: dbDatabase,
        username: dbUsername,
        password: dbPassword,
      })

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

  async function testDbConnection() {
    setError(null)
    setDbTestError(null)
    setDbTestLog(null)
    setDbTestOkMs(null)
    if (dbTestOkResetTimerRef.current) {
      window.clearTimeout(dbTestOkResetTimerRef.current)
      dbTestOkResetTimerRef.current = null
    }

    const connectionString = dbConnectionString.trim()
    if (!connectionString) {
      setDbTestError('Connection failed')
      setDbTestLog('Fill host/port/database/user/password to build connection string.')
      return
    }

    setDbTestInFlight(true)
    try {
      const { ok, message, durationMs } = await runDbConnectionTest({ type: dbType.trim() || 'postgres', connectionString })
      if (ok) {
        setDbTestOkMs(durationMs)
        dbTestOkResetTimerRef.current = window.setTimeout(() => {
          setDbTestOkMs(null)
          dbTestOkResetTimerRef.current = null
        }, 2500)
      } else {
        setDbTestError('Connection failed')
        setDbTestLog(message)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error'
      setDbTestError('Connection failed')
      setDbTestLog(message)
    } finally {
      setDbTestInFlight(false)
    }
  }

  function clearDbFormKeepPort() {
    setDbHost('')
    setDbDatabase('')
    setDbUsername('')
    setDbPassword('')
    setDbSslMode('prefer')
    setDbShowPassword(false)

    setDbTestError(null)
    setDbTestLog(null)
    setDbTestOkMs(null)
    if (dbTestOkResetTimerRef.current) {
      window.clearTimeout(dbTestOkResetTimerRef.current)
      dbTestOkResetTimerRef.current = null
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
        <b>Enviroment: {props.collectionName}</b>
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

        <details
          className="accordion"
          style={{ marginTop: 10 }}
          open={dbAccordionOpen}
          onToggle={e => setDbAccordionOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>
            <span style={{ flex: 1 }}>Database</span>
            <button
              type="button"
              className="iconBtn"
              style={{ width: 28, height: 28, marginLeft: 'auto' }}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                clearDbFormKeepPort()
              }}
              aria-label="Clear database form"
              title="Clear"
            >
              <CloseIcon size={18} />
            </button>
          </summary>
          <div className="section">
            <div className="formRow">
              <div className="formLabel">Type</div>
              <div ref={dbTypeMenuOpen ? dbTypeMenuWrapRef : null} className="selectMenuWrap">
                <button
                  type="button"
                  className="selectMenuBtn"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    setDbTypeMenuOpen(v => !v)
                  }}
                  aria-haspopup="menu"
                  aria-expanded={dbTypeMenuOpen}
                  aria-label="Database type"
                  title="Database type"
                >
                  {dbType === 'mysql' ? 'MySQL' : 'PostgreSQL'}
                </button>

                {dbTypeMenuOpen ? (
                  <div
                    className="selectMenuPanel"
                    role="menu"
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
                      className={`selectMenuItem ${dbType === 'postgres' ? 'selectMenuItemActive' : ''}`}
                      role="menuitem"
                      onClick={() => {
                        setDbTypeMenuOpen(false)
                        setDbTypeAndMaybeDefaultPort('postgres')
                      }}
                    >
                      PostgreSQL
                    </button>
                    <button
                      type="button"
                      className={`selectMenuItem ${dbType === 'mysql' ? 'selectMenuItemActive' : ''}`}
                      role="menuitem"
                      onClick={() => {
                        setDbTypeMenuOpen(false)
                        setDbTypeAndMaybeDefaultPort('mysql')
                      }}
                    >
                      MySQL
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {dbType === 'postgres' ? (
              <div className="formRow">
                <div className="formLabel">SSL mode</div>
                <div ref={dbSslModeMenuOpen ? dbSslModeMenuWrapRef : null} className="selectMenuWrap">
                  <button
                    type="button"
                    className="selectMenuBtn"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDbSslModeMenuOpen(v => !v)
                    }}
                    aria-haspopup="menu"
                    aria-expanded={dbSslModeMenuOpen}
                    aria-label="PostgreSQL SSL mode"
                    title="PostgreSQL SSL mode"
                  >
                    {dbSslMode}
                  </button>

                  {dbSslModeMenuOpen ? (
                    <div
                      className="selectMenuPanel"
                      role="menu"
                      onPointerDown={e => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                    >
                      {([
                        { value: 'prefer', label: 'prefer (default)' },
                        { value: 'require', label: 'require (encrypt, no verify)' },
                        { value: 'verify-ca', label: 'verify-ca' },
                        { value: 'verify-full', label: 'verify-full' },
                        { value: 'disable', label: 'disable' },
                        { value: 'allow', label: 'allow' },
                      ] as Array<{ value: PgSslMode; label: string }>).map(o => (
                        <button
                          key={o.value}
                          type="button"
                          className={`selectMenuItem ${dbSslMode === o.value ? 'selectMenuItemActive' : ''}`}
                          role="menuitem"
                          onClick={() => {
                            setDbSslModeMenuOpen(false)
                            setDbSslMode(o.value)
                          }}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="formRow">
              <div className="formLabel">Host</div>
              <input
                className="mono"
                value={dbHost}
                onChange={e => setDbHost(e.target.value)}
                placeholder="localhost"
              />
            </div>

            <div className="formRow">
              <div className="formLabel">Port</div>
              <input
                className="mono"
                inputMode="numeric"
                value={dbPort}
                onChange={e => setDbPort(e.target.value.replaceAll(/\s+/g, ''))}
                placeholder="5432"
              />
            </div>

            <div className="formRow">
              <div className="formLabel">Database</div>
              <input
                className="mono"
                value={dbDatabase}
                onChange={e => setDbDatabase(e.target.value)}
                placeholder="mydb"
              />
            </div>

            <div className="formRow">
              <div className="formLabel">Username</div>
              <input
                className="mono"
                value={dbUsername}
                onChange={e => setDbUsername(e.target.value)}
                placeholder="postgres"
              />
            </div>

            <div className="formRow">
              <div className="formLabel">Password</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                <input
                  className="mono"
                  type="text"
                  name="ruf_db_secret"
                  value={dbPassword}
                  onChange={e => setDbPassword(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  style={dbShowPassword ? undefined : ({ WebkitTextSecurity: 'disc' } as any)}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="headerDeleteBtn"
                  style={{ width: 64 }}
                  onClick={() => setDbShowPassword(v => !v)}
                  aria-label={dbShowPassword ? 'Hide password' : 'Show password'}
                  title={dbShowPassword ? 'Hide' : 'Show'}
                >
                  {dbShowPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="formRow">
              <div className="formLabel">URL</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                <div
                  className="mono"
                  style={{
                    fontSize: 12,
                    lineHeight: 1.25,
                    opacity: dbConnectionStringPreview ? 1 : 0.7,
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                    whiteSpace: 'normal',
                  }}
                >
                  {dbConnectionStringPreview || '—'}
                </div>
                <button
                  type="button"
                  className="headerDeleteBtn"
                  style={
                    dbTestOkMs !== null
                      ? { width: 64, background: 'rgba(80, 220, 140, .18)', borderColor: 'rgba(80, 220, 140, .45)', color: 'rgb(120, 255, 185)' }
                      : { width: 64 }
                  }
                  onClick={testDbConnection}
                  disabled={dbTestInFlight || !dbConnectionString}
                >
                  {dbTestInFlight ? 'Testing...' : dbTestOkMs !== null ? `${dbTestOkMs}ms` : 'Test'}
                </button>
              </div>
            </div>

            {dbTestError && (
              <div className="section" style={{ gap: 6 }}>
                <div className="small" style={{ color: '#ff9a9a' }}>{dbTestError}</div>
                {dbTestLog && (
                  <div
                    className="mono"
                    style={{
                      fontSize: 12,
                      lineHeight: 1.35,
                      padding: 10,
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,.12)',
                      background: 'rgba(255,255,255,.04)',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {dbTestLog}
                  </div>
                )}
              </div>
            )}
          </div>
        </details>
      </div>

      {error && <div className="small" style={{ color: '#ff9a9a', marginTop: 8 }}>{error}</div>}

      <div className="modalActions">
        <button onClick={save}>Save</button>
      </div>
    </dialog>
  )
}
