import type { McpServerSettings } from '../../../shared/utils/appSettings'
import { tauriInvoke } from '../../../shared/utils/tauri'
import type {
  McpServerConnectionResult,
  McpServerStatusResult,
  McpToolCallRequest,
  McpToolCallResult,
  McpToolDescriptor,
  SendBugReportInput,
} from '../types'

type McpCommandServerPayload = {
  id: string
  command: string
  args: string[]
  env: Record<string, string>
}

type McpServerTestArgs = {
  server: McpCommandServerPayload
}

type McpToolCallArgs = {
  server: McpCommandServerPayload
  toolName: string
  arguments: Record<string, unknown>
}

function buildPostgresDatabaseUri(env: Record<string, string>) {
  const user = env.DB_USER?.trim() ?? ''
  const password = env.DB_PASSWORD ?? ''
  const host = env.DB_HOST?.trim() ?? ''
  const port = env.DB_PORT?.trim() ?? ''
  const database = env.DB_NAME?.trim() ?? ''

  if (!user || !host || !port || !database) return ''

  const userInfo = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user)

  return `postgresql://${userInfo}@${host}:${port}/${encodeURIComponent(database)}`
}

function getServerEnv(server: McpServerSettings) {
  if (!Array.isArray(server.envEntries)) return { ...server.env }

  const env: Record<string, string> = {}
  for (const entry of server.envEntries) {
    const key = entry.key.trim()
    if (!key) continue
    env[key] = entry.value
  }
  return env
}

function materializeServerEnv(server: McpServerSettings) {
  const env = getServerEnv(server)
  if (server.template === 'postgres') {
    const databaseUri = buildPostgresDatabaseUri(env)
    if (databaseUri) env.DATABASE_URI = databaseUri
  }
  return env
}

function toServerPayload(server: McpServerSettings): McpCommandServerPayload {
  return {
    id: server.id,
    command: server.command.trim(),
    args: server.args,
    env: materializeServerEnv(server),
  }
}

export function getAtlassianMcpServer(servers: McpServerSettings[]) {
  return servers.find(server => server.template === 'atlassian') ?? null
}

export function isMcpServerConfigured(server: McpServerSettings | null) {
  return Boolean(server?.command.trim())
}

export async function listMcpServerTools(server: McpServerSettings): Promise<McpServerConnectionResult> {
  return tauriInvoke<McpServerConnectionResult>('mcp_list_tools', {
    args: {
      server: toServerPayload(server),
    } satisfies McpServerTestArgs,
  })
}

export async function startMcpServer(server: McpServerSettings): Promise<McpServerConnectionResult> {
  return tauriInvoke<McpServerConnectionResult>('mcp_start_server', {
    args: {
      server: toServerPayload(server),
    } satisfies McpServerTestArgs,
  })
}

export async function testMcpServerConnection(server: McpServerSettings) {
  const result = await startMcpServer(server)
  return `Connected to ${result.serverName}. ${result.tools.length} tool${result.tools.length === 1 ? '' : 's'} available.`
}

export async function reconnectMcpServer(server: McpServerSettings) {
  const result = await tauriInvoke<McpServerConnectionResult>('mcp_reconnect_server', {
    args: {
      server: toServerPayload(server),
    } satisfies McpServerTestArgs,
  })
  return `Reconnected to ${result.serverName}. ${result.tools.length} tool${result.tools.length === 1 ? '' : 's'} available.`
}

export async function stopMcpServer(server: McpServerSettings) {
  return tauriInvoke<McpServerStatusResult>('mcp_stop_server', {
    args: {
      server: toServerPayload(server),
    } satisfies McpServerTestArgs,
  })
}

export async function getMcpServerStatus(server: McpServerSettings) {
  return tauriInvoke<McpServerStatusResult>('mcp_get_server_status', {
    args: {
      server: toServerPayload(server),
    } satisfies McpServerTestArgs,
  })
}

export async function callMcpTool(request: McpToolCallRequest): Promise<McpToolCallResult> {
  return tauriInvoke<McpToolCallResult>('mcp_call_tool', {
    args: {
      server: toServerPayload(request.server),
      toolName: request.toolName,
      arguments: request.arguments,
    } satisfies McpToolCallArgs,
  })
}

function getSchemaPropertyNames(schema: unknown) {
  if (!schema || typeof schema !== 'object') return []
  const properties = (schema as { properties?: unknown }).properties
  if (!properties || typeof properties !== 'object') return []
  return Object.keys(properties as Record<string, unknown>)
}

function getSchemaProperties(schema: unknown) {
  if (!schema || typeof schema !== 'object') return {}
  const properties = (schema as { properties?: unknown }).properties
  if (!properties || typeof properties !== 'object') return {}
  return properties as Record<string, unknown>
}

function pickSchemaField(schema: unknown, candidates: string[]) {
  const propertyNames = new Set(getSchemaPropertyNames(schema))
  return candidates.find(candidate => propertyNames.has(candidate)) ?? null
}

function getSchemaRequiredNames(schema: unknown) {
  if (!schema || typeof schema !== 'object') return []
  const required = (schema as { required?: unknown }).required
  if (!Array.isArray(required)) return []
  return required.filter((item): item is string => typeof item === 'string')
}

function normalizeSchemaFieldLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\-\s/()]+/g, '')
}

function resolveCustomSchemaFieldKey(schema: unknown, rawKey: string) {
  const cleanKey = rawKey.trim()
  if (!cleanKey) return null

  const properties = getSchemaProperties(schema)
  if (cleanKey in properties) return cleanKey

  const normalizedInput = normalizeSchemaFieldLabel(cleanKey)
  if (!normalizedInput) return null

  let bestMatch: { key: string, score: number } | null = null

  for (const [propertyKey, propertySchema] of Object.entries(properties)) {
    const propertyRecord = propertySchema && typeof propertySchema === 'object'
      ? propertySchema as Record<string, unknown>
      : {}

    const candidates = [
      propertyKey,
      typeof propertyRecord.title === 'string' ? propertyRecord.title : '',
      typeof propertyRecord.description === 'string' ? propertyRecord.description : '',
    ].filter(Boolean)

    for (const candidate of candidates) {
      const normalizedCandidate = normalizeSchemaFieldLabel(candidate)
      if (!normalizedCandidate) continue

      let score = 0
      if (normalizedCandidate === normalizedInput) score = 100
      else if (normalizedCandidate.includes(normalizedInput) || normalizedInput.includes(normalizedCandidate)) score = 60

      if (!score) continue
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { key: propertyKey, score }
      }
    }
  }

  return bestMatch?.key ?? null
}

function buildAtlassianBugToolArguments(server: McpServerSettings, schema: unknown, input: SendBugReportInput) {
  const summary = input.summary.trim()
  const description = input.description.trim()
  const projectKey = (
    input.projectKey?.trim()
    || server.bugReportProjectKey.trim()
    || server.env.JIRA_PROJECT_KEY
    || server.env.JIRA_PROJECT
    || ''
  ).trim().toUpperCase()
  const issueType = server.bugReportIssueType.trim() || 'Bug'
  const cloudId = (
    server.bugReportCloudId.trim()
    || server.env.JIRA_CLOUD_ID
    || server.env.JIRA_URL
    || ''
  ).trim()
  const standType = (
    server.env.JIRA_STAND_TYPE
    || server.env.JIRA_STAND
    || server.env.STAND_TYPE
    || server.env.JIRA_ENVIRONMENT_TYPE
    || server.env.ENVIRONMENT_TYPE
    || server.env.JIRA_TEST_ENVIRONMENT
    || server.env.TEST_ENVIRONMENT
    || server.env.ENVIRONMENT
    || ''
  ).trim()

  if (!summary) throw new Error('Bug summary is required.')
  if (!description) throw new Error('Bug description is required.')
  if (!projectKey) throw new Error('Project key is required to send the bug to Jira.')

  const args: Record<string, unknown> = {}
  const requiredNames = new Set(getSchemaRequiredNames(schema))
  const summaryField = pickSchemaField(schema, ['summary', 'title'])
  const descriptionField = pickSchemaField(schema, ['description', 'body'])
  const projectField = pickSchemaField(schema, ['projectKey', 'project_key', 'project', 'projectIdOrKey', 'project_id_or_key'])
  const issueTypeField = pickSchemaField(schema, ['issueTypeName', 'issue_type_name', 'issueType', 'issue_type', 'type'])
  const cloudIdField = pickSchemaField(schema, ['cloudId', 'cloud_id', 'cloudUrl', 'cloud_url'])
  const standTypeField = pickSchemaField(schema, ['standType', 'stand_type', 'stand', 'environmentType', 'environment_type', 'environment', 'testEnvironment', 'test_environment'])

  if (!summaryField || !descriptionField) {
    throw new Error('Atlassian MCP Jira issue tool schema is missing expected fields.')
  }

  args[summaryField] = summary
  args[descriptionField] = description

  if (projectField) args[projectField] = projectKey
  if (issueTypeField) args[issueTypeField] = issueType

  if (cloudIdField && cloudId) {
    args[cloudIdField] = cloudId
  }

  if (standTypeField && standType) {
    args[standTypeField] = standType
  }

  if (standTypeField && requiredNames.has(standTypeField) && !standType) {
    throw new Error('Jira stand type is required. Add it to MCP environment, for example JIRA_STAND_TYPE.')
  }

  const unresolvedCustomFieldKeys: string[] = []
  for (const [key, value] of Object.entries(input.customFields ?? {})) {
    const cleanKey = key.trim()
    const cleanValue = value.trim()
    if (!cleanKey || !cleanValue) continue
    const resolvedKey = resolveCustomSchemaFieldKey(schema, cleanKey)
    if (!resolvedKey) {
      unresolvedCustomFieldKeys.push(cleanKey)
      continue
    }
    args[resolvedKey] = cleanValue
  }

  if (unresolvedCustomFieldKeys.length) {
    const availableFields = getSchemaPropertyNames(schema)
    const fieldsSuffix = availableFields.length ? ` Available schema fields: ${availableFields.join(', ')}` : ''
    throw new Error(`Custom Jira fields were not recognized: ${unresolvedCustomFieldKeys.join(', ')}.${fieldsSuffix}`)
  }

  return args
}

function normalizeToolText(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase()
}

function hasBugReportFields(schema: unknown) {
  return Boolean(
    pickSchemaField(schema, ['summary', 'title'])
    && pickSchemaField(schema, ['description', 'body']),
  )
}

function scoreAtlassianBugTool(tool: McpToolDescriptor) {
  const name = normalizeToolText(tool.name)
  const description = normalizeToolText(tool.description)
  let score = 0

  if (!name) return -1
  if (name === 'createjiraissue') score += 100
  if (name.includes('jira')) score += 30
  if (name.includes('issue')) score += 20
  if (name.includes('create')) score += 15
  if (name.includes('bug')) score += 10

  if (description.includes('jira')) score += 20
  if (description.includes('issue')) score += 12
  if (description.includes('create')) score += 8
  if (description.includes('bug')) score += 6

  if (hasBugReportFields(tool.inputSchema)) score += 25
  if (pickSchemaField(tool.inputSchema, ['projectKey', 'project', 'projectIdOrKey'])) score += 8
  if (pickSchemaField(tool.inputSchema, ['issueTypeName', 'issueType', 'type'])) score += 4

  return score
}

function findAtlassianBugTool(tools: McpToolDescriptor[]) {
  const ranked = tools
    .map(tool => ({ tool, score: scoreAtlassianBugTool(tool) }))
    .sort((left, right) => right.score - left.score)

  const best = ranked[0]
  if (!best || best.score < 40) return null
  return best.tool
}

export async function sendBugReportToAtlassianMcp(
  servers: McpServerSettings[],
  input: SendBugReportInput,
) {
  const server = getAtlassianMcpServer(servers)
  if (!server) throw new Error('Atlassian MCP template is missing in Settings.')
  if (!isMcpServerConfigured(server)) {
    throw new Error('Atlassian MCP is not configured yet. Open Settings -> MCP and finish the template setup.')
  }

  const status = await getMcpServerStatus(server)
  if (!status.running) {
    throw new Error('Atlassian MCP server is not running. Start it in Settings → MCP first.')
  }

  const { tools } = await listMcpServerTools(server)
  const createIssueTool = findAtlassianBugTool(tools)
  if (!createIssueTool) {
    const toolNames = tools.map(tool => tool.name).filter(Boolean)
    const toolsSuffix = toolNames.length ? ` Available tools: ${toolNames.join(', ')}` : ' No tools were returned by the server.'
    throw new Error(`The connected Atlassian MCP server does not expose a Jira issue creation tool.${toolsSuffix}`)
  }

  const result = await callMcpTool({
    server,
    toolName: createIssueTool.name,
    arguments: buildAtlassianBugToolArguments(server, createIssueTool.inputSchema, input),
  })

  return result.text.trim() || 'Bug report sent via Atlassian MCP.'
}
