import type { Environment } from '../../../shared/types/environment'
import { tauriInvoke } from '../../../shared/utils/tauri'
import { loadAppSettings } from '../../../shared/utils/appSettings'

export type DbType = 'postgres' | 'mysql'
export type PgSslMode = 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'

export type DbFormState = {
  type: DbType
  sslmode: PgSslMode
  host: string
  port: string
  database: string
  username: string
  password: string
}

export const DB_ENV_KEYS = {
  type: 'db.type',
  connectionString: 'db.connectionString',
  sslmode: 'db.sslmode',
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

  const sslmode = (env.variables[DB_ENV_KEYS.sslmode] ?? '').trim()
  const host = (env.variables[DB_ENV_KEYS.host] ?? '').trim()
  const port = (env.variables[DB_ENV_KEYS.port] ?? '').trim()
  const database = (env.variables[DB_ENV_KEYS.database] ?? '').trim()
  const username = (env.variables[DB_ENV_KEYS.username] ?? '').trim()
  const password = (env.variables[DB_ENV_KEYS.password] ?? '').trim()
  const connectionString = (env.variables[DB_ENV_KEYS.connectionString] ?? '').trim()

  return !!(connectionString || sslmode || host || database || username || password || (port && port !== defaultPort))
}

export function getDbFormStateFromEnv(env: Environment): DbFormState {
  const rawType = env.variables[DB_ENV_KEYS.type]
  const type: DbType = rawType === 'mysql' ? 'mysql' : 'postgres'
  const defaultPort = type === 'mysql' ? '3306' : '5432'
  const sslRaw = (env.variables[DB_ENV_KEYS.sslmode] ?? '').trim().toLowerCase()
  const sslmode: PgSslMode =
    sslRaw === 'disable' || sslRaw === 'allow' || sslRaw === 'require' || sslRaw === 'verify-ca' || sslRaw === 'verify-full'
      ? (sslRaw as PgSslMode)
      : 'prefer'
  return {
    type,
    sslmode,
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
    if (type === 'postgres') {
      const sslmode = (state.sslmode || 'prefer').trim()
      if (sslmode && sslmode !== 'prefer') u.searchParams.set('sslmode', sslmode)
    }
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
  const sslmode = state.type === 'postgres' ? (state.sslmode || 'prefer') : 'prefer'
  const username = state.username
  const password = state.password

  const hasAnyDbField = !!(host || database || username || password || (port && port !== defaultPort) || (state.type === 'postgres' && sslmode !== 'prefer'))
  if (!hasAnyDbField) return variables

  const next: Record<string, string> = { ...variables }
  next[DB_ENV_KEYS.type] = state.type || 'postgres'
  if (state.type === 'postgres') next[DB_ENV_KEYS.sslmode] = sslmode
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
  const caCertsPem = loadAppSettings().caCertificates.map(c => c.pem)

  const result = await tauriInvoke<{ ok: boolean; message?: string }>('db_test', {
    args: {
      type: opts.type,
      connectionString: opts.connectionString,
      caCertsPem,
    },
  })
  const durationMs = Math.max(0, Math.round(performance.now() - started))
  return { ok: !!result.ok, message: result.message || (result.ok ? 'OK' : 'Failed'), durationMs }
}

export async function runDbSql(opts: { type: string; connectionString: string; sql: string; timeoutMs?: number }) {
  const started = performance.now()
  const caCertsPem = loadAppSettings().caCertificates.map(c => c.pem)

  const result = await tauriInvoke<{ ok: boolean; message?: string; rowsAffected?: number; rowsJson?: string; columns?: string[] }>('db_exec', {
    args: {
      type: opts.type,
      connectionString: opts.connectionString,
      sql: opts.sql,
      timeoutMs: opts.timeoutMs,
      caCertsPem,
    },
  })
  const durationMs = Math.max(0, Math.round(performance.now() - started))
  const msg = result.message || (result.ok ? `OK${typeof result.rowsAffected === 'number' ? ` (${result.rowsAffected})` : ''}` : 'Failed')
  const rowsFromJson = (() => {
    if (!result.rowsJson) return null
    try {
      const parsed = JSON.parse(result.rowsJson) as unknown
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  })()
  return { ok: !!result.ok, message: msg, durationMs, rowsAffected: result.rowsAffected, rows: rowsFromJson, columns: result.columns ?? null }
}
