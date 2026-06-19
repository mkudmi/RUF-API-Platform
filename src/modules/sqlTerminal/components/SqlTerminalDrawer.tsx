import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useDismissibleLayer } from '../../../shared/hooks/useDismissibleLayer'
import { logError, logWarn } from '../../../shared/utils/logger'
import { enhanceSqlWithYandex } from '../../ai/provider'
import { getPostgresMcpServer } from '../../mcp/services/mcp'
import {
  SQL_AI_INLINE_PROMPT_KEY,
  SQL_TERMINAL_HEIGHT_KEY,
  SQL_TERMINAL_MIN_HEIGHT_PX,
  SQL_TERMINAL_MIN_WIDTH_PX,
  SQL_TERMINAL_PAGE_SIZE,
  SQL_TERMINAL_POSITION_KEY,
  SQL_TERMINAL_SCHEMA_KEY,
  SQL_TERMINAL_SELECTED_CONN_KEY,
  SQL_TERMINAL_SPLIT_KEY,
  SQL_TERMINAL_SQL_KEY,
  SQL_TERMINAL_WIDTH_KEY,
} from '../constants'
import { useSqlTerminalEditorHistory } from '../hooks/useSqlTerminalEditorHistory'
import {
  initializeSqlAiAssistantContext,
  initializeSqlAiAssistantContextFromDb,
  respondWithSqlAiAssistant,
  type SqlAiAssistantContext,
  type SqlAiConversationMessage,
} from '../services/sqlAiAgent'
import {
  loadSqlTerminalColumns,
  loadSqlTerminalSchemas,
  loadSqlTerminalTables,
  preloadSqlTerminalColumns,
} from '../services/sqlTerminalMetadata'
import type { DbConnOption, ExecuteSqlOptions, OutputEntry, PopupPosition, ResultPagingState, SqlTerminalDrawerProps } from '../types'
import { buildDbConnOptions, resolveFallbackPostgresConnectionString } from '../utils/connections'
import {
  getSqlTerminalBaseHeightPx,
  getSqlTerminalBaseWidthPx,
  getSqlTerminalMaxHeightPx,
  getSqlTerminalMaxWidthPx,
} from '../utils/layout'
import {
  applySchemaToTableRefs,
  applyVariables,
  buildSchemaAwareSql,
  extractSchemaTableLabel,
  formatTime,
  getCurrentSqlStatement,
  looksLikeSelectOrWith,
  makeTableAlias,
  parseFromAndJoinAliases,
  stripQuotes,
  trimTrailingSemicolons,
  wrapSqlForPage,
} from '../utils/sql'
import { safeLoadFraction, safeLoadNumber, safeLoadString, safeRemove, safeSave } from '../utils/storage'
import { SqlAiAssistantDialog } from './SqlAiAssistantDialog'
import { SqlTerminalEditorPane } from './drawer/SqlTerminalEditorPane'
import { SqlTerminalHeader } from './drawer/SqlTerminalHeader'
import { SqlTerminalOutputPane } from './drawer/SqlTerminalOutputPane'
import { runDbSql } from '../../environment'

export function SqlTerminalDrawer(props: SqlTerminalDrawerProps) {
  const { open, onClose } = props

  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [sqlAiDialogOpen, setSqlAiDialogOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [schemaMenuOpen, setSchemaMenuOpen] = useState(false)
  const [aiMenuOpen, setAiMenuOpen] = useState(false)
  const [schemaMenuPlacement, setSchemaMenuPlacement] = useState<'below' | 'above'>('below')
  const [schemaMenuMaxHeight, setSchemaMenuMaxHeight] = useState<number>(220)
  const [heightPx, setHeightPx] = useState<number | null>(() => safeLoadNumber(SQL_TERMINAL_HEIGHT_KEY))
  const [widthPx, setWidthPx] = useState<number | null>(() => safeLoadNumber(SQL_TERMINAL_WIDTH_KEY))
  const [drawerPosition, setDrawerPosition] = useState<'bottom' | 'left'>(() => (safeLoadString(SQL_TERMINAL_POSITION_KEY) === 'left' ? 'left' : 'bottom'))
  const [selectedConnId, setSelectedConnId] = useState<string | null>(() => safeLoadString(SQL_TERMINAL_SELECTED_CONN_KEY))
  const [sql, setSql] = useState(() => safeLoadString(SQL_TERMINAL_SQL_KEY) ?? '')
  const [sqlAiPrompt, setSqlAiPrompt] = useState(() => safeLoadString(SQL_AI_INLINE_PROMPT_KEY) ?? '')
  const [output, setOutput] = useState<OutputEntry[]>([])
  const [resultRows, setResultRows] = useState<Array<Record<string, unknown>> | null>(null)
  const [resultColumns, setResultColumns] = useState<string[] | null>(null)
  const [resultHint, setResultHint] = useState<string | null>(null)
  const [lastRunSchemaTableLabel, setLastRunSchemaTableLabel] = useState<string | null>(null)
  const [paging, setPaging] = useState<ResultPagingState>({ enabled: false, loading: false, hasMore: false, loadAll: false, baseSql: '' })
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
  const [sqlAiInlineContext, setSqlAiInlineContext] = useState<SqlAiAssistantContext | null>(null)
  const [sqlAiInlineContextSignature, setSqlAiInlineContextSignature] = useState<string | null>(null)

  const menuWrapRef = useRef<HTMLDivElement | null>(null)
  const schemaMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const aiMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const editorWrapRef = useRef<HTMLDivElement | null>(null)
  const sqlRef = useRef<HTMLTextAreaElement | null>(null)
  const lineNumbersRef = useRef<HTMLPreElement | null>(null)
  const sqlAiPromptRef = useRef<HTMLInputElement | null>(null)
  const tableSuggestRef = useRef<HTMLDivElement | null>(null)
  const outputRef = useRef<HTMLDivElement | null>(null)
  const resetTableScrollOnNextResultRef = useRef(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const runRef = useRef<(() => void) | null>(null)
  const sectionRef = useRef<HTMLElement | null>(null)

  const {
    pendingCaretRef,
    recordProgrammaticChange,
    recordInputChange,
    undo,
    redo,
    finishApplying,
  } = useSqlTerminalEditorHistory(sql)

  const focusEditorSoon = useCallback(() => {
    requestAnimationFrame(() => sqlRef.current?.focus())
  }, [])

  const connOptions = useMemo(
    () => buildDbConnOptions(props.collections, props.environmentsByCollection, props.extraConnections),
    [props.collections, props.environmentsByCollection, props.extraConnections],
  )
  const selectedConn = useMemo(() => connOptions.find(conn => conn.id === selectedConnId) ?? null, [connOptions, selectedConnId])
  const selectedConnection = useMemo(
    () => (selectedConn ? { type: selectedConn.type, connectionString: selectedConn.connectionString } : null),
    [selectedConn],
  )
  const sqlAiInitSignature = useMemo(() => {
    const postgresServer = getPostgresMcpServer(props.mcpSettings)
    return JSON.stringify({
      selectedSchema: selectedSchema.trim(),
      fallbackConnectionString: resolveFallbackPostgresConnectionString(props.mcpSettings, selectedConnection),
      postgresServer: postgresServer
        ? {
            command: postgresServer.command,
            args: postgresServer.args,
            envEntries: postgresServer.envEntries ?? [],
            env: postgresServer.env,
          }
        : null,
    })
  }, [props.mcpSettings, selectedConnection, selectedSchema])
  const lineCount = useMemo(() => Math.max(1, sql.split('\n').length), [sql])
  const lineNumberDigits = useMemo(() => Math.max(2, String(lineCount).length), [lineCount])
  const lineNumbers = useMemo(() => Array.from({ length: lineCount }, (_value, index) => index + 1), [lineCount])
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
  const editorBusy = busy || aiBusy
  const effectiveResultColumns = useMemo(() => {
    if (resultColumns?.length) return resultColumns
    if (!resultRows?.length) return []
    return Object.keys(resultRows[0] ?? {})
  }, [resultColumns, resultRows])
  const tableSuggestions = useMemo(() => {
    const prefix = tableSuggestPrefix.toLowerCase()
    if (!prefix) return tables.slice(0, 80)
    return tables.filter(table => table.toLowerCase().includes(prefix)).slice(0, 80)
  }, [tableSuggestPrefix, tables])
  const columnSuggestions = useMemo(() => {
    if (!columnTargetTableKey) return []
    const columns = columnsByTableKey[columnTargetTableKey] ?? []
    const prefix = tableSuggestPrefix.toLowerCase()
    if (!prefix) return columns.slice(0, 120)
    return columns.filter(column => column.toLowerCase().includes(prefix)).slice(0, 120)
  }, [columnTargetTableKey, columnsByTableKey, tableSuggestPrefix])

  const syncLineNumberScroll = useCallback(() => {
    const textarea = sqlRef.current
    const lines = lineNumbersRef.current
    if (!textarea || !lines) return
    lines.style.transform = `translateY(${-textarea.scrollTop}px)`
  }, [])

  const refreshEditorCaretState = useCallback(() => {
    setCursorPos(sqlRef.current?.selectionStart ?? 0)
    syncLineNumberScroll()
  }, [syncLineNumberScroll])

  const updateTableSuggestPopupPosition = useCallback(() => {
    if (!tableSuggestOpen) return
    const textarea = sqlRef.current
    const wrap = editorWrapRef.current
    if (!textarea || !wrap) return

    const pos = textarea.selectionStart ?? 0
    const before = textarea.value.slice(0, pos)
    const lines = before.split('\n')
    const lineIndex = Math.max(0, lines.length - 1)
    const currentLine = lines[lineIndex] ?? ''
    const computedStyle = window.getComputedStyle(textarea)
    const font = `${computedStyle.fontStyle} ${computedStyle.fontVariant} ${computedStyle.fontWeight} ${computedStyle.fontSize} / ${computedStyle.lineHeight} ${computedStyle.fontFamily}`
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 17.4
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0
    const paddingLeft = Number.parseFloat(computedStyle.paddingLeft) || 0

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.font = font
    const textWidth = ctx.measureText(currentLine).width

    const caretX = paddingLeft + textWidth - textarea.scrollLeft
    const caretY = paddingTop + lineIndex * lineHeight - textarea.scrollTop
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

  const pushOutput = useCallback((entries: OutputEntry[]) => {
    if (!entries.length) return
    setOutput(prev => [...prev, ...entries])
  }, [])

  const applySqlText = useCallback((nextText: string, nextCaret = nextText.length) => {
    recordProgrammaticChange(nextText, nextCaret)
    setSql(nextText)
  }, [recordProgrammaticChange])

  const appendSqlText = useCallback((snippet: string) => {
    const cleanSnippet = snippet.trim()
    if (!cleanSnippet) return

    let nextText = sql
    if (sql.trim().length > 0) {
      if (!nextText.endsWith('\n')) nextText += '\n'
      if (!nextText.endsWith('\n\n')) nextText += '\n'
    }
    nextText += cleanSnippet
    applySqlText(nextText, nextText.length)
  }, [applySqlText, sql])

  const clearTerminal = useCallback(() => {
    setOutput([])
    setResultRows(null)
    setResultColumns(null)
    setResultHint(null)
    setLastRunSchemaTableLabel(null)
    setPaging({ enabled: false, loading: false, hasMore: false, loadAll: false, baseSql: '' })
    applySqlText('', 0)
    focusEditorSoon()
  }, [applySqlText, focusEditorSoon])

  const loadColumnsForTable = useCallback(async (conn: DbConnOption, schema: string, tableName: string) => {
    if (conn.type !== 'postgres' || !schema || !tableName) return
    const key = `${schema}.${tableName}`
    if (columnsByTableKey[key]) return

    setColumnLoading(true)
    try {
      const names = await loadSqlTerminalColumns(conn, schema, tableName)
      setColumnsByTableKey(prev => ({ ...prev, [key]: names }))
    } finally {
      setColumnLoading(false)
    }
  }, [columnsByTableKey])

  const openSchemaMenu = useCallback((anchorEl: HTMLElement) => {
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
  }, [])

  const runQuery = useCallback(async (raw: string, options: ExecuteSqlOptions) => {
    const conn = selectedConn
    if (!conn) {
      pushOutput([{ kind: 'err', text: 'No database connection selected. Configure connection in App Settings or Collection Environment.' }])
      return
    }
    if (!raw) {
      pushOutput([{ kind: 'sys', text: 'Nothing to run.' }])
      return
    }

    setLastRunSchemaTableLabel(extractSchemaTableLabel(raw, selectedSchema))
    const startedAt = new Date()
    resetTableScrollOnNextResultRef.current = true
    pushOutput([{ kind: 'in', text: `-- ${formatTime(startedAt)} ${conn.label} (${conn.type}) [${options.scopeLabel}]` }])
    setResultRows(null)
    setResultColumns(null)
    setResultHint(null)
    setPaging({ enabled: false, loading: false, hasMore: false, loadAll: false, baseSql: '' })
    if (outputRef.current) outputRef.current.scrollTop = 0

    setBusy(true)
    try {
      let hasFreshTableResult = false
      const renderedSql = applyVariables(raw, conn.variables)
      const renderedSqlWithSchema = conn.type === 'postgres' && selectedSchema ? applySchemaToTableRefs(renderedSql, selectedSchema) : renderedSql
      const isPagedSelect = conn.type === 'postgres' && looksLikeSelectOrWith(renderedSqlWithSchema)
      const baseSql = trimTrailingSemicolons(renderedSqlWithSchema)
      const sqlForResultFetch = isPagedSelect ? wrapSqlForPage(baseSql, 0, SQL_TERMINAL_PAGE_SIZE + 1) : renderedSqlWithSchema
      const sqlToRun = conn.type === 'postgres' && selectedSchema ? buildSchemaAwareSql(sqlForResultFetch, selectedSchema) : sqlForResultFetch
      const result = await runDbSql({ type: conn.type, connectionString: conn.connectionString, sql: sqlToRun, timeoutMs: 30_000 })

      pushOutput([{ kind: result.ok ? 'out' : 'err', text: `${result.ok ? 'OK' : 'ERROR'}: ${result.message || ''} (${result.durationMs}ms)` }])

      if (result.ok && Array.isArray(result.columns) && result.columns.length) {
        setResultColumns(result.columns)
        hasFreshTableResult = true
      }

      if (result.ok && Array.isArray(result.rows)) {
        const hasMore = isPagedSelect && result.rows.length > SQL_TERMINAL_PAGE_SIZE
        const visibleRows = hasMore ? result.rows.slice(0, SQL_TERMINAL_PAGE_SIZE) : result.rows
        if (visibleRows.length && typeof visibleRows[0] === 'object' && visibleRows[0] != null && !Array.isArray(visibleRows[0])) {
          setResultRows(visibleRows as Array<Record<string, unknown>>)
          setResultHint(`${visibleRows.length} row(s)${hasMore ? '+' : ''}`)
          setPaging(isPagedSelect ? { enabled: true, loading: false, hasMore, loadAll: false, baseSql } : { enabled: false, loading: false, hasMore: false, loadAll: false, baseSql: '' })
          hasFreshTableResult = true
        } else if (!result.rows.length) {
          setResultHint((result.columns?.length ?? 0) > 0 ? '0 row(s)' : '0 row(s)')
          setPaging(isPagedSelect ? { enabled: true, loading: false, hasMore: false, loadAll: false, baseSql } : { enabled: false, loading: false, hasMore: false, loadAll: false, baseSql: '' })
          if ((result.columns?.length ?? 0) > 0) {
            setResultRows([])
            hasFreshTableResult = true
          }
        }
      } else if (result.ok && typeof result.rowsAffected === 'number') {
        setResultHint(`${result.rowsAffected} affected`)
      }

      if (!hasFreshTableResult) resetTableScrollOnNextResultRef.current = false
    } catch (error) {
      resetTableScrollOnNextResultRef.current = false
      pushOutput([{ kind: 'err', text: error instanceof Error ? error.message : String(error) }])
    } finally {
      setBusy(false)
      focusEditorSoon()
    }
  }, [focusEditorSoon, pushOutput, selectedConn, selectedSchema])

  const run = useCallback(async () => {
    if (editorBusy) return
    const textarea = sqlRef.current
    const selectionStart = textarea ? Math.max(0, Math.min(textarea.selectionStart ?? 0, textarea.selectionEnd ?? 0)) : 0
    const selectionEnd = textarea ? Math.max(0, Math.max(textarea.selectionStart ?? 0, textarea.selectionEnd ?? 0)) : 0
    const selectedSql = selectionEnd > selectionStart ? sql.slice(selectionStart, selectionEnd).trim() : ''
    const statementSql = selectedSql ? '' : (getCurrentSqlStatement(sql, textarea?.selectionStart ?? cursorPos) ?? '')
    const raw = (selectedSql || statementSql || sql).trim()
    const scopeLabel: ExecuteSqlOptions['scopeLabel'] = selectedSql ? 'selection' : (statementSql ? 'statement' : 'script')
    await runQuery(raw, { scopeLabel })
  }, [cursorPos, editorBusy, runQuery, sql])

  const loadMoreRows = useCallback(async (loadAll: boolean) => {
    if (editorBusy || !paging.enabled || !paging.hasMore || paging.loading) return
    if (!selectedConn || selectedConn.type !== 'postgres') return

    const alreadyLoaded = resultRows?.length ?? 0
    const currentBaseSql = paging.baseSql
    setPaging(prev => ({ ...prev, loading: true, loadAll }))

    let offset = alreadyLoaded
    const loadedChunks: Array<Record<string, unknown>> = []
    let hasMore = false

    try {
      while (true) {
        const sqlForResultFetch = wrapSqlForPage(currentBaseSql, offset, SQL_TERMINAL_PAGE_SIZE + 1)
        const sqlToRun = selectedSchema ? buildSchemaAwareSql(sqlForResultFetch, selectedSchema) : sqlForResultFetch
        const result = await runDbSql({ type: selectedConn.type, connectionString: selectedConn.connectionString, sql: sqlToRun, timeoutMs: 30_000 })

        if (!result.ok) {
          pushOutput([{ kind: 'err', text: `ERROR: ${result.message || ''} (${result.durationMs}ms)` }])
          hasMore = true
          break
        }

        const rows = result.rows ?? []
        if (!Array.isArray(rows) || !rows.length) {
          hasMore = false
          break
        }

        const nextHasMore = rows.length > SQL_TERMINAL_PAGE_SIZE
        const visibleRows = (nextHasMore ? rows.slice(0, SQL_TERMINAL_PAGE_SIZE) : rows).filter(
          row => typeof row === 'object' && row != null && !Array.isArray(row),
        ) as Array<Record<string, unknown>>

        if (!visibleRows.length) {
          hasMore = false
          break
        }

        loadedChunks.push(...visibleRows)
        offset += visibleRows.length
        hasMore = nextHasMore

        if (!loadAll || !nextHasMore) break
      }
    } catch (error) {
      pushOutput([{ kind: 'err', text: error instanceof Error ? error.message : String(error) }])
      hasMore = true
    } finally {
      setResultRows(prev => {
        const next = [...(prev ?? []), ...loadedChunks]
        setResultHint(`${next.length} row(s)${hasMore ? '+' : ''}`)
        return next
      })
      setPaging(prev => ({ ...prev, loading: false, hasMore, loadAll: loadAll && hasMore }))
    }
  }, [editorBusy, paging, pushOutput, resultRows, selectedConn, selectedSchema])

  const onOutputScroll = useCallback(() => {
    const element = outputRef.current
    if (!element || editorBusy || paging.loading || !paging.enabled || !paging.hasMore || paging.loadAll) return
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight
    if (remaining > 120) return
    void loadMoreRows(false)
  }, [editorBusy, loadMoreRows, paging])

  const handleEnhanceSqlWithAi = useCallback(async () => {
    const rawSql = sql.trim()
    setAiMenuOpen(false)

    if (aiBusy || busy) return
    if (!rawSql) {
      pushOutput([{ kind: 'sys', text: 'Nothing to enhance.' }])
      return
    }
    if (!props.aiSettings.enabled) {
      pushOutput([{ kind: 'err', text: 'AI is disabled in Settings.' }])
      return
    }

    setAiBusy(true)
    pushOutput([{ kind: 'sys', text: 'AI is checking the SQL script…' }])

    try {
      const result = await enhanceSqlWithYandex(props.aiSettings, {
        sql,
        dialect: selectedConn?.type ?? 'postgres',
        schema: selectedConn?.type === 'postgres' ? selectedSchema : undefined,
      })
      applySqlText(result.sql)
      pushOutput([{ kind: 'out', text: result.summary || 'AI enhancement completed.' }])
    } catch (error) {
      pushOutput([{ kind: 'err', text: error instanceof Error ? error.message : String(error) }])
    } finally {
      setAiBusy(false)
      focusEditorSoon()
    }
  }, [aiBusy, applySqlText, busy, focusEditorSoon, props.aiSettings, pushOutput, selectedConn, selectedSchema, sql])

  const getSqlAiInlineContext = useCallback(async () => {
    if (sqlAiInlineContext && sqlAiInlineContextSignature === sqlAiInitSignature) {
      return sqlAiInlineContext
    }

    try {
      const nextContext = await initializeSqlAiAssistantContext(props.mcpSettings, { selectedSchema })
      setSqlAiInlineContext(nextContext)
      setSqlAiInlineContextSignature(sqlAiInitSignature)
      return nextContext
    } catch (mcpError) {
      const fallbackConnectionString = resolveFallbackPostgresConnectionString(props.mcpSettings, selectedConnection)
      if (!fallbackConnectionString) throw mcpError

      const nextContext = await initializeSqlAiAssistantContextFromDb({
        connectionString: fallbackConnectionString,
        selectedSchema,
      })
      setSqlAiInlineContext(nextContext)
      setSqlAiInlineContextSignature(sqlAiInitSignature)
      return nextContext
    }
  }, [props.mcpSettings, selectedConnection, selectedSchema, sqlAiInitSignature, sqlAiInlineContext, sqlAiInlineContextSignature])

  const handleInlineSqlAiPrompt = useCallback(async () => {
    const userMessage = sqlAiPrompt.trim()
    if (editorBusy || !userMessage) return

    if (!props.aiSettings.enabled) {
      pushOutput([{ kind: 'err', text: 'AI is disabled in Settings.' }])
      return
    }

    setAiBusy(true)
    pushOutput([{ kind: 'sys', text: 'SQL AI is preparing a script…' }])

    try {
      const context = await getSqlAiInlineContext()
      const conversation: SqlAiConversationMessage[] = []
      const result = await respondWithSqlAiAssistant({
        aiSettings: props.aiSettings,
        context,
        conversation,
        userMessage,
        selectedSchema,
        currentSql: sql,
      })

      setSqlAiInlineContext(result.context)
      setSqlAiInlineContextSignature(sqlAiInitSignature)

      if (!result.sqlToInsert) {
        pushOutput([{ kind: 'out', text: result.reply }])
        return
      }

      appendSqlText(result.sqlToInsert)
      setSqlAiPrompt('')
      pushOutput([{ kind: 'out', text: result.reply }])
      await runQuery(result.sqlToInsert.trim(), { scopeLabel: 'ai' })
    } catch (error) {
      pushOutput([{ kind: 'err', text: error instanceof Error ? error.message : String(error) }])
    } finally {
      setAiBusy(false)
      requestAnimationFrame(() => sqlAiPromptRef.current?.focus())
    }
  }, [appendSqlText, editorBusy, getSqlAiInlineContext, props.aiSettings, pushOutput, runQuery, sql, sqlAiInitSignature, sqlAiPrompt, selectedSchema])

  const applyTableSuggestionAt = useCallback((index: number) => {
    const range = tableSuggestReplaceRange
    const table = tableSuggestions[index]
    if (!range || !table) return
    const needsLeadingSpace = /(from|into|join)$/i.test(sql.slice(0, range.start))
    const tableRef = tableSuggestKind === 'into' ? table : `${table} ${makeTableAlias(table)}`
    const insert = `${needsLeadingSpace ? ' ' : ''}${tableRef}`
    const next = `${sql.slice(0, range.start)}${insert}${sql.slice(range.end)}`
    setTableSuggestActiveIndex(index)
    setTableSuggestOpen(false)
    applySqlText(next, range.start + insert.length)
  }, [applySqlText, sql, tableSuggestKind, tableSuggestReplaceRange, tableSuggestions])

  const applyColumnSuggestionAt = useCallback((index: number) => {
    const range = tableSuggestReplaceRange
    const column = columnSuggestions[index]
    if (!range || !column) return
    const next = `${sql.slice(0, range.start)}${column}${sql.slice(range.end)}`
    setTableSuggestActiveIndex(index)
    setTableSuggestOpen(false)
    applySqlText(next, range.start + column.length)
  }, [applySqlText, columnSuggestions, sql, tableSuggestReplaceRange])

  const handleEditorKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isUndo = (event.ctrlKey && !event.shiftKey && !event.metaKey && event.key.toLowerCase() === 'z') || (event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'z')
    const isRedo =
      (event.ctrlKey && !event.shiftKey && !event.metaKey && event.key.toLowerCase() === 'y')
      || (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'z')
      || (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z')

    if (isUndo) {
      event.preventDefault()
      event.stopPropagation()
      const entry = undo()
      if (entry) {
        setSql(entry.text)
        requestAnimationFrame(finishApplying)
      }
      return
    }

    if (isRedo) {
      event.preventDefault()
      event.stopPropagation()
      const entry = redo()
      if (entry) {
        setSql(entry.text)
        requestAnimationFrame(finishApplying)
      }
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      void run()
      return
    }

    const activeSuggestions = suggestMode === 'column' ? columnSuggestions : tableSuggestions
    if (!tableSuggestOpen || !activeSuggestions.length) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      setTableSuggestActiveIndex(prev => (prev == null ? 0 : (prev + 1) % activeSuggestions.length))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      setTableSuggestActiveIndex(prev => (prev == null ? 0 : (prev - 1 + activeSuggestions.length) % activeSuggestions.length))
      return
    }
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      if (tableSuggestActiveIndex == null) return
      event.preventDefault()
      event.stopPropagation()
      if (suggestMode === 'column') applyColumnSuggestionAt(tableSuggestActiveIndex)
      else applyTableSuggestionAt(tableSuggestActiveIndex)
    }
  }, [applyColumnSuggestionAt, applyTableSuggestionAt, columnSuggestions, finishApplying, redo, run, suggestMode, tableSuggestActiveIndex, tableSuggestOpen, tableSuggestions, undo])

  useEffect(() => {
    if (!open) return
    focusEditorSoon()
  }, [focusEditorSoon, open])

  useEffect(() => {
    if (open) return
    setSqlAiDialogOpen(false)
  }, [open])

  useEffect(() => {
    runRef.current = () => void run()
  }, [run])

  useEffect(() => {
    const pendingCaret = pendingCaretRef.current
    if (pendingCaret == null) return
    pendingCaretRef.current = null
    const textarea = sqlRef.current
    if (!textarea) return
    textarea.focus()
    textarea.selectionStart = pendingCaret
    textarea.selectionEnd = pendingCaret
    setCursorPos(pendingCaret)
    requestAnimationFrame(syncLineNumberScroll)
  }, [sql, pendingCaretRef, syncLineNumberScroll])

  useEffect(() => {
    requestAnimationFrame(syncLineNumberScroll)
  }, [lineCount, open, syncLineNumberScroll])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  useDismissibleLayer({
    open: menuOpen,
    onDismiss: () => setMenuOpen(false),
    isInsideTarget: target => !!(target && menuWrapRef.current?.contains(target)),
  })

  useDismissibleLayer({
    open: schemaMenuOpen,
    onDismiss: () => setSchemaMenuOpen(false),
    isInsideTarget: target => !!(target && schemaMenuWrapRef.current?.contains(target)),
  })

  useDismissibleLayer({
    open: aiMenuOpen,
    onDismiss: () => setAiMenuOpen(false),
    isInsideTarget: target => !!(target && aiMenuWrapRef.current?.contains(target)),
  })

  useEffect(() => {
    if (heightPx != null) safeSave(SQL_TERMINAL_HEIGHT_KEY, String(heightPx))
  }, [heightPx])

  useEffect(() => {
    if (widthPx != null) safeSave(SQL_TERMINAL_WIDTH_KEY, String(widthPx))
  }, [widthPx])

  useEffect(() => {
    safeSave(SQL_TERMINAL_POSITION_KEY, drawerPosition)
  }, [drawerPosition])

  useEffect(() => {
    if (!open) return

    function clampToViewport() {
      const maxHeight = getSqlTerminalMaxHeightPx()
      setHeightPx(prev => (prev == null ? prev : Math.min(prev, maxHeight)))
      const maxWidth = getSqlTerminalMaxWidthPx()
      setWidthPx(prev => (prev == null ? prev : Math.min(prev, maxWidth)))
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
    if (!sqlAiPrompt.trim()) {
      safeRemove(SQL_AI_INLINE_PROMPT_KEY)
      return
    }
    safeSave(SQL_AI_INLINE_PROMPT_KEY, sqlAiPrompt)
  }, [sqlAiPrompt])

  useEffect(() => {
    safeSave(SQL_TERMINAL_SPLIT_KEY, String(splitLeftFraction))
  }, [splitLeftFraction])

  useEffect(() => {
    if (!selectedSchema) safeRemove(SQL_TERMINAL_SCHEMA_KEY)
    else safeSave(SQL_TERMINAL_SCHEMA_KEY, selectedSchema)
  }, [selectedSchema])

  useEffect(() => {
    const element = outputRef.current
    if (!element) return
    const hasTableResult = (resultColumns?.length ?? 0) > 0 || (resultRows?.length ?? 0) > 0
    if (hasTableResult) {
      if (!resetTableScrollOnNextResultRef.current) return
      element.scrollTop = 0
      resetTableScrollOnNextResultRef.current = false
      return
    }
    element.scrollTop = element.scrollHeight
  }, [open, output.length, resultColumns, resultRows])

  useEffect(() => {
    if (!connOptions.length) return
    setSelectedConnId(prev => {
      if (prev && connOptions.some(conn => conn.id === prev)) return prev
      const stored = safeLoadString(SQL_TERMINAL_SELECTED_CONN_KEY)
      if (stored && connOptions.some(conn => conn.id === stored)) return stored
      return connOptions[0]?.id ?? null
    })
  }, [connOptions])

  useEffect(() => {
    if (!open || !selectedConn) return

    void (async () => {
      try {
        const names = await loadSqlTerminalSchemas(selectedConn)
        setSchemas(names)
        setSelectedSchema(prev => {
          const stored = safeLoadString(SQL_TERMINAL_SCHEMA_KEY) ?? ''
          const candidate = prev || stored
          if (candidate && names.includes(candidate)) return candidate
          if (names.includes('public')) return 'public'
          return names[0] ?? ''
        })
      } catch (error) {
        logError('SqlTerminal.loadSchemas', error, { connectionId: selectedConn.id })
        setSchemas([])
        setSelectedSchema('')
      }
    })()

    setTables([])
    setColumnsByTableKey({})
  }, [open, selectedConn])

  useEffect(() => {
    if (!open || !selectedConn || selectedConn.type !== 'postgres') return

    setColumnsByTableKey({})
    void (async () => {
      try {
        const nextTables = await loadSqlTerminalTables(selectedConn, selectedSchema)
        setTables(nextTables)
        const nextColumns = await preloadSqlTerminalColumns(selectedConn, selectedSchema, nextTables)
        setColumnsByTableKey(nextColumns)
      } catch (error) {
        logError('SqlTerminal.loadTables', error, { connectionId: selectedConn.id, schema: selectedSchema })
        setTables([])
      }
    })()
  }, [open, selectedConn, selectedSchema])

  useEffect(() => {
    if (!tableSuggestOpen) {
      setTableSuggestPopupPos(null)
      return
    }
    requestAnimationFrame(updateTableSuggestPopupPosition)
  }, [columnSuggestions.length, cursorPos, sql, suggestMode, tableSuggestOpen, tableSuggestions.length, updateTableSuggestPopupPosition])

  useEffect(() => {
    if (!tableSuggestOpen) return
    setTableSuggestActiveIndex(null)
  }, [suggestMode, tableSuggestOpen, tableSuggestPrefix])

  useEffect(() => {
    if (!open) return
    const textarea = sqlRef.current
    if (!textarea) return

    const pos = textarea.selectionStart ?? cursorPos
    const before = sql.slice(0, pos)
    const currentLineBefore = before.slice(before.lastIndexOf('\n') + 1)
    const columnMatch = before.match(/(?:^|[^a-zA-Z0-9_"])([a-zA-Z0-9_"]+)\.([a-zA-Z0-9_"]*)$/i)

    if (columnMatch) {
      const token = stripQuotes(columnMatch[1] ?? '')
      const columnPrefix = stripQuotes(columnMatch[2] ?? '')
      const aliases = parseFromAndJoinAliases(sql)
      const tableName = aliases[token]
      if (tableName && selectedConn?.type === 'postgres' && selectedSchema) {
        const key = `${selectedSchema}.${tableName}`
        setSuggestMode('column')
        setColumnTargetTableKey(key)
        setTableSuggestPrefix(columnPrefix)
        setTableSuggestReplaceRange({ start: pos - (columnMatch[2] ?? '').length, end: pos })
        setTableSuggestPopupPos(null)
        setTableSuggestActiveIndex(null)
        void loadColumnsForTable(selectedConn, selectedSchema, tableName)
        setTableSuggestOpen(true)
        return
      }
    }

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
    setSuggestMode('table')
    setTableSuggestKind(kind)
    setTableSuggestPrefix(prefix.replaceAll('"', ''))
    setTableSuggestReplaceRange({ start: pos - prefix.length, end: pos })
    setColumnTargetTableKey(null)
    setTableSuggestPopupPos(null)
    setTableSuggestActiveIndex(null)
    setTableSuggestOpen(true)
  }, [cursorPos, loadColumnsForTable, open, selectedConn, selectedSchema, sql, tables.length])

  useEffect(() => {
    if (!open) return
    function onGlobalKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return
      const section = sectionRef.current
      const active = document.activeElement
      if (section && active && !section.contains(active)) return
      event.preventDefault()
      event.stopPropagation()
      runRef.current?.()
    }

    window.addEventListener('keydown', onGlobalKeyDown, true)
    return () => window.removeEventListener('keydown', onGlobalKeyDown, true)
  }, [open])

  const onResizeHandlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!open) return
    event.preventDefault()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    const startY = event.clientY
    const max = getSqlTerminalMaxHeightPx()
    const startHeight = heightPx ?? Math.round(Math.min(window.innerHeight * 0.38, max))

    function clamp(nextHeight: number) {
      return Math.max(SQL_TERMINAL_MIN_HEIGHT_PX, Math.min(max, nextHeight))
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

    function onMove(nextEvent: PointerEvent) {
      if ((nextEvent.buttons & 1) === 0) {
        cleanup()
        return
      }
      const dy = nextEvent.clientY - startY
      setHeightPx(clamp(Math.round(startHeight - dy)))
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
  }, [heightPx, open])

  const onResizeHandleDoubleClick = useCallback(() => {
    const max = getSqlTerminalMaxHeightPx()
    const base = getSqlTerminalBaseHeightPx()
    const current = heightPx ?? base
    setHeightPx(Math.abs(current - max) <= 2 ? base : max)
  }, [heightPx])

  const onRightResizeHandlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!open || drawerPosition !== 'left') return
    event.preventDefault()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    const startX = event.clientX
    const max = getSqlTerminalMaxWidthPx()
    const startWidth = widthPx ?? getSqlTerminalBaseWidthPx()

    function clamp(nextWidth: number) {
      return Math.max(SQL_TERMINAL_MIN_WIDTH_PX, Math.min(max, nextWidth))
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

    function onMove(nextEvent: PointerEvent) {
      if ((nextEvent.buttons & 1) === 0) {
        cleanup()
        return
      }
      const dx = nextEvent.clientX - startX
      setWidthPx(clamp(Math.round(startWidth + dx)))
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
  }, [drawerPosition, open, widthPx])

  const onSplitHandlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!open) return
    event.preventDefault()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    const wrap = bodyRef.current
    if (!wrap) return

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const rect = wrap.getBoundingClientRect()
    const startX = event.clientX
    const startFrac = splitLeftFraction
    const minLeftPx = 260
    const minRightPx = 320
    const maxFracFromLeft = Math.max(0.1, Math.min(0.9, (rect.width - minRightPx) / rect.width))
    const minFracFromLeft = Math.max(0.1, Math.min(0.9, minLeftPx / rect.width))

    function clampFrac(nextFraction: number) {
      return Math.max(minFracFromLeft, Math.min(maxFracFromLeft, nextFraction))
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

    function onMove(nextEvent: PointerEvent) {
      if ((nextEvent.buttons & 1) === 0) {
        cleanup()
        return
      }
      const dx = nextEvent.clientX - startX
      setSplitLeftFraction(clampFrac(startFrac + dx / rect.width))
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
  }, [open, splitLeftFraction])

  const selectedLabel = selectedConn ? `${selectedConn.label}: ${selectedConn.connectionPreview}` : (connOptions.length ? 'Select DB…' : 'No DB connections')
  const drawerMaxHeightPx = getSqlTerminalMaxHeightPx()
  const drawerHeightPx = heightPx == null ? null : Math.min(heightPx, drawerMaxHeightPx)
  const isLeftPosition = drawerPosition === 'left'
  const drawerMaxWidthPx = getSqlTerminalMaxWidthPx()
  const drawerWidthPx = Math.min(widthPx ?? getSqlTerminalBaseWidthPx(), drawerMaxWidthPx)

  return (
    <>
      <SqlAiAssistantDialog
        open={sqlAiDialogOpen}
        onClose={() => setSqlAiDialogOpen(false)}
        aiSettings={props.aiSettings}
        mcpSettings={props.mcpSettings}
        currentSql={sql}
        selectedSchema={selectedSchema}
        onInsertSql={appendSqlText}
        selectedConnection={selectedConnection}
      />

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
        {isLeftPosition ? <div className="terminalResizeHandle sqlTerminalResizeHandleRight" onPointerDown={onRightResizeHandlePointerDown} /> : null}

        <SqlTerminalHeader
          open={open}
          editorBusy={editorBusy}
          menuOpen={menuOpen}
          menuWrapRef={menuWrapRef}
          connOptions={connOptions}
          selectedConn={selectedConn}
          selectedConnId={selectedConnId}
          selectedLabel={selectedLabel}
          isLeftPosition={isLeftPosition}
          onClose={onClose}
          onToggleMenu={() => setMenuOpen(prev => !prev)}
          onSelectConnection={id => {
            setMenuOpen(false)
            setSelectedConnId(id)
          }}
          onToggleDrawerPosition={() => setDrawerPosition(prev => (prev === 'left' ? 'bottom' : 'left'))}
          onClear={clearTerminal}
          focusEditorSoon={focusEditorSoon}
        />

        <div
          ref={bodyRef}
          className="sqlTerminalBody"
          style={{ gridTemplateColumns: `${Math.round(splitLeftFraction * 1000)}fr 8px ${Math.round((1 - splitLeftFraction) * 1000)}fr` }}
        >
          <SqlTerminalEditorPane
            open={open}
            editorBusy={editorBusy}
            busy={busy}
            aiBusy={aiBusy}
            connOptions={connOptions}
            selectedConn={selectedConn}
            selectedSchema={selectedSchema}
            schemas={schemas}
            schemaMenuOpen={schemaMenuOpen}
            schemaMenuPlacement={schemaMenuPlacement}
            schemaMenuMaxHeight={schemaMenuMaxHeight}
            aiMenuOpen={aiMenuOpen}
            sql={sql}
            lineNumbers={lineNumbers}
            activeLine={activeLine}
            editorWrapStyle={editorWrapStyle}
            tableSuggestOpen={tableSuggestOpen}
            tableSuggestReplaceRange={tableSuggestReplaceRange}
            tableSuggestPopupPos={tableSuggestPopupPos}
            suggestMode={suggestMode}
            tableSuggestions={tableSuggestions}
            columnSuggestions={columnSuggestions}
            columnLoading={columnLoading}
            tableSuggestActiveIndex={tableSuggestActiveIndex}
            sqlAiPrompt={sqlAiPrompt}
            schemaMenuWrapRef={schemaMenuWrapRef}
            aiMenuWrapRef={aiMenuWrapRef}
            editorWrapRef={editorWrapRef}
            lineNumbersRef={lineNumbersRef}
            sqlRef={sqlRef}
            sqlAiPromptRef={sqlAiPromptRef}
            tableSuggestRef={tableSuggestRef}
            onOpenSchemaMenu={openSchemaMenu}
            onToggleSchemaMenu={() => setSchemaMenuOpen(prev => !prev)}
            onSelectSchema={schema => {
              setSchemaMenuOpen(false)
              setSelectedSchema(schema)
              focusEditorSoon()
            }}
            onToggleAiMenu={() => setAiMenuOpen(prev => !prev)}
            onEnhanceSqlWithAi={() => void handleEnhanceSqlWithAi()}
            onCreateSqlWithAi={() => {
              setAiMenuOpen(false)
              requestAnimationFrame(() => setSqlAiDialogOpen(true))
            }}
            onRun={() => void run()}
            onSqlChange={(nextText, caret) => {
              recordInputChange(nextText, caret)
              setCursorPos(caret)
              setSql(nextText)
              requestAnimationFrame(refreshEditorCaretState)
            }}
            onRefreshEditorCaretState={refreshEditorCaretState}
            onEditorScroll={() => {
              syncLineNumberScroll()
              updateTableSuggestPopupPosition()
            }}
            onEditorKeyDown={handleEditorKeyDown}
            onApplyColumnSuggestionAt={applyColumnSuggestionAt}
            onApplyTableSuggestionAt={applyTableSuggestionAt}
            onSqlAiPromptChange={setSqlAiPrompt}
            onSqlAiPromptSend={() => void handleInlineSqlAiPrompt()}
          />

          <div className="sqlTerminalDivider" onPointerDown={onSplitHandlePointerDown} />

          <SqlTerminalOutputPane
            editorBusy={editorBusy}
            output={output}
            resultRows={resultRows}
            effectiveResultColumns={effectiveResultColumns}
            resultHint={resultHint}
            lastRunSchemaTableLabel={lastRunSchemaTableLabel}
            paging={paging}
            outputRef={outputRef}
            focusEditorSoon={focusEditorSoon}
            onOutputScroll={onOutputScroll}
            onLoadAllRows={() => void loadMoreRows(true)}
          />
        </div>
      </section>
    </>
  )
}
