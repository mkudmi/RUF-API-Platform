import { runDbSql } from '../../environment'
import type { DbConnOption } from '../types'
import { quoteSqlStringLiteral } from '../utils/sql'

function mapNames(rows: Array<Record<string, unknown>> | null | undefined, key: string) {
  return (rows ?? [])
    .map(row => String(row[key] ?? '').trim())
    .filter(Boolean)
}

export async function loadSqlTerminalSchemas(conn: DbConnOption) {
  if (conn.type !== 'postgres') return []

  const result = await runDbSql({
    type: conn.type,
    connectionString: conn.connectionString,
    sql: "select schema_name as name from information_schema.schemata where schema_name <> 'information_schema' and schema_name not like 'pg\\_%' escape '\\' order by case when schema_name='public' then 0 else 1 end, schema_name",
    timeoutMs: 15_000,
  })

  if (!result.ok) return []
  return mapNames(result.rows as Array<Record<string, unknown>> | null | undefined, 'name')
}

export async function loadSqlTerminalTables(conn: DbConnOption, schema: string) {
  if (conn.type !== 'postgres' || !schema) return []

  const result = await runDbSql({
    type: conn.type,
    connectionString: conn.connectionString,
    sql: `select table_name as name from information_schema.tables where table_schema = ${quoteSqlStringLiteral(schema)} and table_type in ('BASE TABLE','VIEW') order by table_name`,
    timeoutMs: 15_000,
  })

  if (!result.ok) return []
  return mapNames(result.rows as Array<Record<string, unknown>> | null | undefined, 'name')
}

export async function loadSqlTerminalColumns(conn: DbConnOption, schema: string, tableName: string) {
  if (conn.type !== 'postgres' || !schema || !tableName) return []

  const result = await runDbSql({
    type: conn.type,
    connectionString: conn.connectionString,
    sql: `select column_name as name from information_schema.columns where table_schema = ${quoteSqlStringLiteral(schema)} and table_name = ${quoteSqlStringLiteral(tableName)} order by ordinal_position`,
    timeoutMs: 15_000,
  })

  if (!result.ok) return []
  return mapNames(result.rows as Array<Record<string, unknown>> | null | undefined, 'name')
}

export async function preloadSqlTerminalColumns(conn: DbConnOption, schema: string, tableNames: string[]) {
  if (conn.type !== 'postgres' || !schema || !tableNames.length) return {}

  const result = await runDbSql({
    type: conn.type,
    connectionString: conn.connectionString,
    sql: `select table_name as table_name, column_name as column_name from information_schema.columns where table_schema = ${quoteSqlStringLiteral(schema)} order by table_name, ordinal_position`,
    timeoutMs: 20_000,
  })

  if (!result.ok || !Array.isArray(result.rows)) return {}

  const nextMap: Record<string, string[]> = {}

  for (const row of result.rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const rec = row as Record<string, unknown>
    const currentTableName = String(rec.table_name ?? '').trim()
    const columnName = String(rec.column_name ?? '').trim()
    if (!currentTableName || !columnName) continue
    const key = `${schema}.${currentTableName}`
    const list = nextMap[key] ?? []
    list.push(columnName)
    nextMap[key] = list
  }

  for (const tableName of tableNames) {
    const key = `${schema}.${tableName}`
    if (!nextMap[key]) nextMap[key] = []
  }

  return nextMap
}
