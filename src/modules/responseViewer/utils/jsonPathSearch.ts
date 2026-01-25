import { JSONPath } from 'jsonpath-plus'

export type JsonValue = null | boolean | number | string | object | unknown[]

type FilterOp = '=' | '==' | '!=' | '>=' | '<=' | '>' | '<' | '~' | '!~'
type SimpleFilter = { fieldPath: string, op: FilterOp, expected: unknown }

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

function isJsonPathQuery(query: string) {
  return query.trim().startsWith('$')
}

function parseScalar(text: string): unknown {
  const list = splitCommaList(text)
  const looksLikeList = list.length > 1 || (list.length === 1 && text.includes(','))
  if (looksLikeList) return list.map(parseScalarSingle)
  return parseScalarSingle(text)
}

function splitCommaList(text: string) {
  const out: string[] = []
  let cur = ''
  let quote: "'" | '"' | null = null

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === ',') {
      const t = cur.trim()
      if (t) out.push(t)
      cur = ''
      continue
    }
    cur += ch
  }

  const tail = cur.trim()
  if (tail) out.push(tail)
  return out
}

function parseScalarSingle(text: string): unknown {
  const t = text.trim()
  if (!t) return ''

  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }

  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null') return null

  const n = Number(t)
  if (!t.startsWith('+') && Number.isFinite(n) && /^[+-]?\d+(\.\d+)?$/.test(t)) return n

  return t
}

function parseSimpleFilter(query: string): SimpleFilter | null {
  const m = query.trim().match(/^([a-zA-Z0-9_.-]+)\s*(==|=|!=|>=|<=|>|<|~|!~)\s*(.+)$/)
  if (!m) return null
  const [, fieldPath, opRaw, rhs] = m
  return { fieldPath, op: opRaw as FilterOp, expected: parseScalar(rhs) }
}

function getAtPath(obj: unknown, fieldPath: string): unknown {
  const parts = fieldPath.split('.').filter(Boolean)
  let cur: unknown = obj
  for (const part of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function compare(op: FilterOp, actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (op === '=' || op === '==') return expected.some(e => compare('==', actual, e))
    if (op === '!=') return expected.every(e => compare('!=', actual, e))
    if (op === '~') return expected.some(e => compare('~', actual, e))
    if (op === '!~') return expected.every(e => compare('!~', actual, e))
    return false
  }

  if (op === '=' || op === '==') {
    if (typeof actual === 'number' && typeof expected === 'number') return actual === expected
    return String(actual) === String(expected)
  }

  if (op === '!=') {
    if (typeof actual === 'number' && typeof expected === 'number') return actual !== expected
    return String(actual) !== String(expected)
  }

  if (op === '~' || op === '!~') {
    const a = String(actual ?? '').toLowerCase()
    const e = String(expected ?? '').toLowerCase()
    const ok = a.includes(e)
    return op === '~' ? ok : !ok
  }

  const aNum = typeof actual === 'number' ? actual : Number(actual)
  const eNum = typeof expected === 'number' ? expected : Number(expected)
  if (!Number.isFinite(aNum) || !Number.isFinite(eNum)) return false

  if (op === '>=') return aNum >= eNum
  if (op === '<=') return aNum <= eNum
  if (op === '>') return aNum > eNum
  if (op === '<') return aNum < eNum
  return false
}

function findMatchingValues(root: JsonValue, filter: SimpleFilter): unknown[] {
  const values: unknown[] = []

  function visit(node: unknown) {
    if (!node || typeof node !== 'object') return

    if (Array.isArray(node)) {
      for (const v of node) visit(v)
      return
    }

    const actual = getAtPath(node, filter.fieldPath)
    if (actual !== undefined && compare(filter.op, actual, filter.expected)) {
      values.push(node)
    }

    for (const v of Object.values(node as Record<string, unknown>)) visit(v)
  }

  visit(root)
  return values
}

type JsonPathFn = <T>(options: {
  path: string | unknown[]
  json: JsonValue
  resultType?: 'value' | 'all'
}) => T

const jsonPath = JSONPath as unknown as JsonPathFn

export function evaluateJsonSearch(json: JsonValue, query: string): { matches: unknown[], error: string | null } {
  const q = query.trim()
  if (!q) return { matches: [], error: null }

  try {
    if (!isJsonPathQuery(q)) {
      const filter = parseSimpleFilter(q)
      if (!filter) return { matches: [], error: 'Enter JSONPath (starts with $) or a filter like: id = 5' }
      return { matches: findMatchingValues(json, filter), error: null }
    }

    const res = jsonPath<unknown[] | unknown>({ path: q, json, resultType: 'value' })
    const matches = Array.isArray(res) ? res : [res]
    return { matches, error: null }
  } catch (e: unknown) {
    return { matches: [], error: errorMessage(e) || 'Invalid query.' }
  }
}

