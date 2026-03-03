import { JSONPath } from 'jsonpath-plus'
import { logWarn } from '../../../shared/utils/logger'

export type JsonValue = null | boolean | number | string | object | unknown[]
export type JsonSearchHighlightPlan = {
  keyTerms: string[]
  valuesByKey: Record<string, string[]>
  standaloneTerms: string[]
}
export type JsonSearchResult = {
  matches: unknown[]
  displayMatches: unknown[]
  highlightPlan: JsonSearchHighlightPlan
  error: string | null
}

type FilterOp = '=' | '==' | '!=' | '>=' | '<=' | '>' | '<' | '~' | '!~'
type SimpleFilter = { fieldPath: string, op: FilterOp, expected: unknown }
type SimpleFilterMatch = { container: unknown, actual: unknown, fieldName: string | null }
type JsonPathMetaMatch = {
  value?: unknown
  parent?: unknown
  parentProperty?: string | number
}

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

function findMatchingValues(root: JsonValue, filter: SimpleFilter): SimpleFilterMatch[] {
  const values: SimpleFilterMatch[] = []
  const parts = filter.fieldPath.split('.').filter(Boolean)
  const fieldName = parts.length ? parts[parts.length - 1] : null

  function visit(node: unknown) {
    if (!node || typeof node !== 'object') return

    if (Array.isArray(node)) {
      for (const v of node) visit(v)
      return
    }

    const actual = getAtPath(node, filter.fieldPath)
    if (actual !== undefined && compare(filter.op, actual, filter.expected)) {
      values.push({ container: node, actual, fieldName })
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

function makePrimitiveKey(value: unknown) {
  return `${typeof value}:${String(value)}`
}

function dedupeValues(values: unknown[]) {
  const seenObjects = new WeakSet<object>()
  const seenScalars = new Set<string>()
  const out: unknown[] = []

  for (const value of values) {
    if (value && typeof value === 'object') {
      const obj = value as object
      if (seenObjects.has(obj)) continue
      seenObjects.add(obj)
      out.push(value)
      continue
    }

    const key = makePrimitiveKey(value)
    if (seenScalars.has(key)) continue
    seenScalars.add(key)
    out.push(value)
  }

  return out
}

function toHighlightText(value: unknown) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  return ''
}

function createEmptyHighlightPlan(): JsonSearchHighlightPlan {
  return { keyTerms: [], valuesByKey: {}, standaloneTerms: [] }
}

function pushUnique(list: string[], text: string) {
  const normalized = text.trim()
  if (!normalized || list.includes(normalized)) return
  list.push(normalized)
}

function pushUniqueToRecord(record: Record<string, string[]>, key: string, text: string) {
  const normalizedKey = key.trim()
  const normalizedText = text.trim()
  if (!normalizedKey || !normalizedText) return
  const bucket = record[normalizedKey] ?? (record[normalizedKey] = [])
  if (bucket.includes(normalizedText)) return
  bucket.push(normalizedText)
}

function buildSimpleFilterHighlightPlan(filter: SimpleFilter, matches: SimpleFilterMatch[]) {
  const plan = createEmptyHighlightPlan()
  if (filter.op === '!=' || filter.op === '!~') return plan

  const add = (text: string) => {
    const normalized = text.trim()
    if (!normalized) return
    if (filter.fieldPath) {
      const key = filter.fieldPath.split('.').filter(Boolean).at(-1) ?? ''
      if (key) pushUniqueToRecord(plan.valuesByKey, key, normalized)
      return
    }
    pushUnique(plan.standaloneTerms, normalized)
  }

  for (const match of matches) {
    if (match.fieldName) pushUnique(plan.keyTerms, match.fieldName)

    if (filter.op === '~') {
      if (Array.isArray(filter.expected)) {
        for (const item of filter.expected) add(toHighlightText(item))
      } else {
        add(toHighlightText(filter.expected))
      }
      continue
    }

    add(toHighlightText(match.actual))
  }

  return plan
}

function buildJsonPathDisplayValue(match: JsonPathMetaMatch) {
  const parent = match.parent
  if (parent && typeof parent === 'object' && !Array.isArray(parent)) return parent
  if (Array.isArray(parent) && match.value && typeof match.value === 'object') return match.value
  return match.value
}

function buildJsonPathHighlightPlan(matches: JsonPathMetaMatch[]) {
  const plan = createEmptyHighlightPlan()

  for (const match of matches) {
    if (typeof match.parentProperty === 'string') {
      pushUnique(plan.keyTerms, match.parentProperty)
      pushUniqueToRecord(plan.valuesByKey, match.parentProperty, toHighlightText(match.value))
      continue
    }
    pushUnique(plan.standaloneTerms, toHighlightText(match.value))
  }

  return plan
}

export function evaluateJsonSearch(json: JsonValue, query: string): JsonSearchResult {
  const q = query.trim()
  if (!q) return { matches: [], displayMatches: [], highlightPlan: createEmptyHighlightPlan(), error: null }

  try {
    if (!isJsonPathQuery(q)) {
      const filter = parseSimpleFilter(q)
      if (!filter) return { matches: [], displayMatches: [], highlightPlan: createEmptyHighlightPlan(), error: 'Enter JSONPath (starts with $) or a filter like: id = 5' }
      const detailedMatches = findMatchingValues(json, filter)
      const matches = detailedMatches.map(match => match.actual)
      const displayMatches = dedupeValues(detailedMatches.map(match => match.container))
      const highlightPlan = buildSimpleFilterHighlightPlan(filter, detailedMatches)
      return { matches, displayMatches, highlightPlan, error: null }
    }

    const res = jsonPath<JsonPathMetaMatch[] | JsonPathMetaMatch>({ path: q, json, resultType: 'all' })
    const detailedMatches = Array.isArray(res) ? res : [res]
    const matches = detailedMatches.map(match => match?.value)
    const displayMatches = dedupeValues(detailedMatches.map(buildJsonPathDisplayValue))
    const highlightPlan = buildJsonPathHighlightPlan(detailedMatches)
    return { matches, displayMatches, highlightPlan, error: null }
  } catch (e: unknown) {
    logWarn('evaluateJsonSearch', 'Failed to evaluate JSON search query', { error: e, query: q })
    return { matches: [], displayMatches: [], highlightPlan: createEmptyHighlightPlan(), error: errorMessage(e) || 'Invalid query.' }
  }
}
