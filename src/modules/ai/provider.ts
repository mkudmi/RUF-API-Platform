import type { AiProviderSettings } from '../../shared/utils/appSettings'
import jsonata from 'jsonata'
import { platformFetch } from '../../shared/utils/platformFetch'
import { safeJsonParse } from '../../shared/utils/http'
import { buildBugReportPrompt, buildExplainApiPrompt, buildResponseSchemaDiffPrompt, buildResponseSearchPrompt, buildSqlEnhancementPrompt } from './prompts'
import { buildSchemaDiffTesterSummary } from './responseSchemaSummary'
import { buildHeuristicResponseSearchQuery } from './responseSearchHeuristics'

export type AiExplainSnapshot = {
  request: {
    method: string
    url: string
    urlTemplate: string
    headers: Record<string, string>
    queryParams: Record<string, string>
    bodyText: string
    contentType: string
  }
  response?: {
    ok: boolean
    status: number
    statusText: string
    headers: Record<string, string>
    bodyText: string
    timeMs: number
  } | null
}

type YandexChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown
      text?: unknown
      reasoning_content?: unknown
      refusal?: unknown
    }
  }>
}

type YandexChatMessage = NonNullable<NonNullable<YandexChatCompletionResponse['choices']>[number]['message']>

export type AiChatPromptMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function buildYandexModelUri(settings: AiProviderSettings) {
  const model = settings.model.trim()
  if (!model) return ''
  if (model.startsWith('gpt://')) return model
  return `gpt://${settings.folderId.trim()}/${model}`
}

function buildYandexHeaders(settings: AiProviderSettings) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Api-Key ${settings.apiKey.trim()}`,
    'OpenAI-Project': settings.folderId.trim(),
  }
}

export type AiResponseSearchSnapshot = {
  request: {
    method: string
    url: string
    headers: Record<string, string>
    bodyText: string
  }
  response: {
    status: number
    statusText: string
    headers: Record<string, string>
    bodyText: string
    timeMs: number
  }
}

export type AiGeneratedSearchQuery = {
  query: string | null
  error: string | null
}

type AiGeneratedSearchPlan = { query?: unknown, error?: unknown }

export type AiEnhancedBugReport = {
  summary: string
  description: string
}

export type AiResponseSchemaDiffSnapshot = {
  request: {
    name: string
    method: string
    path: string
  }
  baselineSchemaText: string
  actualSchemaText: string
}

export type AiSqlEnhancementSnapshot = {
  sql: string
  dialect: 'postgres' | 'mysql'
  schema?: string
}

export type AiSqlEnhancementResult = {
  sql: string
  summary: string
}

function stringifyHeaders(headers: Record<string, string>) {
  const entries = Object.entries(headers || {}).sort(([a], [b]) => a.localeCompare(b))
  if (!entries.length) return '(none)'
  return entries.map(([key, value]) => `${key}: ${value}`).join('\n')
}

function trimBody(text: string, limit = 10_000) {
  const raw = (text || '').trim()
  if (!raw) return '(empty)'
  if (raw.length <= limit) return raw
  return `${raw.slice(0, limit)}\n...[truncated ${raw.length - limit} chars]`
}

function contentPartToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const rec = content as Record<string, unknown>
    if (typeof rec.text === 'string') return rec.text
    if (rec.text && typeof rec.text === 'object') {
      const textRec = rec.text as Record<string, unknown>
      if (typeof textRec.value === 'string') return textRec.value
    }
    if (typeof rec.content === 'string') return rec.content
    if (typeof rec.reasoning_content === 'string') return rec.reasoning_content
  }
  if (Array.isArray(content)) {
    return content
      .map(item => contentPartToText(item))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function messageToText(message: YandexChatMessage | undefined): string {
  if (!message) return ''
  const primary = contentPartToText(message.content)
  if (primary.trim()) return primary.trim()

  const fallbackFields = [
    contentPartToText(message.text),
    contentPartToText(message.reasoning_content),
    contentPartToText(message.refusal),
  ]
  return fallbackFields.find(text => text.trim())?.trim() ?? ''
}

function buildEmptyAiResponseError(prefix: string, rawText: string) {
  return `${prefix} Empty content. Raw payload: ${trimBody(rawText, 600)}`
}

function looksLikeReasoningLeak(text: string) {
  const normalized = text.toLowerCase()
  return normalized.includes('thinking process')
    || normalized.includes('analyze user input')
    || normalized.includes('mental walkthrough')
    || normalized.includes('output format required')
    || normalized.includes('the user wants')
    || normalized.includes('i need to determine')
    || normalized.includes('looking at the')
    || normalized.includes('the jsonata query should be')
    || normalized.includes('i will construct')
    || normalized.includes('let me')
}

function isProbablyBareJsonataQuery(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (looksLikeReasoningLeak(trimmed)) return false
  if (trimmed === '...' || trimmed === '..' || trimmed === '.') return false

  const compact = trimmed.replace(/\s+/g, ' ')

  const hasJsonataSignals =
    compact.startsWith('$')
    || compact.startsWith('{')
    || compact.startsWith('[')
    || compact.includes('$contains(')
    || compact.includes('$lowercase(')
    || compact.includes('[')
    || compact.includes('=')
    || /:\s*[A-Za-z_$]/.test(compact)

  if (!hasJsonataSignals) return false

  const suspiciousPhrases = [
    'response_context',
    'response_string_value_hints',
    'query should be',
    'user asks',
    'contains the text',
  ]
  const lower = compact.toLowerCase()
  if (suspiciousPhrases.some(phrase => lower.includes(phrase))) return false

  try {
    jsonata(trimmed).ast()
    return true
  } catch {
    return false
  }
}

function normalizeAiJsonataQuery(query: string): string | null {
  let trimmed = query.trim()
  if (!trimmed) return null

  for (let i = 0; i < 3; i++) {
    const parsed = safeJsonParse(trimmed)
    if (typeof parsed !== 'string') break
    trimmed = parsed.trim()
    if (!trimmed) return null
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
    || (trimmed.startsWith('`') && trimmed.endsWith('`'))
  ) {
    trimmed = trimmed.slice(1, -1).trim()
  }

  trimmed = trimmed
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\\\/g, '\\')
    .trim()

  if ((trimmed.startsWith('{\\') || trimmed.startsWith('[\\')) && trimmed.includes('\\"')) {
    trimmed = trimmed.replace(/\\"/g, '"').trim()
  }

  if (!trimmed) return null
  if (looksLikeReasoningLeak(trimmed)) return null
  return trimmed
}

function extractLooseQueryField(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const lineMatch = trimmed.match(/^\s*["']?query["']?\s*:\s*([\s\S]+)$/i)
  if (lineMatch) {
    const raw = lineMatch[1].trim().replace(/^[`'"]+|[`'"]+$/g, '')
    return raw || null
  }

  const jsonLikeMatch = trimmed.match(/["']query["']\s*:\s*(["'])([\s\S]*?)\1/i)
  if (jsonLikeMatch) {
    const raw = jsonLikeMatch[2]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .trim()
    return raw || null
  }

  return null
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:[A-Za-z0-9_-]+)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return fenced ? fenced[1].trim() : trimmed
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const char = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

function parseJsonFromAiText<T>(text: string): T | null {
  const direct = safeJsonParse(text) as T | null
  if (direct && typeof direct === 'object') return direct

  const extracted = extractFirstJsonObject(text)
  if (!extracted) return null

  const fallback = safeJsonParse(extracted) as T | null
  return fallback && typeof fallback === 'object' ? fallback : null
}

function normalizeBugReportField(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^[`"'“”]+|[`"'“”]+$/g, '')
    .trim()
}

function isLowValueBugReportText(text: string): boolean {
  const normalized = normalizeBugReportField(text).replace(/\s+/g, '')
  if (!normalized) return true
  return /^([.]{2,}|[…]{1,}|[-_]{2,})$/.test(normalized)
}

function looksLikeBugReportPromptLeak(text: string): boolean {
  const normalized = text.toLowerCase()
  return normalized.includes('<one concise line>')
    || normalized.includes('<improved plain-text description>')
    || normalized.includes('short bug title')
    || normalized.includes('evaluate input summary')
    || normalized.includes('evaluate input description')
    || normalized.includes('the instruction says')
    || normalized.includes('current summary:')
    || normalized.includes('черновик описания:')
    || normalized.includes('текущий summary:')
    || normalized.includes('let\'s stick to')
    || normalized.includes('i need to create')
    || normalized.includes('reasoning')
}

function extractLabeledBugReportSection(text: string, label: 'SUMMARY' | 'DESCRIPTION'): string {
  const source = text.replace(/\r\n/g, '\n')
  if (label === 'SUMMARY') {
    const match = source.match(/(?:^|\n)\s*SUMMARY\s*:\s*([^\n]+)/i)
    return normalizeBugReportField(match?.[1] ?? '')
  }
  const match = source.match(/(?:^|\n)\s*DESCRIPTION\s*:\s*([\s\S]*)$/i)
  return normalizeBugReportField(match?.[1] ?? '')
}

function deriveBugReportSummary(description: string): string {
  const line = description
    .split('\n')
    .map(item => item.trim())
    .find(Boolean)

  if (!line) return ''
  const compact = line.replace(/\s+/g, ' ').trim()
  if (compact.length <= 120) return compact
  return `${compact.slice(0, 117).trimEnd()}...`
}

function parseEnhancedBugReportText(
  content: string,
  input: { summary: string, description: string },
): AiEnhancedBugReport | null {
  const normalizedContent = stripMarkdownCodeFence(content).trim()
  if (isLowValueBugReportText(normalizedContent)) return null
  if (looksLikeReasoningLeak(normalizedContent) || looksLikeBugReportPromptLeak(normalizedContent)) return null

  const parsedJson = parseJsonFromAiText<Partial<AiEnhancedBugReport>>(normalizedContent)
  const jsonSummary = typeof parsedJson?.summary === 'string' ? normalizeBugReportField(parsedJson.summary) : ''
  const jsonDescription = typeof parsedJson?.description === 'string' ? normalizeBugReportField(parsedJson.description) : ''

  const labeledSummary = extractLabeledBugReportSection(normalizedContent, 'SUMMARY')
  const labeledDescription = extractLabeledBugReportSection(normalizedContent, 'DESCRIPTION')

  let summary = labeledSummary || jsonSummary
  let description = labeledDescription || jsonDescription
  const fallbackSummary = normalizeBugReportField(input.summary)
  const fallbackDescription = normalizeBugReportField(input.description)

  if (!description && normalizedContent) {
    description = normalizeBugReportField(normalizedContent)
  }

  if (isLowValueBugReportText(summary)) summary = ''
  if (isLowValueBugReportText(description)) description = ''

  if (!summary) summary = fallbackSummary || deriveBugReportSummary(description || fallbackDescription)
  if (!description) description = fallbackDescription

  if (!summary || !description || isLowValueBugReportText(description)) return null
  return { summary, description }
}

async function requestBugReportEnhancement(
  settings: AiProviderSettings,
  input: { summary: string, description: string },
  options?: { retry?: boolean },
): Promise<string> {
  const body = {
    model: buildYandexModelUri(settings),
    temperature: 0,
    max_completion_tokens: settings.maxCompletionTokens,
    stream: false,
    messages: buildBugReportPrompt(input, options),
  }

  const response = await platformFetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: buildYandexHeaders(settings),
    body: JSON.stringify(body),
  }, {
    timeoutMs: settings.timeoutMs,
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`AI bug report enhancement failed (${response.status} ${response.statusText}): ${trimBody(text, 800)}`)
  }

  const parsed = safeJsonParse(text) as YandexChatCompletionResponse | null
  const content = stripMarkdownCodeFence(messageToText(parsed?.choices?.[0]?.message))
  if (!content.trim()) {
    throw new Error(buildEmptyAiResponseError('AI bug report enhancement returned an empty response.', text))
  }

  return content
}

function ensureYandexSettings(settings: AiProviderSettings) {
  if (!settings.enabled) throw new Error('AI is disabled in Settings.')
  if (!settings.apiKey.trim()) throw new Error('Missing Yandex AI Studio API key.')
  if (!settings.folderId.trim()) throw new Error('Missing Yandex AI Studio folder ID.')
  if (!buildYandexModelUri(settings)) throw new Error('Missing model ID.')
}

export async function testYandexAiStudioConnection(settings: AiProviderSettings): Promise<string> {
  ensureYandexSettings(settings)
  const response = await platformFetch(`${settings.baseUrl.replace(/\/+$/, '')}/models`, {
    method: 'GET',
    headers: buildYandexHeaders(settings),
  }, {
    timeoutMs: settings.timeoutMs,
  })

  const text = await response.text()
  const parsed = safeJsonParse(text) as { data?: Array<{ id?: string }> } | null
  if (!response.ok) {
    throw new Error(`Connection failed (${response.status} ${response.statusText}): ${trimBody(text, 600)}`)
  }

  const total = Array.isArray(parsed?.data) ? parsed.data.length : 0
  return total > 0 ? `Connected. Models available: ${total}.` : 'Connected.'
}

export async function explainApiWithYandex(settings: AiProviderSettings, snapshot: AiExplainSnapshot): Promise<string> {
  ensureYandexSettings(settings)

  const body = {
    model: buildYandexModelUri(settings),
    temperature: settings.temperature,
    max_completion_tokens: settings.maxCompletionTokens,
    stream: false,
    messages: buildExplainApiPrompt(snapshot, { stringifyHeaders, trimBody }),
  }

  const response = await platformFetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: buildYandexHeaders(settings),
    body: JSON.stringify(body),
  }, {
    timeoutMs: settings.timeoutMs,
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`AI request failed (${response.status} ${response.statusText}): ${trimBody(text, 800)}`)
  }

  const parsed = safeJsonParse(text) as YandexChatCompletionResponse | null
  const content = messageToText(parsed?.choices?.[0]?.message)
  if (!content.trim()) {
    throw new Error(buildEmptyAiResponseError('AI returned an empty response.', text))
  }
  return content.trim()
}

export async function completeJsonWithYandex<T extends object>(
  settings: AiProviderSettings,
  options: {
    messages: AiChatPromptMessage[]
    temperature?: number
    errorPrefix?: string
  },
): Promise<T> {
  ensureYandexSettings(settings)

  const errorPrefix = options.errorPrefix?.trim() || 'AI request'
  const body = {
    model: buildYandexModelUri(settings),
    temperature: options.temperature ?? 0.1,
    max_completion_tokens: settings.maxCompletionTokens,
    stream: false,
    messages: options.messages,
  }

  const response = await platformFetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: buildYandexHeaders(settings),
    body: JSON.stringify(body),
  }, {
    timeoutMs: settings.timeoutMs,
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${errorPrefix} failed (${response.status} ${response.statusText}): ${trimBody(text, 800)}`)
  }

  const parsed = safeJsonParse(text) as YandexChatCompletionResponse | null
  const content = stripMarkdownCodeFence(messageToText(parsed?.choices?.[0]?.message))
  if (!content.trim()) {
    throw new Error(buildEmptyAiResponseError(`${errorPrefix} returned an empty response.`, text))
  }

  const result = parseJsonFromAiText<T>(content)
  if (!result || typeof result !== 'object') {
    throw new Error(`${errorPrefix} returned invalid JSON.`)
  }

  return result
}

export async function generateResponseSearchQueryWithYandex(
  settings: AiProviderSettings,
  snapshot: AiResponseSearchSnapshot,
  userQuery: string,
): Promise<AiGeneratedSearchQuery> {
  // Prefer deterministic local planning for common structured filters to avoid
  // LLM format drift and first-run/second-run inconsistencies.
  const heuristic = buildHeuristicResponseSearchQuery(snapshot, userQuery)
  if (heuristic) {
    return { query: heuristic, error: null }
  }

  ensureYandexSettings(settings)

  const body = {
    model: buildYandexModelUri(settings),
    temperature: 0,
    max_completion_tokens: settings.maxCompletionTokens,
    stream: false,
    messages: buildResponseSearchPrompt(snapshot, userQuery, { stringifyHeaders, trimBody }),
  }

  const response = await platformFetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: buildYandexHeaders(settings),
    body: JSON.stringify(body),
  }, {
    timeoutMs: settings.timeoutMs,
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`AI search failed (${response.status} ${response.statusText}): ${trimBody(text, 800)}`)
  }

  const parsed = safeJsonParse(text) as YandexChatCompletionResponse | null
  const content = stripMarkdownCodeFence(messageToText(parsed?.choices?.[0]?.message))
  if (!content.trim()) {
    throw new Error(buildEmptyAiResponseError('AI search returned an empty response.', text))
  }

  const result = parseJsonFromAiText<AiGeneratedSearchPlan>(content)
  if (!result || typeof result !== 'object') {
    const looseQuery = extractLooseQueryField(content)
    if (looseQuery) {
      const normalized = normalizeAiJsonataQuery(looseQuery)
      if (normalized && isProbablyBareJsonataQuery(normalized)) return { query: normalized, error: null }
    }

    const rawQuery = content.trim()
    if (isProbablyBareJsonataQuery(rawQuery)) {
      const normalized = normalizeAiJsonataQuery(rawQuery)
      if (normalized) return { query: normalized, error: null }
    }
    throw new Error('AI search returned invalid JSON.')
  }

  const error = typeof result.error === 'string' ? result.error.trim() : ''

  if (error) {
    return { query: null, error }
  }

  const query = typeof result.query === 'string' ? normalizeAiJsonataQuery(result.query) : null
  if (!query || !isProbablyBareJsonataQuery(query)) {
    throw new Error('AI search did not return a valid JSONata query.')
  }
  return { query, error: null }
}

export async function compareResponseSchemaWithYandex(
  settings: AiProviderSettings,
  snapshot: AiResponseSchemaDiffSnapshot,
): Promise<string> {
  ensureYandexSettings(settings)

  const body = {
    model: buildYandexModelUri(settings),
    temperature: 0,
    max_completion_tokens: settings.maxCompletionTokens,
    stream: false,
    messages: buildResponseSchemaDiffPrompt(snapshot),
  }

  const response = await platformFetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: buildYandexHeaders(settings),
    body: JSON.stringify(body),
  }, {
    timeoutMs: settings.timeoutMs,
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`AI schema diff failed (${response.status} ${response.statusText}): ${trimBody(text, 800)}`)
  }

  const parsed = safeJsonParse(text) as YandexChatCompletionResponse | null
  const content = messageToText(parsed?.choices?.[0]?.message)
  if (!content.trim()) {
    throw new Error(buildEmptyAiResponseError('AI schema diff returned an empty response.', text))
  }

  const trimmed = content.trim()
  if (looksLikeReasoningLeak(trimmed)) {
    return buildSchemaDiffTesterSummary({
      request: snapshot.request,
      baselineSchemaText: snapshot.baselineSchemaText,
      actualSchemaText: snapshot.actualSchemaText,
    })
  }

  return trimmed
}

export async function enhanceBugReportWithYandex(
  settings: AiProviderSettings,
  input: { summary: string, description: string },
): Promise<AiEnhancedBugReport> {
  ensureYandexSettings(settings)
  const normalizedInputSummary = normalizeBugReportField(input.summary)
  const normalizedInputDescription = normalizeBugReportField(input.description)

  const firstContent = await requestBugReportEnhancement(settings, input)
  const firstResult = parseEnhancedBugReportText(firstContent, input)
  if (firstResult) return firstResult

  const retryContent = await requestBugReportEnhancement(settings, input, { retry: true })
  const retryResult = parseEnhancedBugReportText(retryContent, input)
  if (retryResult) return retryResult

  return {
    summary: normalizedInputSummary || deriveBugReportSummary(normalizedInputDescription),
    description: normalizedInputDescription,
  }
}

export async function enhanceSqlWithYandex(
  settings: AiProviderSettings,
  snapshot: AiSqlEnhancementSnapshot,
): Promise<AiSqlEnhancementResult> {
  ensureYandexSettings(settings)

  const body = {
    model: buildYandexModelUri(settings),
    temperature: 0.1,
    max_completion_tokens: settings.maxCompletionTokens,
    stream: false,
    messages: buildSqlEnhancementPrompt(snapshot),
  }

  const response = await platformFetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: buildYandexHeaders(settings),
    body: JSON.stringify(body),
  }, {
    timeoutMs: settings.timeoutMs,
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`AI SQL enhancement failed (${response.status} ${response.statusText}): ${trimBody(text, 800)}`)
  }

  const parsed = safeJsonParse(text) as YandexChatCompletionResponse | null
  const content = stripMarkdownCodeFence(messageToText(parsed?.choices?.[0]?.message))
  if (!content.trim()) {
    throw new Error(buildEmptyAiResponseError('AI SQL enhancement returned an empty response.', text))
  }

  const result = parseJsonFromAiText<Partial<AiSqlEnhancementResult>>(content)
  if (!result || typeof result !== 'object') {
    throw new Error('AI SQL enhancement returned invalid JSON.')
  }

  const sql = typeof result.sql === 'string' ? result.sql.trim() : ''
  const summary = typeof result.summary === 'string' ? result.summary.trim() : ''
  if (!sql) {
    throw new Error('AI SQL enhancement did not return SQL.')
  }

  return { sql, summary: summary || 'SQL checked.' }
}
