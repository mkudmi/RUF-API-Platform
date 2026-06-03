import type { McpServerSettings } from '../../shared/utils/appSettings'

export type McpToolDescriptor = {
  name: string
  description?: string | null
  inputSchema?: unknown
}

export type McpServerConnectionResult = {
  serverName: string
  tools: McpToolDescriptor[]
}

export type McpServerStatusResult = {
  serverId: string
  serverName?: string | null
  running: boolean
}

export type McpToolCallResult = {
  text: string
}

export type SendBugReportInput = {
  summary: string
  description: string
  projectKey?: string
  customFields?: Record<string, string>
}

export type McpToolCallRequest = {
  server: McpServerSettings
  toolName: string
  arguments: Record<string, unknown>
}
