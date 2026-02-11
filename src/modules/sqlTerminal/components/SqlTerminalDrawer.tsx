import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Collection } from '../../collectionTree'
import type { Environment, GlobalSqlConnectionItem } from '../../../shared/types/environment'
import { resolveVariableValue } from '../../../shared/utils/variables'
import { DB_ENV_KEYS, buildDbConnectionString, getDbConnectionStringPreview, getDbFormStateFromEnv, hasDbConfigInEnv, runDbSql } from '../../environment'
import { useDismissibleLayer } from '../../../shared/hooks/useDismissibleLayer'
import { logError, logWarn } from '../../../shared/utils/logger'

type DbConnOption = {
  id: string
  label: string
  type: 'postgres' | 'mysql'
  connectionString: string
  connectionPreview: string
  variables: Record<string, string>
}

type OutputEntry = { kind: 'sys' | 'out' | 'err' | 'in'; text: string }
type PopupPosition = { top: number; left: number }

const SQL_TERMINAL_HEIGHT_KEY = 'ruf_sql_terminal_height_v1'
const SQL_TERMINAL_SELECTED_CONN_KEY = 'ruf_sql_terminal_selected_conn_v1'
const SQL_TERMINAL_SQL_KEY = 'ruf_sql_terminal_sql_v1'
const SQL_TERMINAL_SPLIT_KEY = 'ruf_sql_terminal_split_v1'
const SQL_TERMINAL_SCHEMA_KEY = 'ruf_sql_terminal_schema_v1'
const SQL_TERMINAL_POSITION_KEY = 'ruf_sql_terminal_position_v1'
const SQL_TERMINAL_WIDTH_KEY = 'ruf_sql_terminal_width_v1'
const SQL_TERMINAL_MIN_HEIGHT_PX = 240
const SQL_TERMINAL_MIN_WIDTH_PX = 360
const WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX = 38

function getWindowTitlebarHeightPx() {
  if (typeof document === 'undefined') return WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX
  const el = document.querySelector<HTMLElement>('.windowTitlebar')
  const measured = el?.getBoundingClientRect().height ?? WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX
  return Math.max(0, Math.round(measured)) || WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX
}

function getSqlTerminalMaxHeightPx() {
  if (typeof window === 'undefined') return 420
  const topReserved = getWindowTitlebarHeightPx()
  return Math.max(SQL_TERMINAL_MIN_HEIGHT_PX, Math.floor(window.innerHeight - topReserved))
}

function getSqlTerminalMaxWidthPx() {
  if (typeof window === 'undefined') return 980
  return Math.max(SQL_TERMINAL_MIN_WIDTH_PX, Math.floor(window.innerWidth - 280))
}

function getSqlTerminalBaseWidthPx() {
  if (typeof window === 'undefined') return 680
  const max = getSqlTerminalMaxWidthPx()
  return Math.max(SQL_TERMINAL_MIN_WIDTH_PX, Math.round(Math.min(window.innerWidth * 0.68, max)))
}

function getSqlTerminalBaseHeightPx() {
  if (typeof window === 'undefined') return 420
  const max = getSqlTerminalMaxHeightPx()
  return Math.round(Math.min(window.innerHeight * 0.38, max))
}

function safeLoadNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch (error) {
    logError('SqlTerminal.safeLoadNumber', error, { key })
    return null
  }
}

function safeLoadString(key: string): string | null {
  try {
    const raw = localStorage.getItem(key)
    return typeof raw === 'string' ? raw : null
  } catch (error) {
    logError('SqlTerminal.safeLoadString', error, { key })
    return null
  }
}

function safeLoadFraction(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const n = Number(raw)
    if (!Number.isFinite(n)) return null
    if (n <= 0 || n >= 1) return null
    return n
  } catch (error) {
    logError('SqlTerminal.safeLoadFraction', error, { key })
    return null
  }
}

function safeSave(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch (error) {
    logError('SqlTerminal.safeSave', error, { key })
  }
}

function safeRemove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch (error) {
    logError('SqlTerminal.safeRemove', error, { key })
  }
}

function applyVariables(text: string, vars: Record<string, string>) {
  return text.replaceAll(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m: string, name: string) => resolveVariableValue(name, vars) ?? '')
}

function quoteIdentPostgres(name: string) {
  return `"${name.replaceAll('"', '""')}"`
}

function quoteSqlStringLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function looksLikeSelectOrWith(sql: string) {
  const s = sql.trimStart()
  return /^select\b/i.test(s) || /^with\b/i.test(s)
}

function makeTableAlias(tableName: string): string {
  const raw = (tableName || '').replaceAll('"', '').trim()
  if (!raw) return 't'

  // Split by common separators and also by camelCase boundaries.
  const parts = raw
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/g)
    .filter(Boolean)

  const letters = parts.map(p => p[0] ?? '').filter(Boolean)
  const alias = letters.join('').slice(0, 6).toLowerCase()
  return alias || raw.slice(0, 1).toLowerCase() || 't'
}

function stripQuotes(ident: string) {
  return (ident || '').replaceAll('"', '').trim()
}

function parseFromAndJoinAliases(sql: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /\b(from|join)\s+([a-zA-Z0-9_".]+)\s*(?:as\s+)?([a-zA-Z0-9_"]+)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    const tableRef = (m[2] ?? '').trim()
    if (!tableRef || tableRef.startsWith('(')) continue
    const aliasRaw = (m[3] ?? '').trim()
    const tableName = stripQuotes(tableRef.split('.').pop() ?? tableRef)
    if (!tableName) continue
    const alias = stripQuotes(aliasRaw)
    if (alias && !/^(on|where|group|order|limit|inner|left|right|full|cross|join)$/i.test(alias)) out[alias] = tableName
    // Also allow referencing by the table name itself.
    out[tableName] = tableName
  }
  return out
}

function clampHistory<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr
  return arr.slice(arr.length - max)
}

function formatTime(d: Date) {
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function extractSchemaTableLabel(sql: string, selectedSchema: string): string | null {
  const re = /\b(from|into|update|join)\s+([a-zA-Z0-9_".]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    const rawRef = (m[2] ?? '').trim()
    if (!rawRef || rawRef.startsWith('(')) continue
    const normalized = rawRef
      .split('.')
      .map(stripQuotes)
      .filter(Boolean)
      .join('.')
    if (!normalized) continue
    if (normalized.includes('.')) return normalized
    return selectedSchema ? `${selectedSchema}.${normalized}` : normalized
  }
  return null
}

function getCurrentSqlStatement(sql: string, caret: number): string | null {
  if (!sql) return null

  const len = sql.length
  const safeCaret = Math.max(0, Math.min(caret, len))
  const segments: Array<{ start: number; end: number }> = []

  let stmtStart = 0
  let i = 0
  let inSingle = false
  let inDouble = false
  let inLineComment = false
  let inBlockComment = false

  while (i < len) {
    const ch = sql[i]
    const next = i + 1 < len ? sql[i + 1] : ''

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      i += 1
      continue
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i += 2
        continue
      }
      i += 1
      continue
    }

    if (inSingle) {
      if (ch === "'" && next === "'") {
        i += 2
        continue
      }
      if (ch === "'") inSingle = false
      i += 1
      continue
    }

    if (inDouble) {
      if (ch === '"' && next === '"') {
        i += 2
        continue
      }
      if (ch === '"') inDouble = false
      i += 1
      continue
    }

    if (ch === '-' && next === '-') {
      inLineComment = true
      i += 2
      continue
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true
      i += 2
      continue
    }
    if (ch === "'") {
      inSingle = true
      i += 1
      continue
    }
    if (ch === '"') {
      inDouble = true
      i += 1
      continue
    }

    if (ch === ';') {
      segments.push({ start: stmtStart, end: i })
      stmtStart = i + 1
    }
    i += 1
  }

  segments.push({ start: stmtStart, end: len })

  let fallback: { start: number; end: number } | null = null

  for (const seg of segments) {
    const raw = sql.slice(seg.start, seg.end)
    const leading = raw.match(/^\s*/)?.[0].length ?? 0
    const trailing = raw.match(/\s*$/)?.[0].length ?? 0
    const start = seg.start + leading
    const end = seg.end - trailing
    if (end <= start) continue

    if (safeCaret >= start && safeCaret <= end) {
      return sql.slice(start, end).trim()
    }

    if (safeCaret > end) fallback = { start, end }
  }

  if (fallback) return sql.slice(fallback.start, fallback.end).trim()
  return null
}

function buildDbConnOptions(
  collections: Collection[],
  envByCollection: Record<string, Environment>,
  extraConnections: GlobalSqlConnectionItem[] | undefined,
): DbConnOption[] {
  const byId = new Map(collections.map(c => [c.id, c]))
  const out: DbConnOption[] = []

  for (const [collectionId, env] of Object.entries(envByCollection)) {
    if (!env) continue
    if (!hasDbConfigInEnv(env)) continue

    const collection = byId.get(collectionId)
    if (!collection) continue

    const rawType = env.variables?.[DB_ENV_KEYS.type]
    const type = rawType === 'mysql' ? 'mysql' : 'postgres'
    const fromEnv = (env.variables?.[DB_ENV_KEYS.connectionString] ?? '').trim()
    const connectionString = fromEnv || buildDbConnectionString(getDbFormStateFromEnv(env))
    if (!connectionString) continue

    const connectionPreview = getDbConnectionStringPreview(connectionString)
    out.push({
      id: `collection:${collectionId}`,
      label: `Collection - ${collection.name || collectionId}`,
      type,
      connectionString,
      connectionPreview,
      variables: env.variables ?? {},
    })
  }

  for (const conn of extraConnections ?? []) {
    if (!conn) continue
    const connectionString = buildDbConnectionString(conn)
    if (!connectionString) continue
    out.push({
      id: `app:${conn.id}`,
      label: `App - ${conn.name || 'Connection'}`,
      type: conn.type,
      connectionString,
      connectionPreview: getDbConnectionStringPreview(connectionString),
      variables: {},
    })
  }

  return out.sort((a, b) => a.label.localeCompare(b.label))
}

export function SqlTerminalDrawer(props: {
  open: boolean
  onClose: () => void
  collections: Collection[]
  environmentsByCollection: Record<string, Environment>
  extraConnections?: GlobalSqlConnectionItem[]
}) {
  const { open, onClose } = props

  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [schemaMenuOpen, setSchemaMenuOpen] = useState(false)
  const [schemaMenuPlacement, setSchemaMenuPlacement] = useState<'below' | 'above'>('below')
  const [schemaMenuMaxHeight, setSchemaMenuMaxHeight] = useState<number>(220)
  const [heightPx, setHeightPx] = useState<number | null>(() => safeLoadNumber(SQL_TERMINAL_HEIGHT_KEY))
  const [widthPx, setWidthPx] = useState<number | null>(() => safeLoadNumber(SQL_TERMINAL_WIDTH_KEY))
  const [drawerPosition, setDrawerPosition] = useState<'bottom' | 'left'>(() => (safeLoadString(SQL_TERMINAL_POSITION_KEY) === 'left' ? 'left' : 'bottom'))
  const [selectedConnId, setSelectedConnId] = useState<string | null>(() => safeLoadString(SQL_TERMINAL_SELECTED_CONN_KEY))
  const [sql, setSql] = useState(() => safeLoadString(SQL_TERMINAL_SQL_KEY) ?? '')
  const [output, setOutput] = useState<OutputEntry[]>([])
  const [resultRows, setResultRows] = useState<Array<Record<string, unknown>> | null>(null)
  const [resultColumns, setResultColumns] = useState<string[] | null>(null)
  const [resultHint, setResultHint] = useState<string | null>(null)
  const [lastRunSchemaTableLabel, setLastRunSchemaTableLabel] = useState<string | null>(null)
  const [splitLeftFraction, setSplitLeftFraction] = useState<number>(() => safeLoadFraction(SQL_TERMINAL_SPLIT_KEY) ?? 0.42)
  const [schemas, setSchemas] = useState<string[]>([])
  const [selectedSchema, setSelectedSchema] = useState<string>(() => safeLoadString(SQL_TERMINAL_SCHEMA_KEY) ?? '')
  const [tables, setTables] = useState<string[]>([])
  const [columnsByTableKey, setColumnsByTableKey] = useState<Record<string, string[]>>({})
  const [cursorPos, setCursorPos] = useState<number>(0)
  const [tableSuggestOpen, setTableSuggestOpen] = useState(false)
  const [suggestMode, setSuggestMode] = useState<'table' | 'column'>('table')
  const [tableSuggestKind, setTableSuggestKind] = useState<'from' | 'into' | 'join'>('from')
  const [columnTargetTableKey, setColumnTargetTableKey] = useState<string | null>(null)
  const [columnLoading, setColumnLoading] = useState(false)
  const [tableSuggestPrefix, setTableSuggestPrefix] = useState<string>('')
  const [tableSuggestReplaceRange, setTableSuggestReplaceRange] = useState<{ start: number; end: number } | null>(null)
  const [tableSuggestActiveIndex, setTableSuggestActiveIndex] = useState<number | null>(null)
  const [tableSuggestPopupPos, setTableSuggestPopupPos] = useState<PopupPosition | null>(null)

  const menuWrapRef = useRef<HTMLDivElement | null>(null)
  const schemaMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const editorWrapRef = useRef<HTMLDivElement | null>(null)
  const sqlRef = useRef<HTMLTextAreaElement | null>(null)
  const lineNumbersRef = useRef<HTMLPreElement | null>(null)
  const tableSuggestRef = useRef<HTMLDivElement | null>(null)
  const outputRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const runRef = useRef<(() => void) | null>(null)
  const sectionRef = useRef<HTMLElement | null>(null)
  const pendingCaretRef = useRef<number | null>(null)
  const editHistoryRef = useRef<{ stack: Array<{ text: string; caret: number }>; index: number; applying: boolean }>({
    stack: [{ text: safeLoadString(SQL_TERMINAL_SQL_KEY) ?? '', caret: 0 }],
    index: 0,
    applying: false,
  })

  const connOptions = useMemo(
    () => buildDbConnOptions(props.collections, props.environmentsByCollection, props.extraConnections),
    [props.collections, props.environmentsByCollection, props.extraConnections],
  )
  const selectedConn = useMemo(() => connOptions.find(c => c.id === selectedConnId) ?? null, [connOptions, selectedConnId])
  const lineCount = useMemo(() => Math.max(1, sql.split('\n').length), [sql])
  const lineNumberDigits = useMemo(() => Math.max(2, String(lineCount).length), [lineCount])
  const lineNumbers = useMemo(() => Array.from({ length: lineCount }, (_x, i) => i + 1), [lineCount])
  const activeLine = useMemo(() => {
    const safeCursor = Math.max(0, Math.min(cursorPos, sql.length))
    return sql.slice(0, safeCursor).split('\n').length
  }, [cursorPos, sql])
  const editorWrapStyle = useMemo(
    () =>
      ({
        '--sql-line-gutter-ch': String(lineNumberDigits + 1),
      }) as CSSProperties,
    [lineNumberDigits],
  )
  const syncLineNumberScroll = useCallback(() => {
    const ta = sqlRef.current
    const lines = lineNumbersRef.current
    if (!ta || !lines) return
    lines.style.transform = `translateY(${-ta.scrollTop}px)`
  }, [])

  const refreshEditorCaretState = useCallback(() => {
    setCursorPos(sqlRef.current?.selectionStart ?? 0)
    syncLineNumberScroll()
  }, [syncLineNumberScroll])

  const updateTableSuggestPopupPosition = useCallback(() => {
    if (!tableSuggestOpen) return
    const ta = sqlRef.current
    const wrap = editorWrapRef.current
    if (!ta || !wrap) return

    const pos = ta.selectionStart ?? 0
    const before = ta.value.slice(0, pos)
    const lines = before.split('\n')
    const lineIndex = Math.max(0, lines.length - 1)
    const currentLine = lines[lineIndex] ?? ''
    const cs = window.getComputedStyle(ta)
    const font = `${cs.fontStyle} ${cs.fontVariant} ${cs.fontWeight} ${cs.fontSize} / ${cs.lineHeight} ${cs.fontFamily}`
    const lineHeight = Number.parseFloat(cs.lineHeight) || 17.4
    const paddingTop = Number.parseFloat(cs.paddingTop) || 0
    const paddingLeft = Number.parseFloat(cs.paddingLeft) || 0

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.font = font
    const textWidth = ctx.measureText(currentLine).width

    const caretX = paddingLeft + textWidth - ta.scrollLeft
    const caretY = paddingTop + lineIndex * lineHeight - ta.scrollTop

    const popupW = tableSuggestRef.current?.offsetWidth ?? 220
    const popupH = tableSuggestRef.current?.offsetHeight ?? 220
    const wrapW = wrap.clientWidth
    const wrapH = wrap.clientHeight
    const margin = 8

    const unclampedLeft = Math.round(caretX + 12)
    const unclampedTop = Math.round(caretY + lineHeight + 6)
    const left = Math.max(margin, Math.min(wrapW - popupW - margin, unclampedLeft))
    const top = Math.max(margin, Math.min(wrapH - popupH - margin, unclampedTop))
    setTableSuggestPopupPos({ top, left })
  }, [tableSuggestOpen])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => sqlRef.current?.focus())
  }, [open])

  useEffect(() => {
    runRef.current = () => void run()
  })

  useEffect(() => {
    const pending = pendingCaretRef.current
    if (pending == null) return
    pendingCaretRef.current = null
    const ta = sqlRef.current
    if (!ta) return
    ta.focus()
    ta.selectionStart = pending
    ta.selectionEnd = pending
    setCursorPos(pending)
    requestAnimationFrame(syncLineNumberScroll)
  }, [sql])

  useEffect(() => {
    requestAnimationFrame(syncLineNumberScroll)
  }, [open, lineCount, syncLineNumberScroll])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useDismissibleLayer({
    open: menuOpen,
    onDismiss: () => setMenuOpen(false),
    isInsideTarget: target => {
      const wrap = menuWrapRef.current
      return !!(target && wrap && wrap.contains(target))
    },
  })

  useDismissibleLayer({
    open: schemaMenuOpen,
    onDismiss: () => setSchemaMenuOpen(false),
    isInsideTarget: target => {
      const wrap = schemaMenuWrapRef.current
      return !!(target && wrap && wrap.contains(target))
    },
  })

  useEffect(() => {
    if (heightPx == null) return
    safeSave(SQL_TERMINAL_HEIGHT_KEY, String(heightPx))
  }, [heightPx])

  useEffect(() => {
    if (widthPx == null) return
    safeSave(SQL_TERMINAL_WIDTH_KEY, String(widthPx))
  }, [widthPx])

  useEffect(() => {
    safeSave(SQL_TERMINAL_POSITION_KEY, drawerPosition)
  }, [drawerPosition])

  useEffect(() => {
    if (!open) return

    function clampToViewport() {
      const max = getSqlTerminalMaxHeightPx()
      setHeightPx(prev => {
        if (prev == null) return prev
        return Math.min(prev, max)
      })
      const maxWidth = getSqlTerminalMaxWidthPx()
      setWidthPx(prev => {
        if (prev == null) return prev
        return Math.min(prev, maxWidth)
      })
    }

    clampToViewport()
    window.addEventListener('resize', clampToViewport)
    return () => window.removeEventListener('resize', clampToViewport)
  }, [open])

  useEffect(() => {
    if (!selectedConnId) safeRemove(SQL_TERMINAL_SELECTED_CONN_KEY)
    else safeSave(SQL_TERMINAL_SELECTED_CONN_KEY, selectedConnId)
  }, [selectedConnId])

  useEffect(() => {
    safeSave(SQL_TERMINAL_SQL_KEY, sql)
  }, [sql])

  useEffect(() => {
    safeSave(SQL_TERMINAL_SPLIT_KEY, String(splitLeftFraction))
  }, [splitLeftFraction])

  useEffect(() => {
    if (!selectedSchema) safeRemove(SQL_TERMINAL_SCHEMA_KEY)
    else safeSave(SQL_TERMINAL_SCHEMA_KEY, selectedSchema)
  }, [selectedSchema])

  useEffect(() => {
    const el = outputRef.current
    if (!el) return
    const hasTableResult = (resultColumns?.length ?? 0) > 0 || (resultRows?.length ?? 0) > 0
    if (hasTableResult) {
      el.scrollTop = 0
      return
    }
    el.scrollTop = el.scrollHeight
  }, [open, output.length, resultColumns, resultRows])

  useEffect(() => {
    if (!connOptions.length) return
    setSelectedConnId(prev => {
      if (prev && connOptions.some(c => c.id === prev)) return prev
      const fromStorage = safeLoadString(SQL_TERMINAL_SELECTED_CONN_KEY)
      if (fromStorage && connOptions.some(c => c.id === fromStorage)) return fromStorage
      return connOptions[0]?.id ?? null
    })
  }, [connOptions])

  async function loadSchemas(conn: DbConnOption) {
    if (conn.type !== 'postgres') {
      setSchemas([])
      setSelectedSchema('')
      return
    }
    try {
      const r = await runDbSql({
        type: conn.type,
        connectionString: conn.connectionString,
        sql: "select schema_name as name from information_schema.schemata where schema_name <> 'information_schema' and schema_name not like 'pg\\_%' escape '\\' order by case when schema_name='public' then 0 else 1 end, schema_name",
        timeoutMs: 15_000,
      })
      const rows = r.ok ? (r.rows ?? null) : null
      const names = rows
        ? rows
            .map(x => (x && typeof x === 'object' && 'name' in x ? String((x as Record<string, unknown>).name ?? '') : ''))
            .filter(Boolean)
        : []
      setSchemas(names)
      setSelectedSchema(prev => {
        const stored = safeLoadString(SQL_TERMINAL_SCHEMA_KEY) ?? ''
        const candidate = prev || stored
        if (candidate && names.includes(candidate)) return candidate
        if (names.includes('public')) return 'public'
        return names[0] ?? ''
      })
    } catch (error) {
      logError('SqlTerminal.loadSchemas', error, { connectionId: conn.id })
      setSchemas([])
      setSelectedSchema('')
    }
  }

  async function loadTables(conn: DbConnOption, schema: string) {
    if (conn.type !== 'postgres') {
      setTables([])
      return
    }
    if (!schema) {
      setTables([])
      return
    }
    try {
      const sql = `select table_name as name from information_schema.tables where table_schema = ${quoteSqlStringLiteral(schema)} and table_type in ('BASE TABLE','VIEW') order by table_name`
      const r = await runDbSql({
        type: conn.type,
        connectionString: conn.connectionString,
        sql,
        timeoutMs: 15_000,
      })
      const rows = r.ok ? (r.rows ?? null) : null
      const names = rows
        ? rows
            .map(x => (x && typeof x === 'object' && 'name' in x ? String((x as Record<string, unknown>).name ?? '') : ''))
            .filter(Boolean)
        : []
      setTables(names)
    } catch (error) {
      logError('SqlTerminal.loadTables', error, { connectionId: conn.id, schema })
      setTables([])
    }
  }

  useEffect(() => {
    if (!open) return
    if (!selectedConn) return
    void loadSchemas(selectedConn)
    setTables([])
    setColumnsByTableKey({})
  }, [open, selectedConnId])

  useEffect(() => {
    if (!open) return
    if (!selectedConn) return
    if (selectedConn.type !== 'postgres') return
    void loadTables(selectedConn, selectedSchema)
  }, [open, selectedConnId, selectedSchema])

  async function loadColumnsForTable(conn: DbConnOption, schema: string, tableName: string) {
    if (conn.type !== 'postgres') return
    if (!schema || !tableName) return
    const key = `${schema}.${tableName}`
    if (columnsByTableKey[key]) return

    setColumnLoading(true)
    try {
      const sql = `select column_name as name from information_schema.columns where table_schema = ${quoteSqlStringLiteral(schema)} and table_name = ${quoteSqlStringLiteral(tableName)} order by ordinal_position`
      const r = await runDbSql({ type: conn.type, connectionString: conn.connectionString, sql, timeoutMs: 15_000 })
      const rows = r.ok ? (r.rows ?? null) : null
      const names = rows
        ? rows
            .map(x => (x && typeof x === 'object' && 'name' in x ? String((x as Record<string, unknown>).name ?? '') : ''))
            .filter(Boolean)
        : []
      setColumnsByTableKey(prev => ({ ...prev, [key]: names }))
    } finally {
      setColumnLoading(false)
    }
  }

  function onResizeHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!open) return
    e.preventDefault()
    const handle = e.currentTarget
    const pointerId = e.pointerId
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    const startY = e.clientY
    const max = getSqlTerminalMaxHeightPx()
    const startHeight = heightPx ?? Math.round(Math.min(window.innerHeight * 0.38, max))

    const min = SQL_TERMINAL_MIN_HEIGHT_PX

    function clamp(n: number) {
      return Math.max(min, Math.min(max, n))
    }

    function onMove(ev: PointerEvent) {
      if ((ev.buttons & 1) === 0) {
        cleanup()
        return
      }
      const dy = ev.clientY - startY
      const next = clamp(Math.round(startHeight - dy))
      setHeightPx(next)
    }

    function cleanup() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('blur', onCancel)
      handle.removeEventListener('lostpointercapture', onCancel)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      } catch (error) {
        logWarn('SqlTerminal.releasePointerCapture.vertical', 'Failed to release pointer capture', { error })
      }
    }

    function onUp() {
      cleanup()
    }

    function onCancel() {
      cleanup()
    }

    try {
      handle.setPointerCapture(pointerId)
    } catch (error) {
      logWarn('SqlTerminal.setPointerCapture.vertical', 'Failed to set pointer capture', { error })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('blur', onCancel)
    handle.addEventListener('lostpointercapture', onCancel)
  }

  function onResizeHandleDoubleClick() {
    const max = getSqlTerminalMaxHeightPx()
    const base = getSqlTerminalBaseHeightPx()
    const current = heightPx ?? base
    const isMaximized = Math.abs(current - max) <= 2
    setHeightPx(isMaximized ? base : max)
  }

  function onRightResizeHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!open) return
    if (drawerPosition !== 'left') return
    e.preventDefault()
    const handle = e.currentTarget
    const pointerId = e.pointerId
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    const startX = e.clientX
    const max = getSqlTerminalMaxWidthPx()
    const startWidth = widthPx ?? getSqlTerminalBaseWidthPx()

    function clamp(n: number) {
      return Math.max(SQL_TERMINAL_MIN_WIDTH_PX, Math.min(max, n))
    }

    function onMove(ev: PointerEvent) {
      if ((ev.buttons & 1) === 0) {
        cleanup()
        return
      }
      const dx = ev.clientX - startX
      const next = clamp(Math.round(startWidth + dx))
      setWidthPx(next)
    }

    function cleanup() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('blur', onCancel)
      handle.removeEventListener('lostpointercapture', onCancel)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      } catch (error) {
        logWarn('SqlTerminal.releasePointerCapture.right', 'Failed to release pointer capture', { error })
      }
    }

    function onUp() {
      cleanup()
    }

    function onCancel() {
      cleanup()
    }

    try {
      handle.setPointerCapture(pointerId)
    } catch (error) {
      logWarn('SqlTerminal.setPointerCapture.right', 'Failed to set pointer capture', { error })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('blur', onCancel)
    handle.addEventListener('lostpointercapture', onCancel)
  }

  function pushOutput(add: OutputEntry[]) {
    if (!add.length) return
    setOutput(prev => [...prev, ...add])
  }

  function openSchemaMenu(anchorEl: HTMLElement) {
    const margin = 8
    const gap = 6
    const minHeight = 96
    const rect = anchorEl.getBoundingClientRect()
    const sectionRect = sectionRef.current?.getBoundingClientRect()
    const limitTop = (sectionRect?.top ?? 0) + margin
    const limitBottom = (sectionRect?.bottom ?? window.innerHeight) - margin
    const availableBelowRaw = Math.floor(limitBottom - rect.bottom - gap)
    const availableAboveRaw = Math.floor(rect.top - limitTop - gap)
    const availableBelow = Math.max(minHeight, availableBelowRaw)
    const availableAbove = Math.max(minHeight, availableAboveRaw)

    if (availableBelow >= availableAbove) {
      setSchemaMenuPlacement('below')
      setSchemaMenuMaxHeight(availableBelow)
      setSchemaMenuOpen(true)
      return
    }

    setSchemaMenuPlacement('above')
    setSchemaMenuMaxHeight(availableAbove)
    setSchemaMenuOpen(true)
  }

  function onSplitHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!open) return
    e.preventDefault()
    const handle = e.currentTarget
    const pointerId = e.pointerId
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const wrap = bodyRef.current
    if (!wrap) return

    const rect = wrap.getBoundingClientRect()
    const startX = e.clientX
    const startFrac = splitLeftFraction

    const minLeftPx = 260
    const minRightPx = 320
    const maxFracFromLeft = Math.max(0.1, Math.min(0.9, (rect.width - minRightPx) / rect.width))
    const minFracFromLeft = Math.max(0.1, Math.min(0.9, minLeftPx / rect.width))

    function clampFrac(n: number) {
      return Math.max(minFracFromLeft, Math.min(maxFracFromLeft, n))
    }

    function onMove(ev: PointerEvent) {
      if ((ev.buttons & 1) === 0) {
        cleanup()
        return
      }
      const dx = ev.clientX - startX
      const next = clampFrac(startFrac + dx / rect.width)
      setSplitLeftFraction(next)
    }

    function cleanup() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('blur', onCancel)
      handle.removeEventListener('lostpointercapture', onCancel)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      } catch (error) {
        logWarn('SqlTerminal.releasePointerCapture.horizontal', 'Failed to release pointer capture', { error })
      }
    }

    function onUp() {
      cleanup()
    }

    function onCancel() {
      cleanup()
    }

    try {
      handle.setPointerCapture(pointerId)
    } catch (error) {
      logWarn('SqlTerminal.setPointerCapture.horizontal', 'Failed to set pointer capture', { error })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('blur', onCancel)
    handle.addEventListener('lostpointercapture', onCancel)
  }

  const effectiveResultColumns = useMemo(() => {
    if (resultColumns?.length) return resultColumns
    const rows = resultRows
    if (!rows || !rows.length) return []
    const first = rows[0] ?? {}
    return Object.keys(first)
  }, [resultColumns, resultRows])

  const tableSuggestions = useMemo(() => {
    const p = (tableSuggestPrefix || '').toLowerCase()
    if (!p) return tables.slice(0, 80)
    return tables.filter(t => t.toLowerCase().includes(p)).slice(0, 80)
  }, [tables, tableSuggestPrefix])

  const columnSuggestions = useMemo(() => {
    const key = columnTargetTableKey
    if (!key) return []
    const cols = columnsByTableKey[key] ?? []
    const p = (tableSuggestPrefix || '').toLowerCase()
    if (!p) return cols.slice(0, 120)
    return cols.filter(c => c.toLowerCase().includes(p)).slice(0, 120)
  }, [columnsByTableKey, columnTargetTableKey, tableSuggestPrefix])

  const applyTableSuggestionAt = useCallback((index: number) => {
    const range = tableSuggestReplaceRange
    const t = tableSuggestions[index]
    if (!range || !t) return
    const needsLeadingSpace = /(from|into|join)$/i.test(sql.slice(0, range.start))
    const tableRef = tableSuggestKind === 'into' ? t : `${t} ${makeTableAlias(t)}`
    const insert = `${needsLeadingSpace ? ' ' : ''}${tableRef}`
    const next = `${sql.slice(0, range.start)}${insert}${sql.slice(range.end)}`
    setSql(next)
    setTableSuggestOpen(false)
    requestAnimationFrame(() => {
      const ta = sqlRef.current
      if (!ta) return
      const newPos = range.start + insert.length
      ta.focus()
      ta.selectionStart = newPos
      ta.selectionEnd = newPos
      setCursorPos(newPos)
    })
  }, [sql, tableSuggestKind, tableSuggestReplaceRange, tableSuggestions])

  const applyColumnSuggestionAt = useCallback((index: number) => {
    const range = tableSuggestReplaceRange
    const c = columnSuggestions[index]
    if (!range || !c) return
    const next = `${sql.slice(0, range.start)}${c}${sql.slice(range.end)}`
    setSql(next)
    setTableSuggestOpen(false)
    requestAnimationFrame(() => {
      const ta = sqlRef.current
      if (!ta) return
      const newPos = range.start + c.length
      ta.focus()
      ta.selectionStart = newPos
      ta.selectionEnd = newPos
      setCursorPos(newPos)
    })
  }, [columnSuggestions, sql, tableSuggestReplaceRange])

  useEffect(() => {
    if (!tableSuggestOpen) return
    setTableSuggestActiveIndex(null)
  }, [tableSuggestOpen, suggestMode, tableSuggestPrefix])

  useEffect(() => {
    if (!tableSuggestOpen) {
      setTableSuggestPopupPos(null)
      return
    }
    requestAnimationFrame(updateTableSuggestPopupPosition)
  }, [tableSuggestOpen, suggestMode, cursorPos, sql, tableSuggestions.length, columnSuggestions.length, updateTableSuggestPopupPosition])

  useEffect(() => {
    if (!open) return
    const ta = sqlRef.current
    if (!ta) return

    const pos = ta.selectionStart ?? cursorPos
    const before = sql.slice(0, pos)
    const currentLineBefore = before.slice(before.lastIndexOf('\n') + 1)

    // Column suggestion: <alias_or_table>.<prefix>
    const colMatch = before.match(/(?:^|[^a-zA-Z0-9_"])([a-zA-Z0-9_"]+)\.([a-zA-Z0-9_"]*)$/i)
    if (colMatch) {
      const token = stripQuotes(colMatch[1] ?? '')
      const colPrefix = stripQuotes(colMatch[2] ?? '')
      const aliases = parseFromAndJoinAliases(sql)
      const tableName = aliases[token]
      if (tableName && selectedConn?.type === 'postgres' && selectedSchema) {
        const key = `${selectedSchema}.${tableName}`
        setSuggestMode('column')
        setColumnTargetTableKey(key)
        setTableSuggestPrefix(colPrefix)
        setTableSuggestReplaceRange({ start: pos - (colMatch[2] ?? '').length, end: pos })
        setTableSuggestPopupPos(null)
        setTableSuggestActiveIndex(null)
        void loadColumnsForTable(selectedConn, selectedSchema, tableName)
        setTableSuggestOpen(true)
        return
      }
    }

    // Table suggestion: FROM/INTO/JOIN ...<prefix>
    const tableMatch = currentLineBefore.match(/(?:^|[\s(])(from|into|join)(?:\s+([a-zA-Z0-9_".]*))?$/i)
    if (!tableMatch || !tables.length) {
      setTableSuggestOpen(false)
      setTableSuggestReplaceRange(null)
      setTableSuggestPrefix('')
      setColumnTargetTableKey(null)
      setTableSuggestActiveIndex(null)
      return
    }

    const matchKind = (tableMatch[1] || 'from').toLowerCase()
    const kind: 'from' | 'into' | 'join' = matchKind === 'into' ? 'into' : (matchKind === 'join' ? 'join' : 'from')
    const prefix = tableMatch[2] ?? ''
    const start = pos - prefix.length
    const end = pos
    setSuggestMode('table')
    setTableSuggestKind(kind)
    setTableSuggestPrefix(prefix.replaceAll('"', ''))
    setTableSuggestReplaceRange({ start, end })
    setColumnTargetTableKey(null)
    setTableSuggestPopupPos(null)
    setTableSuggestActiveIndex(null)
    setTableSuggestOpen(true)
  }, [open, sql, cursorPos, tables.length, selectedConnId, selectedSchema])

  async function run() {
    if (busy) return
    const conn = selectedConn
    if (!conn) {
      pushOutput([{ kind: 'err', text: 'No database connection selected. Configure connection in App Settings or Collection Environment.' }])
      return
    }

    const ta = sqlRef.current
    const selectionStart = ta ? Math.max(0, Math.min(ta.selectionStart ?? 0, ta.selectionEnd ?? 0)) : 0
    const selectionEnd = ta ? Math.max(0, Math.max(ta.selectionStart ?? 0, ta.selectionEnd ?? 0)) : 0
    const selectedSql = selectionEnd > selectionStart ? sql.slice(selectionStart, selectionEnd).trim() : ''
    const statementSql = selectedSql ? '' : (getCurrentSqlStatement(sql, ta?.selectionStart ?? cursorPos) ?? '')
    const raw = (selectedSql || statementSql || sql).trim()
    if (!raw) {
      pushOutput([{ kind: 'sys', text: 'Nothing to run.' }])
      return
    }
    setLastRunSchemaTableLabel(extractSchemaTableLabel(raw, selectedSchema))

    const startedAt = new Date()
    const scopeLabel = selectedSql ? 'selection' : (statementSql ? 'statement' : 'script')
    pushOutput([{ kind: 'in', text: `-- ${formatTime(startedAt)} ${conn.label} (${conn.type}) [${scopeLabel}]` }])
    setResultRows(null)
    setResultColumns(null)
    setResultHint(null)

    setBusy(true)
    try {
      const renderedSql = applyVariables(raw, conn.variables)
      const sqlToRun =
        conn.type === 'postgres' && selectedSchema
          ? (looksLikeSelectOrWith(renderedSql)
              ? (renderedSql.trimStart().toLowerCase().startsWith('with')
                  ? renderedSql.replace(
                      /^\s*with\b/i,
                      m => `${m} __ruf_search_path as (select set_config('search_path', ${quoteSqlStringLiteral(selectedSchema)}, true)),`,
                    )
                  : `with __ruf_search_path as (select set_config('search_path', ${quoteSqlStringLiteral(selectedSchema)}, true))\n${renderedSql}`)
              : `set search_path to ${quoteIdentPostgres(selectedSchema)};\n${renderedSql}`)
          : renderedSql
      const r = await runDbSql({ type: conn.type, connectionString: conn.connectionString, sql: sqlToRun, timeoutMs: 30_000 })
      const prefix = r.ok ? 'OK' : 'ERROR'
      pushOutput([{ kind: r.ok ? 'out' : 'err', text: `${prefix}: ${r.message || ''} (${r.durationMs}ms)` }])
      const rows = r.rows ?? null
      if (r.ok && Array.isArray(r.columns) && r.columns.length) {
        setResultColumns(r.columns)
      }

      if (r.ok && Array.isArray(rows)) {
        if (rows.length && typeof rows[0] === 'object' && rows[0] != null && !Array.isArray(rows[0])) {
          setResultRows(rows as Array<Record<string, unknown>>)
          setResultHint(`${rows.length} row(s)`)
        } else if (!rows.length && (r.columns?.length ?? 0) > 0) {
          setResultRows([])
          setResultHint('0 row(s)')
        } else if (!rows.length) {
          setResultHint('0 row(s)')
        }
      } else if (r.ok && typeof r.rowsAffected === 'number') {
        setResultHint(`${r.rowsAffected} affected`)
      }
    } catch (e: unknown) {
      pushOutput([{ kind: 'err', text: e instanceof Error ? e.message : String(e) }])
    } finally {
      setBusy(false)
      requestAnimationFrame(() => sqlRef.current?.focus())
    }
  }

  const selectedLabel = selectedConn ? `${selectedConn.label}: ${selectedConn.connectionPreview}` : (connOptions.length ? 'Select DB…' : 'No DB connections')

  useEffect(() => {
    if (!open) return

    function onGlobalKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return
      const section = sectionRef.current
      const active = document.activeElement
      if (section && active && !section.contains(active)) return
      e.preventDefault()
      e.stopPropagation()
      runRef.current?.()
    }

    window.addEventListener('keydown', onGlobalKeyDown, true)
    return () => window.removeEventListener('keydown', onGlobalKeyDown, true)
  }, [open])

  const drawerMaxHeightPx = getSqlTerminalMaxHeightPx()
  const drawerHeightPx = heightPx == null ? null : Math.min(heightPx, drawerMaxHeightPx)
  const isLeftPosition = drawerPosition === 'left'
  const drawerMaxWidthPx = getSqlTerminalMaxWidthPx()
  const drawerWidthPx = Math.min(widthPx ?? getSqlTerminalBaseWidthPx(), drawerMaxWidthPx)

  return (
    <>
      <div
        className={open ? `terminalBackdrop terminalBackdropOpen ${isLeftPosition ? 'sqlTerminalBackdropLeft' : ''}`.trim() : 'terminalBackdrop'}
        onClick={onClose}
        style={isLeftPosition ? { width: `${drawerWidthPx}px` } : undefined}
      />
      <section
        ref={sectionRef}
        className={
          open
            ? `terminalDrawer terminalDrawerOpen sqlTerminalDrawer ${isLeftPosition ? 'sqlTerminalDrawerLeft' : ''}`.trim()
            : `terminalDrawer sqlTerminalDrawer ${isLeftPosition ? 'sqlTerminalDrawerLeft' : ''}`.trim()
        }
        aria-hidden={!open}
        style={
          isLeftPosition
            ? { width: `${drawerWidthPx}px`, maxWidth: `${drawerMaxWidthPx}px` }
            : (drawerHeightPx != null ? { height: `${drawerHeightPx}px`, maxHeight: `${drawerMaxHeightPx}px` } : { maxHeight: `${drawerMaxHeightPx}px` })
        }
      >
        {!isLeftPosition ? <div className="terminalResizeHandle" onPointerDown={onResizeHandlePointerDown} onDoubleClick={onResizeHandleDoubleClick} /> : null}
        {isLeftPosition ? <div className="sqlTerminalResizeHandleRight" onPointerDown={onRightResizeHandlePointerDown} /> : null}

        <header className="terminalHeader">
          <div className="terminalTitle mono" style={{ flex: '1 1 auto', minWidth: 0 }}>
            SQL
            <div ref={menuOpen ? menuWrapRef : null} className="selectMenuWrap sqlTerminalConnMenu">
              <button
                type="button"
                className="selectMenuBtn mono"
                onPointerDown={e => e.stopPropagation()}
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (!connOptions.length) return
                  setMenuOpen(v => !v)
                }}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Database connection"
                title={selectedConn?.connectionPreview ?? 'Database connection'}
              >
                {selectedLabel}
              </button>

              {menuOpen ? (
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
                  {connOptions.map(o => (
                    <button
                      key={o.id}
                      type="button"
                      className={`selectMenuItem ${selectedConnId === o.id ? 'selectMenuItemActive' : ''}`}
                      role="menuitem"
                      title={o.connectionPreview}
                      onClick={() => {
                        setMenuOpen(false)
                        setSelectedConnId(o.id)
                        requestAnimationFrame(() => sqlRef.current?.focus())
                      }}
                    >
                      <span className="mono">{o.label}</span>
                      <span style={{ opacity: 0.75 }}>{` — ${o.connectionPreview}`}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="terminalHeaderActions">
            <button
              type="button"
              className="iconBtn"
              onClick={() => setDrawerPosition(prev => (prev === 'left' ? 'bottom' : 'left'))}
              aria-label={isLeftPosition ? 'Move terminal to bottom' : 'Move terminal to left'}
              title={isLeftPosition ? 'Move to bottom' : 'Move to left'}
              disabled={busy || !open}
            >
              {isLeftPosition ? 'BT' : 'LF'}
            </button>
            <button
              type="button"
              className="iconBtn"
              onClick={() => {
                setOutput([])
                setResultRows(null)
                setResultColumns(null)
                setResultHint(null)
                setLastRunSchemaTableLabel(null)
                setSql('')
                requestAnimationFrame(() => sqlRef.current?.focus())
              }}
              aria-label="Clear output"
              title="Clear"
              disabled={busy || !open}
            >
              ⟲
            </button>
            <button type="button" className="iconBtn" onClick={onClose} aria-label="Close" title="Close">
              ✕
            </button>
          </div>
        </header>

        <div
          ref={bodyRef}
          className="sqlTerminalBody"
          style={{ gridTemplateColumns: `${Math.round(splitLeftFraction * 1000)}fr 8px ${Math.round((1 - splitLeftFraction) * 1000)}fr` }}
        >
          <div className="sqlTerminalPane sqlTerminalPaneSql">
            <div className="sqlTerminalPaneTitle mono">
              <div className="sqlTerminalPaneTitleLeft">
                <span>SQL</span>
                <div ref={schemaMenuOpen ? schemaMenuWrapRef : null} className="selectMenuWrap sqlTerminalSchemaMenu">
                  <button
                    type="button"
                    className="selectMenuBtn mono"
                    disabled={!schemas.length || (selectedConn?.type !== 'postgres')}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!schemas.length) return
                      if (schemaMenuOpen) {
                        setSchemaMenuOpen(false)
                        return
                      }
                      openSchemaMenu(e.currentTarget)
                    }}
                    aria-haspopup="menu"
                    aria-expanded={schemaMenuOpen}
                    aria-label="Schema"
                    title="Schema"
                  >
                    {selectedConn?.type !== 'postgres' ? 'Schema' : (selectedSchema || 'Schema')}
                  </button>
                  {schemaMenuOpen ? (
                    <div
                      className={`selectMenuPanel sqlTerminalSchemaPanel ${schemaMenuPlacement === 'above' ? 'sqlTerminalSchemaPanelAbove' : ''}`.trim()}
                      role="menu"
                      style={{ maxHeight: `${schemaMenuMaxHeight}px`, overflowY: 'auto' }}
                      onPointerDown={e => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                    >
                      {schemas.map(s => (
                        <button
                          key={s}
                          type="button"
                          className={`selectMenuItem ${selectedSchema === s ? 'selectMenuItemActive' : ''}`}
                          role="menuitem"
                          onClick={() => {
                            setSchemaMenuOpen(false)
                            setSelectedSchema(s)
                            requestAnimationFrame(() => sqlRef.current?.focus())
                          }}
                        >
                          <span className="mono">{s}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className="iconBtn sqlTerminalPlayBtn"
                onClick={() => void run()}
                disabled={busy || !open || !selectedConn || !sql.trim()}
                aria-label="Run SQL"
                title={busy ? 'Running…' : 'Run (Ctrl+Enter). Selection/current statement. Trailing ; is optional.'}
              >
                ▶
              </button>
            </div>
            <div ref={editorWrapRef} className={`sqlTerminalEditorWrap ${tableSuggestOpen && suggestMode === 'table' ? 'sqlTerminalEditorWrapSuggestingTable' : ''}`.trim()} style={editorWrapStyle}>
              <div className="sqlTerminalLineNumbers" aria-hidden="true">
                <pre ref={lineNumbersRef} className="sqlTerminalLineNumbersInner mono">
                  {lineNumbers.map(n => (
                    <span key={n} className={n === activeLine ? 'sqlTerminalLineNumber sqlTerminalLineNumberActive' : 'sqlTerminalLineNumber'}>
                      {n}
                    </span>
                  ))}
                </pre>
              </div>
              <textarea
                ref={sqlRef}
                className="sqlTerminalEditor mono"
                value={sql}
                disabled={!open || busy}
                onChange={e => {
                  const nextText = e.target.value
                  const caret = e.target.selectionStart ?? 0

                  const hist = editHistoryRef.current
                  if (!hist.applying) {
                    const current = hist.stack[hist.index]?.text ?? ''
                    if (current !== nextText) {
                      const nextEntry = { text: nextText, caret }
                      const base = hist.stack.slice(0, hist.index + 1)
                      const nextStack = clampHistory([...base, nextEntry], 20)
                      const nextIndex = nextStack.length - 1
                      editHistoryRef.current = { stack: nextStack, index: nextIndex, applying: false }
                    }
                  }

                  setCursorPos(caret)
                  setSql(nextText)
                  requestAnimationFrame(refreshEditorCaretState)
                }}
                onKeyUp={refreshEditorCaretState}
                onClick={refreshEditorCaretState}
                onSelect={refreshEditorCaretState}
                onScroll={() => {
                  syncLineNumberScroll()
                  updateTableSuggestPopupPosition()
                }}
                onKeyDown={e => {
                  const isUndo = (e.ctrlKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'z') || (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'z')
                  const isRedo =
                    (e.ctrlKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'y') ||
                    (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'z') ||
                    (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')

                  if (isUndo) {
                    e.preventDefault()
                    e.stopPropagation()
                    const hist = editHistoryRef.current
                    if (hist.index > 0) {
                      const nextIndex = hist.index - 1
                      const entry = hist.stack[nextIndex]
                      editHistoryRef.current = { ...hist, index: nextIndex, applying: true }
                      pendingCaretRef.current = entry.caret
                      setSql(entry.text)
                      requestAnimationFrame(() => {
                        const h = editHistoryRef.current
                        editHistoryRef.current = { ...h, applying: false }
                      })
                    }
                    return
                  }

                  if (isRedo) {
                    e.preventDefault()
                    e.stopPropagation()
                    const hist = editHistoryRef.current
                    if (hist.index < hist.stack.length - 1) {
                      const nextIndex = hist.index + 1
                      const entry = hist.stack[nextIndex]
                      editHistoryRef.current = { ...hist, index: nextIndex, applying: true }
                      pendingCaretRef.current = entry.caret
                      setSql(entry.text)
                      requestAnimationFrame(() => {
                        const h = editHistoryRef.current
                        editHistoryRef.current = { ...h, applying: false }
                      })
                    }
                    return
                  }

                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    void run()
                    return
                  }

                  const activeSuggestions = suggestMode === 'column' ? columnSuggestions : tableSuggestions
                  if (tableSuggestOpen && activeSuggestions.length) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      e.stopPropagation()
                      setTableSuggestActiveIndex(prev => (prev == null ? 0 : (prev + 1) % activeSuggestions.length))
                      return
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      e.stopPropagation()
                      setTableSuggestActiveIndex(prev => (prev == null ? 0 : (prev - 1 + activeSuggestions.length) % activeSuggestions.length))
                      return
                    }
                    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
                      if (tableSuggestActiveIndex == null) return
                      e.preventDefault()
                      e.stopPropagation()
                      if (suggestMode === 'column') applyColumnSuggestionAt(tableSuggestActiveIndex)
                      else applyTableSuggestionAt(tableSuggestActiveIndex)
                      return
                    }
                  }
                }}
                placeholder={
                  connOptions.length
                    ? 'Write SQL here… (Ctrl+Enter: selection/current statement; trailing ; optional)'
                    : 'Configure DB connection in App Settings or Collection Environment…'
                }
                wrap="off"
                spellCheck={false}
              />

              {open && tableSuggestOpen && tableSuggestReplaceRange && tableSuggestPopupPos ? (
                <div
                  ref={tableSuggestRef}
                  className={`sqlTerminalTableSuggest selectMenuPanel ${suggestMode === 'table' ? 'sqlTerminalTableSuggestTable' : 'sqlTerminalTableSuggestColumn'}`.trim()}
                  role="listbox"
                  style={{ top: `${tableSuggestPopupPos.top}px`, left: `${tableSuggestPopupPos.left}px`, right: 'auto' }}
                  onPointerDown={e => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={e => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                >
                  {suggestMode === 'column' ? (
                    columnSuggestions.length ? (
                      columnSuggestions.map((c, idx) => (
                        <button
                          key={c}
                          type="button"
                          className={`selectMenuItem ${idx === tableSuggestActiveIndex ? 'selectMenuItemActive' : ''}`.trim()}
                          role="option"
                          onClick={() => {
                            setTableSuggestActiveIndex(idx)
                            applyColumnSuggestionAt(idx)
                          }}
                        >
                          <span className="mono">{c}</span>
                        </button>
                      ))
                    ) : (
                      <div className="selectMenuItem" style={{ cursor: 'default', opacity: 0.75 }}>
                        {columnLoading ? 'Loading columns…' : 'No matches'}
                      </div>
                    )
                  ) : (
                    tableSuggestions.length ? (
                      tableSuggestions.map((t, idx) => (
                        <button
                          key={t}
                          type="button"
                          className={`selectMenuItem ${idx === tableSuggestActiveIndex ? 'selectMenuItemActive' : ''}`.trim()}
                          role="option"
                          onClick={() => {
                            setTableSuggestActiveIndex(idx)
                            applyTableSuggestionAt(idx)
                          }}
                        >
                          <span className="mono">{t}</span>
                        </button>
                      ))
                    ) : (
                      <div className="selectMenuItem" style={{ cursor: 'default', opacity: 0.75 }}>
                        No matches
                      </div>
                    )
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <div className="sqlTerminalDivider" onPointerDown={onSplitHandlePointerDown} />
          <div className="sqlTerminalPane">
            <div className="sqlTerminalPaneTitle mono">
              <span>Output</span>
              {lastRunSchemaTableLabel ? <span className="sqlTerminalPaneTitleCenter" title={lastRunSchemaTableLabel}>{lastRunSchemaTableLabel}</span> : null}
              {resultHint ? <span style={{ opacity: 0.75 }}>{resultHint}</span> : null}
            </div>
            <div
              ref={outputRef}
              className="sqlTerminalOutput mono"
              role="log"
              aria-live="polite"
              onPointerDown={() => sqlRef.current?.focus()}
            >
              {effectiveResultColumns.length ? (
                <div className="sqlTerminalTableWrap">
                  <table className="sqlTerminalTable">
                    <thead>
                      <tr>
                        {effectiveResultColumns.map(c => (
                          <th key={c} className="mono" title={c}>
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(resultRows ?? []).slice(0, 500).map((row, idx) => (
                        <tr key={idx}>
                          {effectiveResultColumns.map(c => {
                            const v = (row as Record<string, unknown>)[c]
                            const text = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
                            return (
                              <td key={c} title={text}>
                                {text}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(resultRows?.length ?? 0) > 500 ? (
                    <div className="terminalLine terminalLine_sys" style={{ marginTop: 8 }}>
                      Showing first 500 rows.
                    </div>
                  ) : null}
                </div>
              ) : output.length ? (
                output.map((e, i) => (
                  <div key={i} className={`terminalLine terminalLine_${e.kind}`}>
                    {e.text}
                  </div>
                ))
              ) : (
                <div className="terminalLine terminalLine_sys">Run a query to see output.</div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
