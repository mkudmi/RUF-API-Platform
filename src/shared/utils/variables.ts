export type VariableSuggestion = {
  name: string
  description?: string
  kind: 'environment' | 'builtin'
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
  get: () => string
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

const BUILTIN_VARIABLES: BuiltinVar[] = [
  { name: 'uuid', description: 'Random UUID (v4)', get: () => randomUuid() },
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

const BUILTIN_INDEX: Record<string, BuiltinVar> = Object.fromEntries(BUILTIN_VARIABLES.map(v => [v.name, v]))

export function resolveVariableValue(name: string, vars: Record<string, string>): string | undefined {
  if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name]
  return BUILTIN_INDEX[name]?.get()
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
