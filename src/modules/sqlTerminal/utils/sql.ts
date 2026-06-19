import { resolveVariableValue } from '../../../shared/utils/variables'
import { SQL_TERMINAL_PAGE_SIZE } from '../constants'

export function applyVariables(text: string, vars: Record<string, string>) {
  return text.replaceAll(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m: string, name: string) => resolveVariableValue(name, vars) ?? '')
}

export function quoteIdentPostgres(name: string) {
  return `"${name.replaceAll('"', '""')}"`
}

export function quoteSqlStringLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

export function looksLikeSelectOrWith(sql: string) {
  const s = sql.trimStart()
  return /^select\b/i.test(s) || /^with\b/i.test(s)
}

export function trimTrailingSemicolons(sql: string) {
  return sql.replaceAll(/;+\s*$/g, '').trimEnd()
}

export function wrapSqlForPage(baseSql: string, offset: number, limit = SQL_TERMINAL_PAGE_SIZE + 1) {
  return `select * from (\n${trimTrailingSemicolons(baseSql)}\n) __ruf_terminal_result offset ${Math.max(0, offset)} limit ${Math.max(1, limit)}`
}

export function makeTableAlias(tableName: string): string {
  const raw = (tableName || '').replaceAll('"', '').trim()
  if (!raw) return 't'

  const parts = raw
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/g)
    .filter(Boolean)

  const letters = parts.map(part => part[0] ?? '').filter(Boolean)
  const alias = letters.join('').slice(0, 6).toLowerCase()
  return alias || raw.slice(0, 1).toLowerCase() || 't'
}

export function stripQuotes(ident: string) {
  return (ident || '').replaceAll('"', '').trim()
}

export function parseFromAndJoinAliases(sql: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /\b(from|join)\s+([a-zA-Z0-9_".]+)\s*(?:as\s+)?([a-zA-Z0-9_"]+)?/gi
  let match: RegExpExecArray | null

  while ((match = re.exec(sql)) !== null) {
    const tableRef = (match[2] ?? '').trim()
    if (!tableRef || tableRef.startsWith('(')) continue
    const aliasRaw = (match[3] ?? '').trim()
    const tableName = stripQuotes(tableRef.split('.').pop() ?? tableRef)
    if (!tableName) continue
    const alias = stripQuotes(aliasRaw)
    if (alias && !/^(on|where|group|order|limit|inner|left|right|full|cross|join)$/i.test(alias)) out[alias] = tableName
    out[tableName] = tableName
  }

  return out
}

export function applySchemaToTableRefs(sql: string, schema: string) {
  if (!schema.trim()) return sql
  const schemaIdent = quoteIdentPostgres(schema.trim())
  const re = /\b(from|join|into)\s+((?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_$]*)(?:\.(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_$]*))?)(\s+(?:as\s+)?(?!(?:on|using|where|group|order|limit|inner|left|right|full|cross|join|set|values|returning|union|having|offset)\b)(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_$]*))?/gi
  return sql.replace(re, (match, kw: string, tableRef: string, aliasRaw: string | undefined) => {
    const table = (tableRef || '').trim()
    if (!table || table.startsWith('(') || table.includes('.')) return match
    const alias = aliasRaw ?? ''
    return `${kw} ${schemaIdent}.${table}${alias}`
  })
}

export function buildSchemaAwareSql(sql: string, schema: string) {
  if (!schema.trim()) return sql
  if (looksLikeSelectOrWith(sql)) {
    return sql.trimStart().toLowerCase().startsWith('with')
      ? sql.replace(
          /^\s*with\b/i,
          match => `${match} __ruf_search_path as (select set_config('search_path', ${quoteSqlStringLiteral(schema)}, true)),`,
        )
      : `with __ruf_search_path as (select set_config('search_path', ${quoteSqlStringLiteral(schema)}, true))\n${sql}`
  }

  return `set search_path to ${quoteIdentPostgres(schema)};\n${sql}`
}

export function clampHistory<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr
  return arr.slice(arr.length - max)
}

export function formatTime(d: Date) {
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

export function extractSchemaTableLabel(sql: string, selectedSchema: string): string | null {
  const re = /\b(from|into|update|join)\s+([a-zA-Z0-9_".]+)/gi
  let match: RegExpExecArray | null

  while ((match = re.exec(sql)) !== null) {
    const rawRef = (match[2] ?? '').trim()
    if (!rawRef || rawRef.startsWith('(')) continue
    const normalized = rawRef
      .split('.')
      .map(stripQuotes)
      .filter(Boolean)
      .join('.')

    if (!normalized) continue
    if (normalized.includes('.')) return normalized
    return selectedSchema ? `${selectedSchema}.${normalized}` : normalized
  }

  return null
}

export function getCurrentSqlStatement(sql: string, caret: number): string | null {
  if (!sql) return null

  const len = sql.length
  const safeCaret = Math.max(0, Math.min(caret, len))
  const segments: Array<{ start: number; end: number }> = []

  let stmtStart = 0
  let i = 0
  let inSingle = false
  let inDouble = false
  let inLineComment = false
  let inBlockComment = false

  while (i < len) {
    const ch = sql[i]
    const next = i + 1 < len ? sql[i + 1] : ''

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      i += 1
      continue
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i += 2
        continue
      }
      i += 1
      continue
    }

    if (inSingle) {
      if (ch === "'" && next === "'") {
        i += 2
        continue
      }
      if (ch === "'") inSingle = false
      i += 1
      continue
    }

    if (inDouble) {
      if (ch === '"' && next === '"') {
        i += 2
        continue
      }
      if (ch === '"') inDouble = false
      i += 1
      continue
    }

    if (ch === '-' && next === '-') {
      inLineComment = true
      i += 2
      continue
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true
      i += 2
      continue
    }
    if (ch === "'") {
      inSingle = true
      i += 1
      continue
    }
    if (ch === '"') {
      inDouble = true
      i += 1
      continue
    }

    if (ch === ';') {
      segments.push({ start: stmtStart, end: i })
      stmtStart = i + 1
    }
    i += 1
  }

  segments.push({ start: stmtStart, end: len })

  let fallback: { start: number; end: number } | null = null

  for (const seg of segments) {
    const raw = sql.slice(seg.start, seg.end)
    const leading = raw.match(/^\s*/)?.[0].length ?? 0
    const trailing = raw.match(/\s*$/)?.[0].length ?? 0
    const start = seg.start + leading
    const end = seg.end - trailing
    if (end <= start) continue

    if (safeCaret >= start && safeCaret <= end) {
      return sql.slice(start, end).trim()
    }

    if (safeCaret > end) fallback = { start, end }
  }

  if (fallback) return sql.slice(fallback.start, fallback.end).trim()
  return null
}

export function stringifyResultValue(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
