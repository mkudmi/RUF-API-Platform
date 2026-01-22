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

const BUILTIN_VARIABLES: BuiltinVar[] = [
  { name: 'localdatetimenow', description: 'Local date-time (YYYY-MM-DDTHH:mm:ss)', get: () => formatLocalDateTime(new Date()) },
  { name: 'localdatenow', description: 'Local date (YYYY-MM-DD)', get: () => formatLocalDate(new Date()) },
  { name: 'localtimenow', description: 'Local time (HH:mm:ss)', get: () => formatLocalTime(new Date()) },
  { name: 'utcdatetimenow', description: 'UTC date-time (YYYY-MM-DDTHH:mm:ssZ)', get: () => formatUtcDateTime(new Date()) },
  { name: 'utcdatenow', description: 'UTC date (YYYY-MM-DD)', get: () => formatUtcDate(new Date()) },
  { name: 'utctimenow', description: 'UTC time (HH:mm:ss)', get: () => formatUtcTime(new Date()) },
]

// Add environment variables you want to appear in the `{{...}}` dropdown here.
// The dropdown will only show names that are explicitly listed.
export const SUGGESTED_ENVIRONMENT_VARIABLES: Array<{ name: string, description?: string }> = []

const BUILTIN_INDEX: Record<string, BuiltinVar> = Object.fromEntries(BUILTIN_VARIABLES.map(v => [v.name, v]))

export function resolveVariableValue(name: string, vars: Record<string, string>): string | undefined {
  if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name]
  return BUILTIN_INDEX[name]?.get()
}

export function getVariableSuggestions(vars: Record<string, string>): VariableSuggestion[] {
  const suggestions: VariableSuggestion[] = []

  for (const env of SUGGESTED_ENVIRONMENT_VARIABLES) {
    if (!Object.prototype.hasOwnProperty.call(vars, env.name)) continue
    suggestions.push({ name: env.name, description: env.description, kind: 'environment' })
  }
  for (const v of BUILTIN_VARIABLES) {
    if (Object.prototype.hasOwnProperty.call(vars, v.name)) continue
    suggestions.push({ name: v.name, description: v.description, kind: 'builtin' })
  }

  return suggestions.sort((a, b) => a.name.localeCompare(b.name))
}
