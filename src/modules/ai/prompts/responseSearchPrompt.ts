import { safeJsonParse } from '../../../shared/utils/http'

type ResponseSearchSnapshot = {
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

type PromptTools = {
  stringifyHeaders: (headers: Record<string, string>) => string
  trimBody: (text: string, limit?: number) => string
}

type JsonStructureEntry = {
  path: string
  kind: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'
  samples: string[]
}

const MAX_STRUCTURE_DEPTH = 8
const MAX_STRUCTURE_ENTRIES = 160
const MAX_SAMPLES_PER_PATH = 3
const MAX_STRING_VALUE_HINTS = 120

function jsonKind(value: unknown): JsonStructureEntry['kind'] {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'object'
}

function formatSampleValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}...` : value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  return ''
}

function buildJsonStructureHints(text: string) {
  const parsed = safeJsonParse(text)
  if (parsed === null || typeof parsed !== 'object') return '(response body is not valid JSON)'

  const entries = new Map<string, JsonStructureEntry>()

  const ensureEntry = (path: string, value: unknown) => {
    if (!path || entries.size >= MAX_STRUCTURE_ENTRIES) return
    const kind = jsonKind(value)
    let entry = entries.get(path)
    if (!entry) {
      entry = { path, kind, samples: [] }
      entries.set(path, entry)
    }

    if (entry.kind === kind && entry.samples.length < MAX_SAMPLES_PER_PATH) {
      const sample = formatSampleValue(value)
      if (sample && !entry.samples.includes(sample)) entry.samples.push(sample)
    }
  }

  const visit = (value: unknown, path: string, depth: number) => {
    if (entries.size >= MAX_STRUCTURE_ENTRIES || depth > MAX_STRUCTURE_DEPTH) return
    ensureEntry(path, value)

    if (Array.isArray(value)) {
      const sampleItems = value.slice(0, 5)
      for (const item of sampleItems) {
        visit(item, `${path}[*]`, depth + 1)
        if (entries.size >= MAX_STRUCTURE_ENTRIES) return
      }
      return
    }

    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      visit(child, `${path}.${key}`, depth + 1)
      if (entries.size >= MAX_STRUCTURE_ENTRIES) return
    }
  }

  visit(parsed, '$', 0)

  const lines = Array.from(entries.values()).map(entry => {
    const sampleText = entry.samples.length ? ` | examples: ${entry.samples.join(', ')}` : ''
    return `${entry.path} -> ${entry.kind}${sampleText}`
  })

  return lines.length ? lines.join('\n') : '(no paths discovered)'
}

function buildJsonStringValueHints(text: string) {
  const parsed = safeJsonParse(text)
  if (parsed === null || typeof parsed !== 'object') return '(no string values discovered)'

  const lines: string[] = []
  const seen = new Set<string>()

  const visit = (value: unknown, path: string, depth: number) => {
    if (lines.length >= MAX_STRING_VALUE_HINTS || depth > MAX_STRUCTURE_DEPTH) return

    if (typeof value === 'string') {
      const normalized = value.trim()
      if (!normalized) return
      const sample = normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
      const line = `${path} = ${JSON.stringify(sample)}`
      if (seen.has(line)) return
      seen.add(line)
      lines.push(line)
      return
    }

    if (Array.isArray(value)) {
      const sampleItems = value.slice(0, 5)
      for (const item of sampleItems) {
        visit(item, `${path}[*]`, depth + 1)
        if (lines.length >= MAX_STRING_VALUE_HINTS) return
      }
      return
    }

    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      visit(child, `${path}.${key}`, depth + 1)
      if (lines.length >= MAX_STRING_VALUE_HINTS) return
    }
  }

  visit(parsed, '$', 0)
  return lines.length ? lines.join('\n') : '(no string values discovered)'
}

export function buildResponseSearchPrompt(snapshot: ResponseSearchSnapshot, userQuery: string, tools: PromptTools) {
  const responseStructureHints = buildJsonStructureHints(snapshot.response.bodyText)
  const responseStringValueHints = buildJsonStringValueHints(snapshot.response.bodyText)

  return [
    {
      role: 'system',
      content: [
        'You are a deterministic query translator inside Ruf API Platform.',
        'Convert the user request into exactly one valid Ruf JSON search query.',
        'Return only strict JSON: {"query":"..."}. No prose, no markdown.',
        'Allowed query forms: JSONPath starting with $; or simple filter: fieldPath op value.',
        'Allowed operators: = == != >= <= > < ~ !~.',
        'Use JSONPath for nested extraction, existence checks, lists, or when filter syntax is insufficient.',
        'Use simple filter for object filtering by field value.',
        'Infer the real field path, operator, and value type from the actual response structure and sample values.',
        'If the user is vague, choose the narrowest safe query matching the intent.',
        'The user may write in Russian while the response keys or values are in English; prefer the real response keys and values.',
        'Treat close word forms and singular/plural as the same intent when supported by the response values.',
        'Do not invent keys or values that are not supported by the response hints.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        'Преобразуй запрос пользователя в поисковый запрос Ruf.',
        '',
        'Верни только JSON вида: {"query":"..."}',
        '',
        'Допустимые query:',
        '{"query":"$..id"}',
        '{"query":"user.id = 42"}',
        '{"query":"status ~ failed"}',
        '{"query":"$.data.items[*].name"}',
        '{"query":"meta.traceId != null"}',
        '',
        `USER_QUERY: ${userQuery.trim()}`,
        '',
        'REQUEST_CONTEXT',
        `Method: ${snapshot.request.method}`,
        `URL: ${snapshot.request.url || '(unknown)'}`,
        'Headers:',
        tools.stringifyHeaders(snapshot.request.headers),
        'Body:',
        tools.trimBody(snapshot.request.bodyText, 8_000),
        '',
        'RESPONSE_CONTEXT',
        `Status: ${snapshot.response.status} ${snapshot.response.statusText}`,
        `Time: ${snapshot.response.timeMs} ms`,
        'Headers:',
        tools.stringifyHeaders(snapshot.response.headers),
        'RESPONSE_STRUCTURE_HINTS',
        responseStructureHints,
        'RESPONSE_STRING_VALUE_HINTS',
        responseStringValueHints,
        'Body:',
        tools.trimBody(snapshot.response.bodyText, 30_000),
        '',
        'Правила:',
        '- Используй реальные пути из RESPONSE_STRUCTURE_HINTS и реальные строковые значения из RESPONSE_STRING_VALUE_HINTS.',
        '- Если пользователь пишет не тем же языком, что и ответ, сопоставь смысл и используй фактические ключи и значения из ответа.',
        '- Если тип значения не указан, определи его по ответу: number, string, boolean, null, list.',
        '- Если нужен список значений, вложенные поля или проверка наличия поля, предпочитай JSONPath.',
        '- Если нужен поиск записей по значению поля, предпочитай simple filter.',
        '- Не возвращай ничего, кроме JSON с полем query.',
      ].join('\n'),
    },
  ]
}
