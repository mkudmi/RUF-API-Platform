import type { GlobalSqlConnectionItem, GlobalSqlConnectionSettings } from '../types/environment'
import { DEFAULT_GLOBAL_SQL_CONNECTION_SETTINGS } from '../types/environment'
import { safeParseJson } from './json'

export type CaCertificate = {
  id: string
  pem: string
  addedAt: number
  sha256?: string
  subject?: string
  issuer?: string
  notBefore?: string
  notAfter?: string
}

export type ClientTlsIdentity = {
  pkcs12Base64: string
  password: string
  fileName?: string
}

export type AiProviderSettings = {
  enabled: boolean
  provider: 'yandex'
  baseUrl: string
  apiKey: string
  folderId: string
  model: string
  temperature: number
  maxCompletionTokens: number
  timeoutMs: number
}

export type McpServerTemplate = 'atlassian' | 'postgres' | 'custom'

export type McpEnvEntry = {
  key: string
  value: string
}

export type McpServerSettings = {
  id: string
  name: string
  enabled: boolean
  template: McpServerTemplate
  command: string
  args: string[]
  env: Record<string, string>
  envEntries?: McpEnvEntry[]
  bugReportCloudId: string
  bugReportProjectKey: string
  bugReportIssueType: string
}

export type AppSettings = {
  validateCertificates: boolean
  caCertificates: CaCertificate[]
  clientTlsIdentity: ClientTlsIdentity | null
  requestTimeoutSec: number
  disableRequestTimeout: boolean
  globalSql: GlobalSqlConnectionSettings
  globalSqlConnections: GlobalSqlConnectionItem[]
  ai: AiProviderSettings
  mcp: McpServerSettings[]
}

export const DEFAULT_AI_PROVIDER_SETTINGS: AiProviderSettings = {
  enabled: false,
  provider: 'yandex',
  baseUrl: 'https://ai.api.cloud.yandex.net/v1',
  apiKey: '',
  folderId: '',
  model: 'qwen3.6-35b-a3b',
  temperature: 0.2,
  maxCompletionTokens: 900,
  timeoutMs: 30_000,
}

export const DEFAULT_ATLASSIAN_MCP_SERVER_SETTINGS: McpServerSettings = {
  id: 'mcp_atlassian_default',
  name: 'Atlassian MCP',
  enabled: false,
  template: 'atlassian',
  command: '',
  args: ['https://mcp.atlassian.com/v1/mcp/authv2'],
  env: {},
  envEntries: [],
  bugReportCloudId: '',
  bugReportProjectKey: '',
  bugReportIssueType: 'Bug',
}

export const DEFAULT_POSTGRES_MCP_SERVER_SETTINGS: McpServerSettings = {
  id: 'mcp_postgres_default',
  name: 'Postgres MCP',
  enabled: false,
  template: 'postgres',
  command: '',
  args: ['--access-mode=unrestricted'],
  env: {},
  envEntries: [
    { key: 'DB_USER', value: '' },
    { key: 'DB_PASSWORD', value: '' },
    { key: 'DB_HOST', value: 'localhost' },
    { key: 'DB_PORT', value: '5432' },
    { key: 'DB_NAME', value: '' },
  ],
  bugReportCloudId: '',
  bugReportProjectKey: '',
  bugReportIssueType: 'Bug',
}

function cloneMcpServerSettings(server: McpServerSettings): McpServerSettings {
  return {
    ...server,
    args: [...server.args],
    env: { ...server.env },
    envEntries: server.envEntries?.map(entry => ({ ...entry })) ?? [],
  }
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  validateCertificates: true,
  caCertificates: [],
  clientTlsIdentity: null,
  requestTimeoutSec: 300,
  disableRequestTimeout: false,
  globalSql: { ...DEFAULT_GLOBAL_SQL_CONNECTION_SETTINGS },
  globalSqlConnections: [],
  ai: { ...DEFAULT_AI_PROVIDER_SETTINGS },
  mcp: [
    cloneMcpServerSettings(DEFAULT_ATLASSIAN_MCP_SERVER_SETTINGS),
    cloneMcpServerSettings(DEFAULT_POSTGRES_MCP_SERVER_SETTINGS),
  ],
}

const APP_SETTINGS_KEY = 'ruf_app_settings_v1'

export function loadAppSettings(storage: Storage = localStorage): AppSettings {
  const parsed = safeParseJson<unknown>(storage.getItem(APP_SETTINGS_KEY))
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_APP_SETTINGS }

  const rec = parsed as Record<string, unknown>
  const validateCertificates = typeof rec.validateCertificates === 'boolean'
    ? rec.validateCertificates
    : DEFAULT_APP_SETTINGS.validateCertificates
  const requestTimeoutSec = (
    typeof rec.requestTimeoutSec === 'number' && Number.isFinite(rec.requestTimeoutSec)
      ? Math.max(0, Math.min(600, Math.round(rec.requestTimeoutSec)))
      : DEFAULT_APP_SETTINGS.requestTimeoutSec
  )
  const disableRequestTimeout = typeof rec.disableRequestTimeout === 'boolean'
    ? rec.disableRequestTimeout
    : DEFAULT_APP_SETTINGS.disableRequestTimeout

  const rawCa = rec.caCertificates
  const caCertificates: CaCertificate[] = Array.isArray(rawCa)
    ? rawCa
      .filter(x => x && typeof x === 'object')
      .map(x => x as Record<string, unknown>)
      .map((x): CaCertificate | null => {
        const id = typeof x.id === 'string' ? x.id : ''
        const pem = typeof x.pem === 'string' ? x.pem : ''
        const addedAt = typeof x.addedAt === 'number' ? x.addedAt : 0
        if (!id || !pem || !Number.isFinite(addedAt) || addedAt <= 0) return null
        const out: CaCertificate = { id, pem, addedAt }
        if (typeof x.sha256 === 'string') out.sha256 = x.sha256
        if (typeof x.subject === 'string') out.subject = x.subject
        if (typeof x.issuer === 'string') out.issuer = x.issuer
        if (typeof x.notBefore === 'string') out.notBefore = x.notBefore
        if (typeof x.notAfter === 'string') out.notAfter = x.notAfter
        return out
      })
      .filter((x): x is CaCertificate => !!x)
    : DEFAULT_APP_SETTINGS.caCertificates

  const rawClientTlsIdentity = rec.clientTlsIdentity
  const clientTlsIdentity: ClientTlsIdentity | null = (() => {
    if (!rawClientTlsIdentity || typeof rawClientTlsIdentity !== 'object') return null
    const tlsRec = rawClientTlsIdentity as Record<string, unknown>
    const pkcs12Base64 = typeof tlsRec.pkcs12Base64 === 'string' ? tlsRec.pkcs12Base64.trim() : ''
    const password = typeof tlsRec.password === 'string' ? tlsRec.password : ''
    const fileName = typeof tlsRec.fileName === 'string' ? tlsRec.fileName.trim() : ''
    if (!pkcs12Base64) return null
    return {
      pkcs12Base64,
      password,
      ...(fileName ? { fileName } : null),
    }
  })()

  const rawGlobalSql = rec.globalSql
  const baseSql = DEFAULT_GLOBAL_SQL_CONNECTION_SETTINGS
  const globalSql: GlobalSqlConnectionSettings = (() => {
    if (!rawGlobalSql || typeof rawGlobalSql !== 'object') return { ...baseSql }
    const sqlRec = rawGlobalSql as Record<string, unknown>
    const type = sqlRec.type === 'mysql' ? 'mysql' : 'postgres'
    const sslRaw = typeof sqlRec.sslmode === 'string' ? sqlRec.sslmode : ''
    const sslmode =
      sslRaw === 'disable' || sslRaw === 'allow' || sslRaw === 'prefer' || sslRaw === 'require' || sslRaw === 'verify-ca' || sslRaw === 'verify-full'
        ? sslRaw
        : 'prefer'
    const defaultPort = type === 'mysql' ? '3306' : '5432'
    return {
      type,
      sslmode,
      host: typeof sqlRec.host === 'string' ? sqlRec.host : '',
      port: typeof sqlRec.port === 'string' ? sqlRec.port : defaultPort,
      database: typeof sqlRec.database === 'string' ? sqlRec.database : '',
      username: typeof sqlRec.username === 'string' ? sqlRec.username : '',
      password: typeof sqlRec.password === 'string' ? sqlRec.password : '',
    }
  })()

  const rawGlobalSqlConnections = rec.globalSqlConnections
  const globalSqlConnections: GlobalSqlConnectionItem[] = Array.isArray(rawGlobalSqlConnections)
    ? rawGlobalSqlConnections
      .filter(x => x && typeof x === 'object')
      .map(x => x as Record<string, unknown>)
      .map((x): GlobalSqlConnectionItem | null => {
        const id = typeof x.id === 'string' ? x.id.trim() : ''
        const name = typeof x.name === 'string' ? x.name.trim() : ''
        if (!id || !name) return null
        const type = x.type === 'mysql' ? 'mysql' : 'postgres'
        const sslRaw = typeof x.sslmode === 'string' ? x.sslmode : ''
        const sslmode =
          sslRaw === 'disable' || sslRaw === 'allow' || sslRaw === 'prefer' || sslRaw === 'require' || sslRaw === 'verify-ca' || sslRaw === 'verify-full'
            ? sslRaw
            : 'prefer'
        const defaultPort = type === 'mysql' ? '3306' : '5432'
        return {
          id,
          name,
          type,
          sslmode,
          host: typeof x.host === 'string' ? x.host : '',
          port: typeof x.port === 'string' ? x.port : defaultPort,
          database: typeof x.database === 'string' ? x.database : '',
          username: typeof x.username === 'string' ? x.username : '',
          password: typeof x.password === 'string' ? x.password : '',
        }
      })
      .filter((x): x is GlobalSqlConnectionItem => !!x)
    : []

  const rawAi = rec.ai
  const ai: AiProviderSettings = (() => {
    if (!rawAi || typeof rawAi !== 'object') return { ...DEFAULT_AI_PROVIDER_SETTINGS }
    const aiRec = rawAi as Record<string, unknown>
    const provider = aiRec.provider === 'yandex' ? 'yandex' : DEFAULT_AI_PROVIDER_SETTINGS.provider
    const baseUrl = typeof aiRec.baseUrl === 'string' && aiRec.baseUrl.trim()
      ? aiRec.baseUrl.trim()
      : DEFAULT_AI_PROVIDER_SETTINGS.baseUrl
    const apiKey = typeof aiRec.apiKey === 'string' ? aiRec.apiKey : ''
    const folderId = typeof aiRec.folderId === 'string' ? aiRec.folderId.trim() : ''
    const model = typeof aiRec.model === 'string' && aiRec.model.trim()
      ? aiRec.model.trim()
      : DEFAULT_AI_PROVIDER_SETTINGS.model
    const temperature = typeof aiRec.temperature === 'number' && Number.isFinite(aiRec.temperature)
      ? Math.max(0, Math.min(2, aiRec.temperature))
      : DEFAULT_AI_PROVIDER_SETTINGS.temperature
    const maxCompletionTokens = typeof aiRec.maxCompletionTokens === 'number' && Number.isFinite(aiRec.maxCompletionTokens)
      ? Math.max(64, Math.min(16_384, Math.round(aiRec.maxCompletionTokens)))
      : DEFAULT_AI_PROVIDER_SETTINGS.maxCompletionTokens
    const timeoutMs = typeof aiRec.timeoutMs === 'number' && Number.isFinite(aiRec.timeoutMs)
      ? Math.max(1_000, Math.min(300_000, Math.round(aiRec.timeoutMs)))
      : DEFAULT_AI_PROVIDER_SETTINGS.timeoutMs

    return {
      enabled: typeof aiRec.enabled === 'boolean' ? aiRec.enabled : DEFAULT_AI_PROVIDER_SETTINGS.enabled,
      provider,
      baseUrl,
      apiKey,
      folderId,
      model,
      temperature,
      maxCompletionTokens,
      timeoutMs,
    }
  })()

  const rawMcp = rec.mcp
  const mcp: McpServerSettings[] = Array.isArray(rawMcp)
    ? rawMcp
      .filter(x => x && typeof x === 'object')
      .map(x => x as Record<string, unknown>)
      .map((x, index): McpServerSettings | null => {
        const id = typeof x.id === 'string' && x.id.trim() ? x.id.trim() : `mcp_server_${index + 1}`
        const name = typeof x.name === 'string' && x.name.trim()
          ? x.name.trim()
          : (index === 0 ? DEFAULT_ATLASSIAN_MCP_SERVER_SETTINGS.name : `MCP Server ${index + 1}`)
        const template = x.template === 'atlassian'
          ? 'atlassian'
          : x.template === 'postgres'
            ? 'postgres'
            : 'custom'
        const command = typeof x.command === 'string' ? x.command.trim() : ''
        const args = Array.isArray(x.args)
          ? x.args.filter((arg): arg is string => typeof arg === 'string')
          : []
        const env = x.env && typeof x.env === 'object'
          ? Object.fromEntries(
            Object.entries(x.env as Record<string, unknown>)
              .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && !!entry[0].trim() && typeof entry[1] === 'string'),
          )
          : {}
        const envEntries = Array.isArray(x.envEntries)
          ? x.envEntries
            .filter(item => item && typeof item === 'object')
            .map(item => item as Record<string, unknown>)
            .map((item): McpEnvEntry | null => {
              const key = typeof item.key === 'string' ? item.key : ''
              const value = typeof item.value === 'string' ? item.value : ''
              if (!key.trim() && !value.trim()) return null
              return { key, value }
            })
            .filter((item): item is McpEnvEntry => !!item)
          : Object.entries(env).map(([key, value]) => ({ key, value }))
        return {
          id,
          name,
          enabled: typeof x.enabled === 'boolean' ? x.enabled : false,
          template,
          command,
          args,
          env,
          envEntries,
          bugReportCloudId: typeof x.bugReportCloudId === 'string' ? x.bugReportCloudId.trim() : '',
          bugReportProjectKey: typeof x.bugReportProjectKey === 'string' ? x.bugReportProjectKey.trim().toUpperCase() : '',
          bugReportIssueType: typeof x.bugReportIssueType === 'string' && x.bugReportIssueType.trim()
            ? x.bugReportIssueType.trim()
            : DEFAULT_ATLASSIAN_MCP_SERVER_SETTINGS.bugReportIssueType,
        }
      })
      .filter((x): x is McpServerSettings => !!x)
    : []

  const mcpWithRequiredTemplates = [...mcp]
  if (!mcpWithRequiredTemplates.some(server => server.template === 'atlassian')) {
    mcpWithRequiredTemplates.unshift(cloneMcpServerSettings(DEFAULT_ATLASSIAN_MCP_SERVER_SETTINGS))
  }
  if (!mcpWithRequiredTemplates.some(server => server.template === 'postgres')) {
    const atlassianIndex = mcpWithRequiredTemplates.findIndex(server => server.template === 'atlassian')
    const insertIndex = atlassianIndex >= 0 ? atlassianIndex + 1 : 0
    mcpWithRequiredTemplates.splice(insertIndex, 0, cloneMcpServerSettings(DEFAULT_POSTGRES_MCP_SERVER_SETTINGS))
  }

  return {
    validateCertificates,
    caCertificates,
    clientTlsIdentity,
    requestTimeoutSec,
    disableRequestTimeout,
    globalSql,
    globalSqlConnections,
    ai,
    mcp: mcpWithRequiredTemplates.length
      ? mcpWithRequiredTemplates
      : [
        cloneMcpServerSettings(DEFAULT_ATLASSIAN_MCP_SERVER_SETTINGS),
        cloneMcpServerSettings(DEFAULT_POSTGRES_MCP_SERVER_SETTINGS),
      ],
  }
}

export function saveAppSettings(settings: AppSettings, storage: Storage = localStorage) {
  storage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings))
}
