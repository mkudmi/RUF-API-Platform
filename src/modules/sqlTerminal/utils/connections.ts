import type { McpServerSettings } from '../../../shared/utils/appSettings'
import type { Environment, GlobalSqlConnectionItem } from '../../../shared/types/environment'
import { DB_ENV_KEYS, buildDbConnectionString, getDbConnectionStringPreview, getDbFormStateFromEnv, hasDbConfigInEnv } from '../../environment'
import { getPostgresMcpDatabaseUri, getPostgresMcpServer } from '../../mcp/services/mcp'
import type { Collection } from '../../collectionTree'
import type { DbConnOption, SqlTerminalSelectedConnection } from '../types'

export function buildDbConnOptions(
  collections: Collection[],
  envByCollection: Record<string, Environment>,
  extraConnections: GlobalSqlConnectionItem[] | undefined,
): DbConnOption[] {
  const byId = new Map(collections.map(collection => [collection.id, collection]))
  const out: DbConnOption[] = []

  for (const [collectionId, env] of Object.entries(envByCollection)) {
    if (!env || !hasDbConfigInEnv(env)) continue

    const collection = byId.get(collectionId)
    if (!collection) continue

    const rawType = env.variables?.[DB_ENV_KEYS.type]
    const type = rawType === 'mysql' ? 'mysql' : 'postgres'
    const fromEnv = (env.variables?.[DB_ENV_KEYS.connectionString] ?? '').trim()
    const connectionString = fromEnv || buildDbConnectionString(getDbFormStateFromEnv(env))
    if (!connectionString) continue

    out.push({
      id: `collection:${collectionId}`,
      label: `Collection - ${collection.name || collectionId}`,
      type,
      connectionString,
      connectionPreview: getDbConnectionStringPreview(connectionString),
      variables: env.variables ?? {},
    })
  }

  for (const conn of extraConnections ?? []) {
    if (!conn) continue
    const connectionString = buildDbConnectionString(conn)
    if (!connectionString) continue
    out.push({
      id: `app:${conn.id}`,
      label: `App - ${conn.name || 'Connection'}`,
      type: conn.type,
      connectionString,
      connectionPreview: getDbConnectionStringPreview(connectionString),
      variables: {},
    })
  }

  return out.sort((left, right) => left.label.localeCompare(right.label))
}

export function resolveFallbackPostgresConnectionString(
  mcpSettings: McpServerSettings[],
  selectedConnection?: SqlTerminalSelectedConnection | null,
) {
  if (selectedConnection?.type === 'postgres') {
    const connectionString = selectedConnection.connectionString.trim()
    if (connectionString) return connectionString
  }

  return getPostgresMcpDatabaseUri(getPostgresMcpServer(mcpSettings))
}
