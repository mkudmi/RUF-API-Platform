import type { AiProviderSettings } from '../../shared/utils/appSettings'
import { platformFetch } from '../../shared/utils/platformFetch'
import { safeJsonParse } from '../../shared/utils/http'
import { buildExplainApiPrompt, buildResponseSearchPrompt } from './prompts'

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
    }
  }>
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
  query: string
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

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') return item
        if (!item || typeof item !== 'object') return ''
        const rec = item as Record<string, unknown>
        if (typeof rec.text === 'string') return rec.text
        if (rec.type === 'output_text' && typeof rec.text === 'string') return rec.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
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
  const content = contentToText(parsed?.choices?.[0]?.message?.content)
  if (!content.trim()) {
    throw new Error('AI returned an empty response.')
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
  const content = stripMarkdownCodeFence(contentToText(parsed?.choices?.[0]?.message?.content))
  if (!content.trim()) {
    throw new Error('AI search returned an empty response.')
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
