export type Environment = {
  baseUrlKey: string
  variables: Record<string, string>
  headers: Record<string, string>
}

export type GlobalSqlConnectionSettings = {
  type: 'postgres' | 'mysql'
  sslmode: 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'
  host: string
  port: string
  database: string
  username: string
  password: string
}

export type GlobalSqlConnectionItem = GlobalSqlConnectionSettings & {
  id: string
  name: string
}

export const DEFAULT_ENVIRONMENT: Environment = {
  baseUrlKey: 'baseUrl',
  variables: { baseUrl: '', scheme: 'http' },
  headers: {},
}

export const DEFAULT_GLOBAL_SQL_CONNECTION_SETTINGS: GlobalSqlConnectionSettings = {
  type: 'postgres',
  sslmode: 'prefer',
  host: '',
  port: '5432',
  database: '',
  username: '',
  password: '',
}
