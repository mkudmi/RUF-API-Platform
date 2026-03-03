export type VariableSuggestion = {
  name: string
  description?: string
  kind: 'environment' | 'builtin'
}

export type DataDrivenDatasetFormat = 'json' | 'csv'
export type DataDrivenRow = Record<string, string>
export type DataDrivenDatasetParseResult = {
  format: DataDrivenDatasetFormat
  rows: DataDrivenRow[]
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function formatLocalTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function formatLocalDateTime(d: Date): string {
  return `${formatLocalDate(d)}T${formatLocalTime(d)}`
}

function formatUtcDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

function formatUtcTime(d: Date): string {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
}

function formatUtcDateTime(d: Date): string {
  return `${formatUtcDate(d)}T${formatUtcTime(d)}Z`
}

type BuiltinVar = {
  name: string
  description: string
  get?: () => string
}

function randomUuid(): string {
  const anyCrypto: Crypto | undefined = ('crypto' in globalThis) ? globalThis.crypto : undefined
  if (anyCrypto?.randomUUID) return anyCrypto.randomUUID()

  // RFC 4122 version 4 UUID via getRandomValues fallback
  const bytes = new Uint8Array(16)
  if (anyCrypto?.getRandomValues) anyCrypto.getRandomValues(bytes)
  else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
}

function randomString(length: number): string {
  const size = Math.max(0, Math.min(Math.floor(length), 100000))
  if (!size) return ''

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const anyCrypto: Crypto | undefined = ('crypto' in globalThis) ? globalThis.crypto : undefined

  if (anyCrypto?.getRandomValues) {
    const bytes = new Uint8Array(size)
    anyCrypto.getRandomValues(bytes)
    let out = ''
    for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length]
    return out
  }

  let out = ''
  for (let i = 0; i < size; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

const BUILTIN_VARIABLES: BuiltinVar[] = [
  { name: 'uuid', description: 'Random UUID (v4)', get: () => randomUuid() },
  { name: 'random.string(length)', description: 'Random alphanumeric string with the given length' },
  { name: 'localdatetimenow', description: 'Local date-time (YYYY-MM-DDTHH:mm:ss)', get: () => formatLocalDateTime(new Date()) },
  { name: 'localdatenow', description: 'Local date (YYYY-MM-DD)', get: () => formatLocalDate(new Date()) },
  { name: 'localtimenow', description: 'Local time (HH:mm:ss)', get: () => formatLocalTime(new Date()) },
  { name: 'utcdatetimenow', description: 'UTC date-time (YYYY-MM-DDTHH:mm:ssZ)', get: () => formatUtcDateTime(new Date()) },
  { name: 'utcdatenow', description: 'UTC date (YYYY-MM-DD)', get: () => formatUtcDate(new Date()) },
  { name: 'utctimenow', description: 'UTC time (HH:mm:ss)', get: () => formatUtcTime(new Date()) },
]

function isUrlLikeEnvironmentKey(name: string): boolean {
  if (!name.trim()) return true
  if (name === 'scheme') return true
  return /url/i.test(name)
}

const BUILTIN_INDEX: Record<string, BuiltinVar> = Object.fromEntries(
  BUILTIN_VARIABLES
    .filter(v => typeof v.get === 'function')
    .map(v => [v.name, v]),
)

function resolveDynamicBuiltinValue(name: string): string | undefined {
  const randomStringMatch = /^random\.string\(\s*(\d+)\s*\)$/.exec(name)
  if (randomStringMatch) return randomString(Number(randomStringMatch[1]))
  return undefined
}

export function resolveVariableValue(name: string, vars: Record<string, string>): string | undefined {
  if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name]
  const dynamicValue = resolveDynamicBuiltinValue(name)
  if (dynamicValue !== undefined) return dynamicValue
  return BUILTIN_INDEX[name]?.get?.()
}

export function getVariableSuggestions(vars: Record<string, string>): VariableSuggestion[] {
  const suggestions: VariableSuggestion[] = []

  const envNames = Object.keys(vars)
    .filter(name => !isUrlLikeEnvironmentKey(name))
    .sort((a, b) => a.localeCompare(b))

  for (const name of envNames) {
    suggestions.push({ name, description: vars[name] ?? '', kind: 'environment' })
  }
  for (const v of BUILTIN_VARIABLES) {
    if (Object.prototype.hasOwnProperty.call(vars, v.name)) continue
    suggestions.push({ name: v.name, description: v.description, kind: 'builtin' })
  }

  return suggestions.sort((a, b) => a.name.localeCompare(b.name))
}

function normalizeDataRowRecord(value: unknown): DataDrivenRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: DataDrivenRow = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = String(k || '').trim()
    if (!key) continue
    if (v === undefined || v === null) {
      out[key] = ''
      continue
    }
    if (typeof v === 'string') {
      out[key] = v
      continue
    }
    if (typeof v === 'number' || typeof v === 'boolean') {
      out[key] = String(v)
      continue
    }
    try {
      out[key] = JSON.stringify(v)
    } catch {
      out[key] = String(v)
    }
  }
  return out
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === ',' && !inQuotes) {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur)
  return cells
}

function parseCsvRows(input: string): DataDrivenRow[] {
  const lines = input
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  if (!lines.length) return []
  const headerCells = splitCsvLine(lines[0]).map(c => c.trim())
  if (!headerCells.length) return []

  const rows: DataDrivenRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    const row: DataDrivenRow = {}
    for (let col = 0; col < headerCells.length; col++) {
      const key = headerCells[col]
      if (!key) continue
      row[key] = cells[col] ?? ''
    }
    if (Object.keys(row).length) rows.push(row)
  }
  return rows
}

export function parseDataDrivenDataset(input: string): DataDrivenDatasetParseResult {
  const text = (input || '').trim()
  if (!text) return { format: 'json', rows: [] }

  const looksLikeJson = text.startsWith('{') || text.startsWith('[')
  if (looksLikeJson) {
    const parsed = JSON.parse(text) as unknown
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).rows)
        ? ((parsed as Record<string, unknown>).rows as unknown[])
        : [parsed]
    return {
      format: 'json',
      rows: list.map(item => normalizeDataRowRecord(item)).filter(row => Object.keys(row).length > 0),
    }
  }

  return {
    format: 'csv',
    rows: parseCsvRows(text),
  }
}
