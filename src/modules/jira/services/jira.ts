import { safeJsonParse } from '../../../shared/utils/http'
import { platformFetch } from '../../../shared/utils/platformFetch'
import type { CaCertificate, ClientTlsIdentity, JiraIntegrationSettings } from '../../../shared/utils/appSettings'

export type JiraBugDraft = {
  summary: string
  description: string
}

export type JiraCreatedIssue = {
  key: string
  url: string
}

type JiraCreateIssueResponse = {
  key?: unknown
  self?: unknown
}

export type JiraTransportOptions = {
  validateCertificates: boolean
  caCertificates: CaCertificate[]
  clientTlsIdentity: ClientTlsIdentity | null
}

export type JiraConnectionTestResult = {
  message: string
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('Missing Jira Base URL.')
  let normalized = trimmed
  if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`
  const parsed = new URL(normalized)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Jira Base URL must use http or https.')
  }
  return parsed.toString().replace(/\/+$/, '')
}

function encodeBase64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function buildJiraDescriptionDocument(description: string) {
  const trimmed = description.trim()
  const blocks = trimmed ? trimmed.split(/\n\s*\n/g) : ['']

  return {
    type: 'doc',
    version: 1,
    content: blocks.map(block => {
      const lines = block.split('\n').map(line => line.trimEnd())
      const content: Array<Record<string, unknown>> = []
      lines.forEach((line, index) => {
        if (line) {
          content.push({
            type: 'text',
            text: line,
          })
        }
        if (index < lines.length - 1) {
          content.push({ type: 'hardBreak' })
        }
      })

      return {
        type: 'paragraph',
        content: content.length ? content : [{ type: 'text', text: ' ' }],
      }
    }),
  }
}

function formatJiraError(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null
  const rec = payload as Record<string, unknown>
  const errorMessages = Array.isArray(rec.errorMessages)
    ? rec.errorMessages.filter((value): value is string => typeof value === 'string' && !!value.trim())
    : []
  const fieldErrors = rec.errors && typeof rec.errors === 'object'
    ? Object.entries(rec.errors as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string' && !!value.trim())
      .map(([field, value]) => `${field}: ${value as string}`)
    : []
  const combined = [...errorMessages, ...fieldErrors]
  return combined.length ? combined.join('\n') : null
}

function getJiraFetchOptions(settings: JiraIntegrationSettings, transport: JiraTransportOptions) {
  const hasClientTlsIdentity = !!transport.clientTlsIdentity?.pkcs12Base64.trim()
  return {
    insecureTls: !transport.validateCertificates,
    caCertsPem: settings.useTlsCertificates ? transport.caCertificates.map(cert => cert.pem) : [],
    clientPkcs12Base64: settings.useTlsCertificates && hasClientTlsIdentity
      ? transport.clientTlsIdentity?.pkcs12Base64
      : undefined,
    clientPkcs12Password: settings.useTlsCertificates && hasClientTlsIdentity
      ? transport.clientTlsIdentity?.password
      : undefined,
  }
}

function getAuthorizationHeader(settings: JiraIntegrationSettings) {
  const email = settings.email.trim()
  const apiToken = settings.apiToken.trim()

  if (!email) throw new Error('Missing Jira email.')
  if (!apiToken) throw new Error('Missing Jira API token.')

  return `Basic ${encodeBase64(`${email}:${apiToken}`)}`
}

export function isJiraConfigured(settings: JiraIntegrationSettings) {
  return Boolean(settings.enabled
    && !!settings.baseUrl.trim()
    && !!settings.email.trim()
    && !!settings.apiToken.trim()
    && !!settings.projectKey.trim())
}

export async function createJiraIssue(
  settings: JiraIntegrationSettings,
  transport: JiraTransportOptions,
  draft: JiraBugDraft,
): Promise<JiraCreatedIssue> {
  if (!settings.enabled) throw new Error('Jira integration is disabled in Settings.')
  const baseUrl = normalizeBaseUrl(settings.baseUrl)
  const projectKey = settings.projectKey.trim().toUpperCase()
  const issueType = settings.issueType.trim() || 'Bug'
  const summary = draft.summary.trim()
  const description = draft.description.trim()

  if (!projectKey) throw new Error('Missing Jira project key.')
  if (!summary) throw new Error('Bug summary is required.')
  if (!description) throw new Error('Bug description is required.')

  const response = await platformFetch(`${baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: getAuthorizationHeader(settings),
    },
    body: JSON.stringify({
      fields: {
        project: { key: projectKey },
        issuetype: { name: issueType },
        summary,
        description: buildJiraDescriptionDocument(description),
      },
    }),
  }, getJiraFetchOptions(settings, transport))

  const text = await response.text()
  const parsed = safeJsonParse(text)
  if (!response.ok) {
    throw new Error(formatJiraError(parsed) ?? `Jira request failed (${response.status} ${response.statusText}).`)
  }

  const payload = parsed as JiraCreateIssueResponse | null
  const key = typeof payload?.key === 'string' ? payload.key : ''
  if (!key) {
    throw new Error('Jira created an issue but did not return an issue key.')
  }

  const selfUrl = typeof payload?.self === 'string' ? payload.self : ''
  const issueUrl = selfUrl || `${baseUrl}/browse/${key}`
  return {
    key,
    url: issueUrl.includes('/browse/') ? issueUrl : `${baseUrl}/browse/${key}`,
  }
}

export async function testJiraConnection(
  settings: JiraIntegrationSettings,
  transport: JiraTransportOptions,
): Promise<JiraConnectionTestResult> {
  if (!settings.enabled) throw new Error('Jira integration is disabled in Settings.')
  const baseUrl = normalizeBaseUrl(settings.baseUrl)
  const projectKey = settings.projectKey.trim().toUpperCase()

  if (!projectKey) throw new Error('Missing Jira project key.')

  const response = await platformFetch(`${baseUrl}/rest/api/3/project/${encodeURIComponent(projectKey)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: getAuthorizationHeader(settings),
    },
  }, getJiraFetchOptions(settings, transport))

  const text = await response.text()
  const parsed = safeJsonParse(text)
  if (!response.ok) {
    throw new Error(formatJiraError(parsed) ?? `Jira request failed (${response.status} ${response.statusText}).`)
  }

  const projectName = parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).name === 'string'
    ? (parsed as Record<string, string>).name
    : projectKey

  return {
    message: `Connection successful. Project ${projectKey}${projectName && projectName !== projectKey ? ` (${projectName})` : ''} is accessible.`,
  }
}
