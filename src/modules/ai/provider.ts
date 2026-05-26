import type { AiProviderSettings } from '../../shared/utils/appSettings'
import { platformFetch } from '../../shared/utils/platformFetch'
import { safeJsonParse } from '../../shared/utils/http'
import { buildExplainApiPrompt, buildResponseSchemaDiffPrompt, buildResponseSearchPrompt } from './prompts'
import { buildSchemaDiffTesterSummary } from './responseSchemaSummary'

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
  query: string
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
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return fenced ? fenced[1].trim() : trimmed
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

export async function generateResponseSearchQueryWithYandex(
  settings: AiProviderSettings,
  snapshot: AiResponseSearchSnapshot,
  userQuery: string,
): Promise<AiGeneratedSearchQuery> {
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

  const result = safeJsonParse(content) as Partial<AiGeneratedSearchQuery> | null
  if (!result || typeof result !== 'object') {
    throw new Error('AI search returned invalid JSON.')
  }

  const query = typeof result.query === 'string' ? result.query.trim() : ''
  if (!query) {
    throw new Error('AI search did not return a query.')
  }

  return { query }
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
