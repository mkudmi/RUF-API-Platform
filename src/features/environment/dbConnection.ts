import type { Environment } from '../../shared/types/environment'

export type DbType = 'postgres' | 'mysql'

export type DbFormState = {
  type: DbType
  host: string
  port: string
  database: string
  username: string
  password: string
}

export const DB_ENV_KEYS = {
  type: 'db.type',
  connectionString: 'db.connectionString',
  host: 'db.host',
  port: 'db.port',
  database: 'db.database',
  username: 'db.username',
  password: 'db.password',
} as const

const DB_ENV_KEY_VALUES: string[] = Object.values(DB_ENV_KEYS)

export function isDbEnvKey(key: string) {
  return DB_ENV_KEY_VALUES.includes(key)
}

export function hasDbConfigInEnv(env: Environment): boolean {
  const rawType = env.variables[DB_ENV_KEYS.type]
  const type: DbType = rawType === 'mysql' ? 'mysql' : 'postgres'
  const defaultPort = type === 'mysql' ? '3306' : '5432'

  const host = (env.variables[DB_ENV_KEYS.host] ?? '').trim()
  const port = (env.variables[DB_ENV_KEYS.port] ?? '').trim()
  const database = (env.variables[DB_ENV_KEYS.database] ?? '').trim()
  const username = (env.variables[DB_ENV_KEYS.username] ?? '').trim()
  const password = (env.variables[DB_ENV_KEYS.password] ?? '').trim()
  const connectionString = (env.variables[DB_ENV_KEYS.connectionString] ?? '').trim()

  return !!(connectionString || host || database || username || password || (port && port !== defaultPort))
}

export function getDbFormStateFromEnv(env: Environment): DbFormState {
  const rawType = env.variables[DB_ENV_KEYS.type]
  const type: DbType = rawType === 'mysql' ? 'mysql' : 'postgres'
  const defaultPort = type === 'mysql' ? '3306' : '5432'
  return {
    type,
    host: env.variables[DB_ENV_KEYS.host] ?? '',
    port: env.variables[DB_ENV_KEYS.port] ?? defaultPort,
    database: env.variables[DB_ENV_KEYS.database] ?? '',
    username: env.variables[DB_ENV_KEYS.username] ?? '',
    password: env.variables[DB_ENV_KEYS.password] ?? '',
  }
}

export function buildDbConnectionString(state: DbFormState): string {
  const type = state.type || 'postgres'

  const host = state.host.trim()
  const port = state.port.trim() || (type === 'mysql' ? '3306' : '5432')
  const database = state.database.trim()

  if (!host) return ''

  try {
    const u = new URL(type === 'mysql' ? 'mysql://localhost' : 'postgres://localhost')
    u.hostname = host
    u.port = port
    u.username = state.username
    u.password = state.password
    u.pathname = database ? `/${database}` : '/'
    return u.toString()
  } catch {
    return ''
  }
}

export function getDbConnectionStringPreview(connectionString: string, showPassword: boolean): string {
  if (showPassword) return connectionString
  if (!connectionString) return ''
  try {
    const u = new URL(connectionString)
    if (!u.password) return connectionString
    u.password = '***'
    return u.toString()
  } catch {
    return connectionString
  }
}

export function mergeDbIntoVariables(variables: Record<string, string>, state: DbFormState) {
  const host = state.host.trim()
  const defaultPort = state.type === 'mysql' ? '3306' : '5432'
  const port = state.port.trim() || defaultPort
  const database = state.database.trim()
  const username = state.username
  const password = state.password

  const hasAnyDbField = !!(host || database || username || password || (port && port !== defaultPort))
  if (!hasAnyDbField) return variables

  const next: Record<string, string> = { ...variables }
  next[DB_ENV_KEYS.type] = state.type || 'postgres'
  next[DB_ENV_KEYS.host] = host
  next[DB_ENV_KEYS.port] = port
  next[DB_ENV_KEYS.database] = database
  next[DB_ENV_KEYS.username] = username
  next[DB_ENV_KEYS.password] = password
  next[DB_ENV_KEYS.connectionString] = buildDbConnectionString(state)
  return next
}

export async function runDbConnectionTest(opts: { type: string; connectionString: string }) {
  const started = performance.now()
  const resp = await fetch('/__ruf/db/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: opts.type, connectionString: opts.connectionString }),
  })
  const durationMs = Math.max(0, Math.round(performance.now() - started))

  const raw = await resp.text()
  let data: unknown = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    data = null
  }

  if (!resp.ok) {
    const errorFromJson =
      data && typeof data === 'object' && 'error' in data && typeof (data as Record<string, unknown>).error === 'string'
        ? String((data as Record<string, unknown>).error)
        : null
    return { ok: false, message: errorFromJson || raw || `HTTP ${resp.status}`, durationMs }
  }

  const okFromJson = data && typeof data === 'object' && 'ok' in data ? Boolean((data as Record<string, unknown>).ok) : false
  const messageFromJson =
    data &&
    typeof data === 'object' &&
    'message' in data &&
    typeof (data as Record<string, unknown>).message === 'string'
      ? String((data as Record<string, unknown>).message)
      : null

  return { ok: okFromJson, message: messageFromJson || (okFromJson ? 'OK' : 'Failed'), durationMs }
}
