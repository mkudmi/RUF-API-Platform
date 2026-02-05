import type { Environment, GlobalSqlConnectionItem, GlobalSqlConnectionSettings } from '../../../shared/types/environment'
import { DEFAULT_GLOBAL_SQL_CONNECTION_SETTINGS } from '../../../shared/types/environment'
import { mergeDbIntoVariables, DB_ENV_KEYS, type DbType } from './dbConnection'

function stripDbVariables(variables: Record<string, string>): Record<string, string> {
  const next = { ...variables }
  for (const key of Object.values(DB_ENV_KEYS)) delete next[key]
  return next
}

export function applyGlobalSqlToEnvironment(env: Environment, sql: GlobalSqlConnectionSettings): Environment {
  const cleaned = stripDbVariables(env.variables ?? {})
  const merged = mergeDbIntoVariables(cleaned, {
    type: sql.type,
    sslmode: sql.sslmode,
    host: sql.host,
    port: sql.port,
    database: sql.database,
    username: sql.username,
    password: sql.password,
  })
  return { ...env, variables: merged }
}

export function createInitialGlobalSqlConnections(
  savedConnections: GlobalSqlConnectionItem[],
  legacyGlobalSql: GlobalSqlConnectionSettings,
  createId: (prefix?: string) => string,
): GlobalSqlConnectionItem[] {
  if (savedConnections.length) return savedConnections

  const sql = legacyGlobalSql
  const defaultPort = sql.type === 'mysql' ? '3306' : '5432'
  const hasAny =
    !!(sql.host.trim() || sql.database.trim() || sql.username || sql.password || (sql.port.trim() && sql.port.trim() !== defaultPort) || (sql.type === 'postgres' && sql.sslmode !== 'prefer'))

  if (!hasAny) return []
  return [{ id: createId('gsql'), name: 'Connection 1', ...sql }]
}

export function getPrimaryGlobalSqlSettings(connections: GlobalSqlConnectionItem[]): GlobalSqlConnectionSettings | null {
  const first = connections[0]
  if (!first) return null
  return {
    type: first.type,
    sslmode: first.sslmode,
    host: first.host,
    port: first.port,
    database: first.database,
    username: first.username,
    password: first.password,
  }
}

export function addGlobalSqlConnectionItem(
  prev: GlobalSqlConnectionItem[],
  createId: (prefix?: string) => string,
): GlobalSqlConnectionItem[] {
  let n = prev.length + 1
  let candidate = `Connection ${n}`
  const existing = new Set(prev.map(x => x.name.trim().toLowerCase()))
  while (existing.has(candidate.toLowerCase())) {
    n += 1
    candidate = `Connection ${n}`
  }
  return [...prev, { id: createId('gsql'), name: candidate, ...DEFAULT_GLOBAL_SQL_CONNECTION_SETTINGS }]
}

export function updateGlobalSqlConnectionItem(
  prev: GlobalSqlConnectionItem[],
  connectionId: string,
  updater: (conn: GlobalSqlConnectionItem) => GlobalSqlConnectionItem,
): GlobalSqlConnectionItem[] {
  return prev.map(conn => (conn.id === connectionId ? updater(conn) : conn))
}

export function removeGlobalSqlConnectionItem(prev: GlobalSqlConnectionItem[], connectionId: string): GlobalSqlConnectionItem[] {
  return prev.filter(conn => conn.id !== connectionId)
}

export function setConnectionTypeAndMaybeDefaultPort(conn: GlobalSqlConnectionItem, nextType: DbType): GlobalSqlConnectionItem {
  const raw = conn.port.trim()
  let nextPort = conn.port
  if (!raw) nextPort = nextType === 'mysql' ? '3306' : '5432'
  else if (nextType === 'mysql' && raw === '5432') nextPort = '3306'
  else if (nextType === 'postgres' && raw === '3306') nextPort = '5432'

  return {
    ...conn,
    type: nextType,
    port: nextPort,
    sslmode: nextType === 'postgres' ? conn.sslmode : 'prefer',
  }
}
