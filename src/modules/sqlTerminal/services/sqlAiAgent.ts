import type { AiProviderSettings, McpServerSettings } from '../../../shared/utils/appSettings'
import { getLogger } from '../../../shared/utils/logger'
import { completeJsonWithYandex, type AiChatPromptMessage } from '../../ai/provider'
import { callMcpTool, getPostgresMcpServer, hasMcpServerConnectionConfig, reconnectMcpServerWithTools } from '../../mcp/services/mcp'
import { runDbSql } from '../../environment'

type SqlAiAgentPlan = {
  action?: unknown
  reply?: unknown
  sql?: unknown
  inspectTables?: unknown
  candidateTables?: unknown
}

export type SqlAiConversationMessage = {
  role: 'user' | 'assistant'
  text: string
}

export type SqlAiKnownObject = {
  schema: string
  name: string
  type: string
}

export type SqlAiAssistantContext = {
  server: McpServerSettings | null
  serverName: string
  toolNames: string[]
  schemas: string[]
  objects: SqlAiKnownObject[]
  detailTextByObjectKey: Record<string, string>
  contextOverview: string
  directDbConnectionString?: string
}

export type SqlAiAssistantOutcome = {
  context: SqlAiAssistantContext
  reply: string
  sqlToInsert?: string
}

const SQL_AI_FORBIDDEN_PATTERN = /\b(delete|truncate|drop)\b|alter\s+table[\s\S]{0,80}\b(drop|detach)\b/i
const sqlAiLogger = getLogger('sql-ai-agent')

function makeObjectKey(schema: string, name: string) {
  return `${schema.trim()}.${name.trim()}`
}

function normalizeTextList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function parseSchemaNames(raw: string) {
  const out: string[] = []
  for (const match of raw.matchAll(/'schema_name': '([^']+)'/g)) {
    const name = match[1]?.trim()
    if (name) out.push(name)
  }
  return Array.from(new Set(out))
}

function parseObjects(raw: string) {
  const out: SqlAiKnownObject[] = []
  for (const match of raw.matchAll(/'schema': '([^']+)', 'name': '([^']+)', 'type': '([^']+)'/g)) {
    const schema = match[1]?.trim()
    const name = match[2]?.trim()
    const type = match[3]?.trim()
    if (!schema || !name || !type) continue
    out.push({ schema, name, type })
  }
  return out
}

function summarizeObjectDetails(raw: string) {
  const objectMatch = raw.match(/'basic': \{'schema': '([^']+)', 'name': '([^']+)', 'type': '([^']+)'/)
  const objectLabel = objectMatch ? `${objectMatch[1]}.${objectMatch[2]} (${objectMatch[3]})` : 'object'

  const columns = Array.from(raw.matchAll(/'column': '([^']+)', 'data_type': '([^']+)', 'is_nullable': '([^']+)'/g))
    .slice(0, 16)
    .map(match => `${match[1]} ${match[2]}${match[3] === 'NO' ? ' not null' : ''}`)

  const relations = Array.from(raw.matchAll(/'type': '(PRIMARY KEY|FOREIGN KEY|UNIQUE)', 'columns': \[([^\]]*)\]/g))
    .slice(0, 8)
    .map(match => `${match[1]}(${match[2].replace(/'/g, '').trim()})`)

  const parts = [`${objectLabel}.`]
  if (columns.length) parts.push(`Columns: ${columns.join('; ')}.`)
  if (relations.length) parts.push(`Constraints: ${relations.join('; ')}.`)

  const summary = parts.join(' ').trim()
  return summary.length > 40 ? summary : raw.trim()
}

function buildContextOverview(args: {
  serverName: string
  toolNames: string[]
  schemas: string[]
  objects: SqlAiKnownObject[]
  detailTextByObjectKey: Record<string, string>
}) {
  const schemaLines = args.schemas.map(schema => {
    const objectNames = args.objects
      .filter(object => object.schema === schema)
      .map(object => object.name)
      .sort((left, right) => left.localeCompare(right))

    return objectNames.length
      ? `- ${schema}: ${objectNames.join(', ')}`
      : `- ${schema}: (no user tables found)`
  })

  const detailLines = Object.entries(args.detailTextByObjectKey)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => `- ${value}`)

  return [
    `Connected MCP server: ${args.serverName}`,
    `Available MCP tools: ${args.toolNames.join(', ') || '(none)'}`,
    '',
    'Schemas and tables:',
    ...(schemaLines.length ? schemaLines : ['- (none)']),
    '',
    'Known table details:',
    ...(detailLines.length ? detailLines : ['- Details were not prefetched yet.']),
  ].join('\n')
}

async function callMcpTextTool(server: McpServerSettings, toolName: string, args: Record<string, unknown>) {
  const started = performance.now()
  sqlAiLogger.info('callMcpTextTool.start', {
    toolName,
    serverId: server.id,
    args,
  })
  const result = await callMcpTool({
    server,
    toolName,
    arguments: args,
  })
  sqlAiLogger.info('callMcpTextTool.done', {
    toolName,
    serverId: server.id,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    textLength: result.text.length,
  })
  return result.text.trim()
}

async function loadObjectDetails(
  server: McpServerSettings,
  current: SqlAiAssistantContext,
  objectKeys: string[],
): Promise<SqlAiAssistantContext> {
  const nextDetails = { ...current.detailTextByObjectKey }

  for (const objectKey of objectKeys) {
    if (nextDetails[objectKey]) continue
    const [schema, name] = objectKey.split('.')
    if (!schema || !name) continue

    const raw = await callMcpTextTool(server, 'get_object_details', {
      schema_name: schema,
      object_name: name,
      object_type: 'table',
    })
    nextDetails[objectKey] = summarizeObjectDetails(raw)
  }

  return {
    ...current,
    detailTextByObjectKey: nextDetails,
    contextOverview: buildContextOverview({
      serverName: current.serverName,
      toolNames: current.toolNames,
      schemas: current.schemas,
      objects: current.objects,
      detailTextByObjectKey: nextDetails,
    }),
  }
}

async function loadObjectDetailsFromDb(
  connectionString: string,
  current: SqlAiAssistantContext,
  objectKeys: string[],
): Promise<SqlAiAssistantContext> {
  const nextDetails = { ...current.detailTextByObjectKey }

  for (const objectKey of objectKeys) {
    if (nextDetails[objectKey]) continue
    const [schema, name] = objectKey.split('.')
    if (!schema || !name) continue

    const sql = `
      select
        c.column_name as column_name,
        c.data_type as data_type,
        c.is_nullable as is_nullable
      from information_schema.columns c
      where c.table_schema = '${schema.replace(/'/g, "''")}'
        and c.table_name = '${name.replace(/'/g, "''")}'
      order by c.ordinal_position
    `
    const result = await runDbSql({
      type: 'postgres',
      connectionString,
      sql,
      timeoutMs: 15_000,
    })
    if (!result.ok) continue

    const columns = (result.rows ?? [])
      .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row))
      .map(row => {
        const columnName = String(row.column_name ?? '').trim()
        const dataType = String(row.data_type ?? '').trim()
        const isNullable = String(row.is_nullable ?? '').trim()
        return columnName && dataType
          ? `${columnName} ${dataType}${isNullable === 'NO' ? ' not null' : ''}`
          : ''
      })
      .filter(Boolean)

    nextDetails[objectKey] = columns.length
      ? `${schema}.${name} (table). Columns: ${columns.join('; ')}.`
      : `${schema}.${name} (table).`
  }

  return {
    ...current,
    detailTextByObjectKey: nextDetails,
    contextOverview: buildContextOverview({
      serverName: current.serverName,
      toolNames: current.toolNames,
      schemas: current.schemas,
      objects: current.objects,
      detailTextByObjectKey: nextDetails,
    }),
  }
}

function buildAgentMessages(args: {
  context: SqlAiAssistantContext
  conversation: SqlAiConversationMessage[]
  userMessage: string
  selectedSchema?: string
  currentSql: string
}): AiChatPromptMessage[] {
  const currentSql = args.currentSql.trim() || '(empty)'
  const conversationText = args.conversation.length
    ? args.conversation.map(message => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.text}`).join('\n')
    : '(empty)'

  return [
    {
      role: 'system',
      content: [
        'You are an expert PostgreSQL assistant working inside a SQL terminal.',
        'The database context was discovered through postgres-mcp and is provided below.',
        'Your task is to understand the user request, identify the target table, and prepare a SQL script for insertion into the editor.',
        'Never generate destructive SQL. Forbidden: DELETE, TRUNCATE, DROP, ALTER TABLE ... DROP, or any removal of data/objects.',
        'You may generate SELECT, INSERT, UPDATE, WITH queries, comments, and BEGIN/COMMIT if really needed.',
        'Do not execute SQL. Do not explain large theory. Focus on the script.',
        'If the target table is ambiguous, ask a short clarification question and offer several candidate tables.',
        'If you need exact table structure before writing SQL, request inspection of specific tables.',
        'If you are ready to insert SQL, your reply must be exactly: "Вставил запрашиваемый скрипт в конец поля."',
        'Return JSON only with keys: action, reply, sql, inspectTables, candidateTables.',
        'Allowed action values: "clarify", "inspect", "insert", "reject".',
        'For inspectTables and candidateTables use fully qualified names like public.customers.',
        'For insert action, return only the new script to append, not the whole editor contents.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Selected schema in SQL terminal: ${args.selectedSchema?.trim() || '(none)'}`,
        '',
        'Current SQL editor contents:',
        currentSql,
        '',
        'Known database context from postgres-mcp:',
        args.context.contextOverview,
        '',
        'Conversation so far:',
        conversationText,
        '',
        'New user request:',
        args.userMessage.trim(),
      ].join('\n'),
    },
  ]
}

function normalizeObjectKey(raw: string, context: SqlAiAssistantContext, selectedSchema?: string) {
  const clean = raw.trim()
  if (!clean) return null

  if (clean.includes('.')) {
    const [schema, name] = clean.split('.', 2)
    const key = makeObjectKey(schema, name)
    return context.objects.some(object => makeObjectKey(object.schema, object.name) === key) ? key : null
  }

  const candidates = context.objects.filter(object => object.name === clean)
  if (!candidates.length) return null
  if (selectedSchema) {
    const preferred = candidates.find(object => object.schema === selectedSchema)
    if (preferred) return makeObjectKey(preferred.schema, preferred.name)
  }
  return candidates.length === 1 ? makeObjectKey(candidates[0].schema, candidates[0].name) : null
}

function hasForbiddenSql(sql: string) {
  return SQL_AI_FORBIDDEN_PATTERN.test(sql)
}

export async function initializeSqlAiAssistantContext(
  mcpSettings: McpServerSettings[],
  options?: {
    selectedSchema?: string
  },
): Promise<SqlAiAssistantContext> {
  const initStarted = performance.now()
  sqlAiLogger.info('initializeSqlAiAssistantContext.start', {
    selectedSchema: options?.selectedSchema ?? '',
    mcpServerCount: mcpSettings.length,
  })
  const server = getPostgresMcpServer(mcpSettings)
  if (!server) throw new Error('Postgres MCP template is missing in Settings.')
  if (!hasMcpServerConnectionConfig(server)) {
    throw new Error('Postgres MCP is not configured yet. Open Settings → MCP and fill its connection settings.')
  }

  sqlAiLogger.info('initializeSqlAiAssistantContext.reconnect.start', {
    serverId: server.id,
    command: server.command,
    args: server.args,
  })
  const reconnectResult = await reconnectMcpServerWithTools(server)
  sqlAiLogger.info('initializeSqlAiAssistantContext.reconnect.done', {
    serverId: server.id,
    serverName: reconnectResult.serverName,
    toolNames: reconnectResult.tools.map(tool => tool.name),
  })
  const toolNames = reconnectResult.tools.map(tool => tool.name).filter(Boolean)
  const requiredTools = ['list_schemas', 'list_objects', 'get_object_details']
  const missingTools = requiredTools.filter(toolName => !toolNames.includes(toolName))
  if (missingTools.length) {
    throw new Error(`Connected Postgres MCP does not expose required tools: ${missingTools.join(', ')}`)
  }

  const schemasRaw = await callMcpTextTool(server, 'list_schemas', {})
  const schemas = parseSchemaNames(schemasRaw).filter(schema => schema !== 'information_schema' && !schema.startsWith('pg_'))
  sqlAiLogger.info('initializeSqlAiAssistantContext.schemas.loaded', {
    serverId: server.id,
    schemas,
  })
  const selectedSchema = options?.selectedSchema?.trim() || ''
  const prioritizedSchemas = selectedSchema && schemas.includes(selectedSchema)
    ? [selectedSchema, ...schemas.filter(schema => schema !== selectedSchema)]
    : schemas
  const objects: SqlAiKnownObject[] = []

  const schemasToInspect = prioritizedSchemas.slice(0, Math.max(1, Math.min(6, prioritizedSchemas.length)))
  for (const schema of schemasToInspect) {
    sqlAiLogger.info('initializeSqlAiAssistantContext.objects.start', {
      serverId: server.id,
      schema,
    })
    const raw = await callMcpTextTool(server, 'list_objects', {
      schema_name: schema,
      object_type: 'table',
    })
    const parsedObjects = parseObjects(raw)
    objects.push(...parsedObjects)
    sqlAiLogger.info('initializeSqlAiAssistantContext.objects.done', {
      serverId: server.id,
      schema,
      objectCount: parsedObjects.length,
    })
  }

  let context: SqlAiAssistantContext = {
    server,
    serverName: reconnectResult.serverName,
    toolNames,
    schemas,
    objects,
    detailTextByObjectKey: {},
    contextOverview: '',
  }

  context = {
    ...context,
    contextOverview: buildContextOverview({
      serverName: context.serverName,
      toolNames: context.toolNames,
      schemas: context.schemas,
      objects: context.objects,
      detailTextByObjectKey: context.detailTextByObjectKey,
    }),
  }

  sqlAiLogger.info('initializeSqlAiAssistantContext.done', {
    serverId: server.id,
    durationMs: Math.max(0, Math.round(performance.now() - initStarted)),
    schemaCount: context.schemas.length,
    objectCount: context.objects.length,
  })

  return context
}

export async function initializeSqlAiAssistantContextFromDb(args: {
  connectionString: string
  selectedSchema?: string
}): Promise<SqlAiAssistantContext> {
  const started = performance.now()
  sqlAiLogger.info('initializeSqlAiAssistantContextFromDb.start', {
    selectedSchema: args.selectedSchema ?? '',
    connectionStringPreview: args.connectionString.replace(/:[^:@/]+@/, ':***@'),
  })
  const schemasResult = await runDbSql({
    type: 'postgres',
    connectionString: args.connectionString,
    sql: "select schema_name as name from information_schema.schemata where schema_name <> 'information_schema' and schema_name not like 'pg\\_%' escape '\\' order by case when schema_name='public' then 0 else 1 end, schema_name",
    timeoutMs: 15_000,
  })
  if (!schemasResult.ok) {
    throw new Error(schemasResult.message || 'Failed to load PostgreSQL schemas.')
  }

  const schemas = (schemasResult.rows ?? [])
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row))
    .map(row => String(row.name ?? '').trim())
    .filter(Boolean)
  sqlAiLogger.info('initializeSqlAiAssistantContextFromDb.schemas.loaded', {
    schemas,
  })

  const selectedSchema = args.selectedSchema?.trim() || ''
  const prioritizedSchemas = selectedSchema && schemas.includes(selectedSchema)
    ? [selectedSchema, ...schemas.filter(schema => schema !== selectedSchema)]
    : schemas

  const objects: SqlAiKnownObject[] = []
  for (const schema of prioritizedSchemas.slice(0, Math.max(1, Math.min(6, prioritizedSchemas.length)))) {
    sqlAiLogger.info('initializeSqlAiAssistantContextFromDb.objects.start', { schema })
    const tablesResult = await runDbSql({
      type: 'postgres',
      connectionString: args.connectionString,
      sql: `select table_name as name from information_schema.tables where table_schema = '${schema.replace(/'/g, "''")}' and table_type in ('BASE TABLE','VIEW') order by table_name`,
      timeoutMs: 15_000,
    })
    if (!tablesResult.ok) continue

    for (const row of tablesResult.rows ?? []) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue
      const name = String((row as Record<string, unknown>).name ?? '').trim()
      if (!name) continue
      objects.push({ schema, name, type: 'BASE TABLE' })
    }
    sqlAiLogger.info('initializeSqlAiAssistantContextFromDb.objects.done', {
      schema,
      objectCount: objects.filter(object => object.schema === schema).length,
    })
  }

  let context: SqlAiAssistantContext = {
    server: null,
    serverName: 'Direct PostgreSQL connection',
    toolNames: ['sql-terminal-db-fallback'],
    schemas,
    objects,
    detailTextByObjectKey: {},
    contextOverview: '',
    directDbConnectionString: args.connectionString,
  }

  context = {
    ...context,
    contextOverview: buildContextOverview({
      serverName: context.serverName,
      toolNames: context.toolNames,
      schemas: context.schemas,
      objects: context.objects,
      detailTextByObjectKey: context.detailTextByObjectKey,
    }),
  }

  sqlAiLogger.info('initializeSqlAiAssistantContextFromDb.done', {
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    schemaCount: context.schemas.length,
    objectCount: context.objects.length,
  })

  return context
}

export async function respondWithSqlAiAssistant(args: {
  aiSettings: AiProviderSettings
  context: SqlAiAssistantContext
  conversation: SqlAiConversationMessage[]
  userMessage: string
  selectedSchema?: string
  currentSql: string
}): Promise<SqlAiAssistantOutcome> {
  let context = args.context

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const plan = await completeJsonWithYandex<SqlAiAgentPlan>(args.aiSettings, {
      messages: buildAgentMessages({
        context,
        conversation: args.conversation,
        userMessage: args.userMessage,
        selectedSchema: args.selectedSchema,
        currentSql: args.currentSql,
      }),
      temperature: 0.1,
      errorPrefix: 'AI SQL assistant',
    })

    const action = typeof plan.action === 'string' ? plan.action.trim().toLowerCase() : ''
    const reply = typeof plan.reply === 'string' ? plan.reply.trim() : ''

    if (action === 'inspect') {
      const requestedKeys = normalizeTextList(plan.inspectTables)
        .map(item => normalizeObjectKey(item, context, args.selectedSchema))
        .filter((item): item is string => !!item)
        .filter(item => !context.detailTextByObjectKey[item])

      if (!requestedKeys.length) {
        return {
          context,
          reply: reply || 'Уточни, пожалуйста, какую таблицу или сущность ты имеешь в виду.',
        }
      }

      if (context.server) {
        context = await loadObjectDetails(context.server, context, requestedKeys.slice(0, 4))
      } else if (context.directDbConnectionString) {
        context = await loadObjectDetailsFromDb(context.directDbConnectionString, context, requestedKeys.slice(0, 4))
      }
      continue
    }

    if (action === 'insert') {
      const sql = typeof plan.sql === 'string' ? plan.sql.trim() : ''
      if (!sql) {
        return {
          context,
          reply: 'Не получилось собрать SQL. Уточни, пожалуйста, что именно нужно получить или изменить.',
        }
      }
      if (hasForbiddenSql(sql)) {
        return {
          context,
          reply: 'Я не могу подготовить удаляющий или destructive SQL. Могу помочь только с выборкой, вставкой или обновлением данных без удаления.',
        }
      }
      return {
        context,
        reply: 'Вставил запрашиваемый скрипт в конец поля.',
        sqlToInsert: sql,
      }
    }

    if (action === 'reject') {
      return {
        context,
        reply: reply || 'Я не могу помочь с этим действием в SQL-режиме.',
      }
    }

    const candidates = normalizeTextList(plan.candidateTables)
    if (reply) {
      return { context, reply }
    }
    if (candidates.length) {
      return {
        context,
        reply: `Уточни, пожалуйста, какую таблицу ты имеешь в виду: ${candidates.join(', ')}.`,
      }
    }
    return {
      context,
      reply: 'Уточни, пожалуйста, что именно нужно получить или изменить и в какой таблице.',
    }
  }

  return {
    context,
    reply: 'Нужно чуть больше контекста. Уточни, пожалуйста, какую таблицу и какое действие ты ожидаешь.',
  }
}
