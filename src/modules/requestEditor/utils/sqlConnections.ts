import type { Collection } from '../../collectionTree'
import type { Environment, GlobalSqlConnectionItem } from '../../../shared/types/environment'
import { DB_ENV_KEYS, buildDbConnectionString, getDbConnectionStringPreview, getDbFormStateFromEnv } from '../../environment'

export type RequestEditorSqlConnection = {
  id: string
  label: string
  type: 'postgres' | 'mysql'
  connectionString: string
  connectionPreview: string
}

export function buildRequestEditorSqlConnections(args: {
  collection: Collection
  environment?: Environment
  globalSqlConnections?: GlobalSqlConnectionItem[]
}) {
  const out: RequestEditorSqlConnection[] = []

  if (args.environment) {
    const rawType = args.environment.variables?.[DB_ENV_KEYS.type]
    const type = rawType === 'mysql' ? 'mysql' : 'postgres'
    const fromEnv = (args.environment.variables?.[DB_ENV_KEYS.connectionString] ?? '').trim()
    const connectionString = fromEnv || buildDbConnectionString(getDbFormStateFromEnv(args.environment))

    if (connectionString) {
      out.push({
        id: `collection:${args.collection.id}`,
        label: `Collection - ${args.collection.name || args.collection.id}`,
        type,
        connectionString,
        connectionPreview: getDbConnectionStringPreview(connectionString),
      })
    }
  }

  for (const connection of args.globalSqlConnections ?? []) {
    if (!connection) continue

    const connectionString = buildDbConnectionString(connection)
    if (!connectionString) continue

    out.push({
      id: `app:${connection.id}`,
      label: `App - ${connection.name || 'Connection'}`,
      type: connection.type,
      connectionString,
      connectionPreview: getDbConnectionStringPreview(connectionString),
    })
  }

  return out.sort((left, right) => left.label.localeCompare(right.label))
}
