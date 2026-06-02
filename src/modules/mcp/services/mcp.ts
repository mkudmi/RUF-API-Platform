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

function toServerPayload(server: McpServerSettings): McpCommandServerPayload {
  return {
    id: server.id,
    command: server.command.trim(),
    args: server.args,
    env: server.env,
  }
}

export function getAtlassianMcpServer(servers: McpServerSettings[]) {
  return servers.find(server => server.template === 'atlassian') ?? null
}

export function isMcpServerConfigured(server: McpServerSettings | null) {
  return Boolean(server?.enabled && server.command.trim() && server.args.length > 0)
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

function pickSchemaField(schema: unknown, candidates: string[]) {
  const propertyNames = new Set(getSchemaPropertyNames(schema))
  return candidates.find(candidate => propertyNames.has(candidate)) ?? null
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

  if (!summary) throw new Error('Bug summary is required.')
  if (!description) throw new Error('Bug description is required.')
  if (!projectKey) throw new Error('Project key is required to send the bug to Jira.')

  const args: Record<string, unknown> = {}
  const summaryField = pickSchemaField(schema, ['summary', 'title'])
  const descriptionField = pickSchemaField(schema, ['description', 'body'])
  const projectField = pickSchemaField(schema, ['projectKey', 'project', 'projectIdOrKey'])
  const issueTypeField = pickSchemaField(schema, ['issueTypeName', 'issueType', 'type'])
  const cloudIdField = pickSchemaField(schema, ['cloudId', 'cloudUrl'])

  if (!summaryField || !descriptionField) {
    throw new Error('Atlassian MCP createJiraIssue schema is missing expected fields.')
  }

  args[summaryField] = summary
  args[descriptionField] = description

  if (projectField) args[projectField] = projectKey
  if (issueTypeField) args[issueTypeField] = issueType

  if (cloudIdField && cloudId) {
    args[cloudIdField] = cloudId
  }

  return args
}

function findToolByName(tools: McpToolDescriptor[], name: string) {
  return tools.find(tool => tool.name === name) ?? null
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

  const { tools } = await startMcpServer(server)
  const createIssueTool = findToolByName(tools, 'createJiraIssue')
  if (!createIssueTool) {
    throw new Error('The connected Atlassian MCP server does not expose createJiraIssue.')
  }

  const result = await callMcpTool({
    server,
    toolName: createIssueTool.name,
    arguments: buildAtlassianBugToolArguments(server, createIssueTool.inputSchema, input),
  })

  return result.text.trim() || 'Bug report sent via Atlassian MCP.'
}
