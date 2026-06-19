import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { AiProviderSettings, McpServerSettings } from '../../../shared/utils/appSettings'
import { CloseIcon } from '../../../shared/icons'
import { getLogger } from '../../../shared/utils/logger'
import { safeParseJson } from '../../../shared/utils/json'
import { runDbSql } from '../../environment'
import { getPostgresMcpServer } from '../../mcp/services/mcp'
import {
  initializeSqlAiAssistantContext,
  initializeSqlAiAssistantContextFromDb,
  respondWithSqlAiAssistant,
  type SqlAiAssistantContext,
  type SqlAiConversationMessage,
} from '../services/sqlAiAgent'
import { resolveFallbackPostgresConnectionString } from '../utils/connections'
import { applySchemaToTableRefs, buildSchemaAwareSql, looksLikeSelectOrWith } from '../utils/sql'

type Props = {
  open: boolean
  onClose: () => void
  aiSettings: AiProviderSettings
  mcpSettings: McpServerSettings[]
  currentSql: string
  selectedSchema?: string
  onInsertSql: (sql: string) => void
  selectedConnection?: {
    type: 'postgres' | 'mysql'
    connectionString: string
  } | null
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

type InitStage = 'idle' | 'connecting' | 'loading-schemas' | 'ready'

const DIALOG_WIDTH = 520
const DIALOG_HEIGHT = 560
const DIALOG_MIN_WIDTH = 520
const DIALOG_MIN_HEIGHT = 560
const DIALOG_VIEWPORT_GAP = 12
const SQL_AI_DIALOG_SIZE_KEY = 'ruf_sql_ai_dialog_size_v1'
const sqlAiDialogLogger = getLogger('sql-ai-dialog')
const SQL_AI_RESULT_LIMIT = 20

type DialogSize = {
  width: number
  height: number
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function getDialogMaxWidth() {
  if (typeof window === 'undefined') return 980
  return Math.max(DIALOG_MIN_WIDTH, Math.floor(window.innerWidth - DIALOG_VIEWPORT_GAP * 2))
}

function getDialogMaxHeight() {
  if (typeof window === 'undefined') return 860
  return Math.max(DIALOG_MIN_HEIGHT, Math.floor(window.innerHeight - DIALOG_VIEWPORT_GAP * 2))
}

function clampDialogSize(size: DialogSize): DialogSize {
  return {
    width: clamp(Math.round(size.width), DIALOG_MIN_WIDTH, getDialogMaxWidth()),
    height: clamp(Math.round(size.height), DIALOG_MIN_HEIGHT, getDialogMaxHeight()),
  }
}

function loadDialogSize(): DialogSize {
  if (typeof window === 'undefined') return { width: DIALOG_WIDTH, height: DIALOG_HEIGHT }
  const parsed = safeParseJson<unknown>(window.localStorage.getItem(SQL_AI_DIALOG_SIZE_KEY))
  if (
    parsed
    && typeof parsed === 'object'
    && typeof (parsed as { width?: unknown }).width === 'number'
    && typeof (parsed as { height?: unknown }).height === 'number'
  ) {
    return clampDialogSize({
      width: (parsed as { width: number }).width,
      height: (parsed as { height: number }).height,
    })
  }
  return clampDialogSize({ width: DIALOG_WIDTH, height: DIALOG_HEIGHT })
}

function saveDialogSize(size: DialogSize) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SQL_AI_DIALOG_SIZE_KEY, JSON.stringify(size))
  } catch (error) {
    sqlAiDialogLogger.warn('size.save.failed', { error: error instanceof Error ? error.message : String(error) })
  }
}

function buildDefaultPosition(size: DialogSize) {
  if (typeof window === 'undefined') return { left: 80, top: 80 }
  return {
    left: clamp(window.innerWidth - size.width - 28, 20, Math.max(20, window.innerWidth - size.width - 20)),
    top: clamp(88, 20, Math.max(20, window.innerHeight - size.height - 20)),
  }
}

function stringifyCell(value: unknown) {
  if (value == null) return 'null'
  if (typeof value === 'string') return value.replaceAll(/\s+/g, ' ').trim() || '(empty)'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatResultTable(columns: string[], rows: Array<Record<string, unknown>>) {
  const visibleRows = rows.slice(0, SQL_AI_RESULT_LIMIT)
  const widths = columns.map(column => column.length)

  for (const row of visibleRows) {
    columns.forEach((column, index) => {
      widths[index] = Math.min(42, Math.max(widths[index], stringifyCell(row[column]).length))
    })
  }

  const fit = (value: string, width: number) => (
    value.length > width
      ? `${value.slice(0, Math.max(1, width - 1))}…`
      : value.padEnd(width, ' ')
  )

  const header = columns.map((column, index) => fit(column, widths[index])).join(' | ')
  const divider = widths.map(width => '-'.repeat(width)).join('-|-')
  const body = visibleRows.map(row => columns.map((column, index) => fit(stringifyCell(row[column]), widths[index])).join(' | '))
  const lines = [header, divider, ...body]
  if (rows.length > visibleRows.length) {
    lines.push(`... and ${rows.length - visibleRows.length} more row(s)`)
  }
  return lines.join('\n')
}

function formatSqlExecutionResult(result: Awaited<ReturnType<typeof runDbSql>>) {
  if (!result.ok) {
    return `Не удалось выполнить запрос: ${result.message || 'unknown error'}`
  }

  const rows = Array.isArray(result.rows) ? result.rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row)) : []
  const columns = Array.isArray(result.columns) ? result.columns : []

  if (columns.length) {
    return [
      `Найдено ${rows.length} row(s).`,
      '',
      formatResultTable(columns, rows),
    ].join('\n')
  }

  if (typeof result.rowsAffected === 'number') {
    return `Готово. Затронуто ${result.rowsAffected} row(s).`
  }

  return result.message || 'Запрос выполнен.'
}

export function SqlAiAssistantDialog(props: Props) {
  const [size, setSize] = useState(loadDialogSize)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [initBusy, setInitBusy] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [context, setContext] = useState<SqlAiAssistantContext | null>(null)
  const [initStage, setInitStage] = useState<InitStage>('idle')
  const [position, setPosition] = useState(() => buildDefaultPosition(loadDialogSize()))
  const dragOffsetRef = useRef<{ x: number, y: number } | null>(null)
  const resizeOriginRef = useRef<{ pointerId: number; startX: number; startY: number; width: number; height: number } | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const messageIdRef = useRef(0)

  const conversation = useMemo<SqlAiConversationMessage[]>(
    () => messages.map(message => ({ role: message.role, text: message.text })),
    [messages],
  )
  const initSignature = useMemo(() => {
    const postgresServer = getPostgresMcpServer(props.mcpSettings)
    return JSON.stringify({
      selectedSchema: props.selectedSchema?.trim() || '',
      fallbackConnectionString: resolveFallbackPostgresConnectionString(props.mcpSettings, props.selectedConnection),
      postgresServer: postgresServer
        ? {
            command: postgresServer.command,
            args: postgresServer.args,
            envEntries: postgresServer.envEntries ?? [],
            env: postgresServer.env,
          }
        : null,
    })
  }, [props.mcpSettings, props.selectedConnection, props.selectedSchema])
  const [contextSignature, setContextSignature] = useState<string | null>(null)

  function pushTrace(message: string, meta?: Record<string, unknown>) {
    sqlAiDialogLogger.info(message, meta)
  }

  useEffect(() => {
    if (!props.open) return
    if (context && contextSignature === initSignature) return

    let cancelled = false
    const started = performance.now()
    setInitBusy(true)
    setInitError(null)
    setInitStage('connecting')
    pushTrace('init.start', {
      selectedSchema: props.selectedSchema ?? '',
      hasSelectedConnection: !!props.selectedConnection,
      selectedConnectionType: props.selectedConnection?.type ?? null,
      hasMcpServer: !!getPostgresMcpServer(props.mcpSettings),
    })

    void (async () => {
      try {
        setInitStage('loading-schemas')
        pushTrace('init.mcp.start')
        let nextContext: SqlAiAssistantContext
        try {
          nextContext = await Promise.race([
            initializeSqlAiAssistantContext(props.mcpSettings, {
              selectedSchema: props.selectedSchema,
            }),
            new Promise<never>((_, reject) => {
              window.setTimeout(() => reject(new Error('SQL AI initialization timed out while waiting for Postgres MCP.')), 15_000)
            }),
          ])
          pushTrace('init.mcp.done', {
            durationMs: Math.max(0, Math.round(performance.now() - started)),
            serverName: nextContext.serverName,
            schemaCount: nextContext.schemas.length,
            objectCount: nextContext.objects.length,
          })
        } catch (mcpError) {
          pushTrace('init.mcp.failed', {
            error: mcpError instanceof Error ? mcpError.message : String(mcpError),
          })
          const fallbackConnectionString = resolveFallbackPostgresConnectionString(props.mcpSettings, props.selectedConnection)
          if (!fallbackConnectionString) {
            throw mcpError
          }

          pushTrace('init.db-fallback.start')
          nextContext = await initializeSqlAiAssistantContextFromDb({
            connectionString: fallbackConnectionString,
            selectedSchema: props.selectedSchema,
          })
          pushTrace('init.db-fallback.done', {
            durationMs: Math.max(0, Math.round(performance.now() - started)),
            schemaCount: nextContext.schemas.length,
            objectCount: nextContext.objects.length,
          })
        }
        if (cancelled) return
        setContext(nextContext)
        setContextSignature(initSignature)
        setInitStage('ready')
        pushTrace('init.ready', {
          totalDurationMs: Math.max(0, Math.round(performance.now() - started)),
          via: nextContext.server ? 'mcp' : 'db-fallback',
        })
      } catch (error) {
        if (cancelled) return
        setInitError(error instanceof Error ? error.message : String(error))
        setInitStage('idle')
        pushTrace('init.error', {
          totalDurationMs: Math.max(0, Math.round(performance.now() - started)),
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        if (!cancelled) setInitBusy(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [context, contextSignature, initSignature, props.open])

  useEffect(() => {
    if (!props.open) return
    const frame = requestAnimationFrame(() => {
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
    })
    return () => cancelAnimationFrame(frame)
  }, [messages, props.open])

  useEffect(() => {
    if (!props.open) return
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [props.open])

  useEffect(() => {
    if (!props.open) return

    function onPointerMove(event: PointerEvent) {
      const resizeOrigin = resizeOriginRef.current
      if (resizeOrigin) {
        const nextSize = clampDialogSize({
          width: resizeOrigin.width + (event.clientX - resizeOrigin.startX),
          height: resizeOrigin.height + (event.clientY - resizeOrigin.startY),
        })
        setSize(prev => (
          prev.width === nextSize.width && prev.height === nextSize.height
            ? prev
            : nextSize
        ))
        return
      }

      const offset = dragOffsetRef.current
      if (!offset) return

      const nextLeft = clamp(event.clientX - offset.x, DIALOG_VIEWPORT_GAP, Math.max(DIALOG_VIEWPORT_GAP, window.innerWidth - size.width - DIALOG_VIEWPORT_GAP))
      const nextTop = clamp(event.clientY - offset.y, DIALOG_VIEWPORT_GAP, Math.max(DIALOG_VIEWPORT_GAP, window.innerHeight - size.height - DIALOG_VIEWPORT_GAP))
      setPosition({ left: nextLeft, top: nextTop })
    }

    function onPointerUp() {
      dragOffsetRef.current = null
      resizeOriginRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [props.open, size.height, size.width])

  useEffect(() => {
    saveDialogSize(size)
  }, [size])

  useEffect(() => {
    if (!props.open) return
    const nextSize = clampDialogSize(size)
    setSize(prev => (
      prev.width === nextSize.width && prev.height === nextSize.height
        ? prev
        : nextSize
    ))
    setPosition(prev => ({
      left: clamp(prev.left, DIALOG_VIEWPORT_GAP, Math.max(DIALOG_VIEWPORT_GAP, window.innerWidth - nextSize.width - DIALOG_VIEWPORT_GAP)),
      top: clamp(prev.top, DIALOG_VIEWPORT_GAP, Math.max(DIALOG_VIEWPORT_GAP, window.innerHeight - nextSize.height - DIALOG_VIEWPORT_GAP)),
    }))
  }, [props.open, size])

  useEffect(() => {
    if (!props.open) return
    function onResize() {
      const nextSize = clampDialogSize(size)
      setSize(prev => (
        prev.width === nextSize.width && prev.height === nextSize.height
          ? prev
          : nextSize
      ))
      setPosition(prev => ({
        left: clamp(prev.left, DIALOG_VIEWPORT_GAP, Math.max(DIALOG_VIEWPORT_GAP, window.innerWidth - nextSize.width - DIALOG_VIEWPORT_GAP)),
        top: clamp(prev.top, DIALOG_VIEWPORT_GAP, Math.max(DIALOG_VIEWPORT_GAP, window.innerHeight - nextSize.height - DIALOG_VIEWPORT_GAP)),
      }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [props.open, size])

  function appendMessage(role: 'user' | 'assistant', text: string) {
    messageIdRef.current += 1
    setMessages(prev => [...prev, { id: `sql-ai-${messageIdRef.current}`, role, text }])
  }

  function handleHeaderPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement | null)?.closest('button')) return
    const rect = titleRef.current?.getBoundingClientRect()
    if (!rect) return
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!props.open) return
    event.preventDefault()
    event.stopPropagation()
    resizeOriginRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: size.width,
      height: size.height,
    }
    document.body.style.cursor = 'nwse-resize'
    document.body.style.userSelect = 'none'
  }

  async function executeSqlInChat(sql: string, activeContext: SqlAiAssistantContext) {
    const connectionString = activeContext.directDbConnectionString || resolveFallbackPostgresConnectionString(props.mcpSettings, props.selectedConnection)
    if (!connectionString) {
      throw new Error('SQL AI cannot execute the generated query because no PostgreSQL connection is available.')
    }

    if (!looksLikeSelectOrWith(sql)) {
      return 'В этом окне SQL AI теперь показывает данные прямо в чате, поэтому здесь выполняются только запросы на чтение (`SELECT` / `WITH`). Уточни, какие данные нужно показать.'
    }

    const renderedSql = props.selectedSchema
      ? applySchemaToTableRefs(sql, props.selectedSchema)
      : sql
    const sqlToRun = props.selectedSchema ? buildSchemaAwareSql(renderedSql, props.selectedSchema) : renderedSql

    const result = await runDbSql({
      type: 'postgres',
      connectionString,
      sql: sqlToRun,
      timeoutMs: 30_000,
    })
    return formatSqlExecutionResult(result)
  }

  async function handleSend() {
    const userText = draft.trim()
    if (!userText || busy || initBusy) return

    if (!props.aiSettings.enabled) {
      setInitError('AI is disabled in Settings.')
      return
    }
    if (!context) {
      setInitError('SQL AI context is not ready yet.')
      return
    }

    setDraft('')
    appendMessage('user', userText)
    setBusy(true)
    setInitError(null)

    try {
      const result = await respondWithSqlAiAssistant({
        aiSettings: props.aiSettings,
        context,
        conversation: [...conversation, { role: 'user', text: userText }],
        userMessage: userText,
        selectedSchema: props.selectedSchema,
        currentSql: props.currentSql,
      })

      setContext(result.context)
      if (result.sqlToInsert) {
        const reply = await executeSqlInChat(result.sqlToInsert, result.context)
        appendMessage('assistant', reply)
      } else {
        appendMessage('assistant', result.reply)
      }
    } catch (error) {
      appendMessage('assistant', error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (!props.open) return null

  const initStatusText = initStage === 'connecting'
    ? 'Connecting to Postgres MCP…'
    : initStage === 'loading-schemas'
      ? 'Loading schemas and table list…'
      : busy
        ? 'Thinking…'
        : 'Postgres MCP'

  return (
    <div
      ref={dialogRef}
      className="sqlAiAssistantDialog"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
        minWidth: `${DIALOG_MIN_WIDTH}px`,
        minHeight: `${DIALOG_MIN_HEIGHT}px`,
        maxWidth: `${getDialogMaxWidth()}px`,
        maxHeight: `${getDialogMaxHeight()}px`,
      }}
      role="dialog"
      aria-label="SQL AI Assistant"
    >
      <div
        ref={titleRef}
        className="sqlAiAssistantHeader"
        onPointerDown={handleHeaderPointerDown}
      >
        <div className="sqlAiAssistantTitle">
          <b>SQL AI</b>
          <span className="small mono" style={{ opacity: 0.72 }}>
            {initBusy ? initStatusText : initStatusText}
          </span>
        </div>
        <button type="button" className="iconBtn" onClick={props.onClose} aria-label="Close" title="Close">
          <CloseIcon size={16} />
        </button>
      </div>

      <div ref={bodyRef} className="sqlAiAssistantBody">
        {initError ? <div className="sqlAiAssistantNotice sqlAiAssistantNoticeError">{initError}</div> : null}
        {initBusy ? (
          <div className="sqlAiAssistantEmpty">
            <div className="small">
              {initStage === 'connecting'
                ? 'Connecting to the MCP server and checking available tools.'
                : 'Reading schemas and available tables through Postgres MCP.'}
            </div>
          </div>
        ) : null}
        {!initBusy && !messages.length && !initError ? (
          <div className="sqlAiAssistantEmpty">
            <div className="small">
              {context?.server
                ? 'Context is ready through Postgres MCP. Ask in natural language what data you need, and SQL AI will show it прямо в этом чате.'
                : 'Context is ready through the current SQL connection fallback. Ask in natural language what data you need, and SQL AI will show it прямо в этом чате.'}
            </div>
          </div>
        ) : null}
        {messages.map(message => (
          <div
            key={message.id}
            className={`sqlAiAssistantMessage ${message.role === 'assistant' ? 'sqlAiAssistantMessageAssistant' : 'sqlAiAssistantMessageUser'}`}
          >
            <div className="small mono" style={{ opacity: 0.64, marginBottom: 4 }}>{message.role === 'assistant' ? 'SQL AI' : 'You'}</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>
          </div>
        ))}
      </div>

      <div className="sqlAiAssistantComposer">
        <textarea
          ref={inputRef}
          className="mono modalTextarea sqlAiAssistantTextarea"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="Например: покажи последние 20 заказов с именем клиента прямо здесь"
          disabled={busy || initBusy}
          rows={3}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            void handleSend()
          }}
        />
        <div className="sqlAiAssistantActions">
          <button type="button" onClick={() => void handleSend()} disabled={busy || initBusy || !draft.trim()}>
            {busy ? 'Thinking...' : 'Send'}
          </button>
        </div>
      </div>
      <div className="sqlAiAssistantResizeHandle" onPointerDown={handleResizePointerDown} />
    </div>
  )
}
