import jsonata from 'jsonata'
import { logWarn } from '../../../shared/utils/logger'

export type JsonValue = null | boolean | number | string | object | unknown[]
export type JsonSearchHighlightPlan = {
  keyTerms: string[]
  keyPaths: string[]
  valuesByKey: Record<string, string[]>
  valuesByPath: Record<string, string[]>
  standaloneTerms: string[]
}
export type JsonSearchResult = {
  matches: unknown[]
  displayMatches: unknown[]
  output: unknown
  highlightPlan: JsonSearchHighlightPlan
  error: string | null
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

function createEmptyHighlightPlan(): JsonSearchHighlightPlan {
  return { keyTerms: [], keyPaths: [], valuesByKey: {}, valuesByPath: {}, standaloneTerms: [] }
}

function pushUnique(list: string[], text: string) {
  const normalized = text.trim()
  if (!normalized || list.includes(normalized)) return
  list.push(normalized)
}

function buildJsonataHighlightPlan(query: string) {
  type AstNode = Record<string, unknown>
  const plan = createEmptyHighlightPlan()

  function pushValueForPath(path: string | null, value: string) {
    const normalizedPath = (path || '').trim()
    if (!normalizedPath) {
      pushUnique(plan.standaloneTerms, value)
      return
    }

    pushUnique(plan.keyPaths, normalizedPath)
    const key = normalizedPath.split('.').pop()?.trim()
    if (key) pushUnique(plan.keyTerms, key)

    const byPath = plan.valuesByPath[normalizedPath] ?? (plan.valuesByPath[normalizedPath] = [])
    pushUnique(byPath, value)

    if (key) {
      const byKey = plan.valuesByKey[key] ?? (plan.valuesByKey[key] = [])
      pushUnique(byKey, value)
    }
  }

  function scalarLiteral(node: unknown): string | null {
    if (!node || typeof node !== 'object') return null
    const rec = node as AstNode
    const type = rec.type
    if (type !== 'string' && type !== 'number' && type !== 'value') return null
    const value = rec.value
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (value === null) return 'null'
    return null
  }

  function pathFromNode(node: unknown): string | null {
    if (!node || typeof node !== 'object') return null
    const rec = node as AstNode
    if (rec.type === 'path') {
      const steps = Array.isArray(rec.steps) ? rec.steps : []
      const names = steps
        .map(step => {
          if (!step || typeof step !== 'object') return ''
          const stepRec = step as AstNode
          return typeof stepRec.value === 'string' ? stepRec.value : ''
        })
        .filter(Boolean)
      return names.length ? names.join('.') : null
    }
    if (rec.type === 'name' && typeof rec.value === 'string') return rec.value
    return null
  }

  function joinPath(basePath: string | null, path: string | null) {
    const nextPath = (path || '').trim()
    if (!basePath) return nextPath || null
    if (!nextPath) return basePath
    if (nextPath.startsWith('$')) return nextPath.replace(/^\$\.?/, '')
    return `${basePath}.${nextPath}`
  }

  function visit(node: unknown, scopePath: string | null) {
    if (!node || typeof node !== 'object') return
    const rec = node as AstNode

    if (rec.type === 'binary') {
      const lhsPath = pathFromNode(rec.lhs)
      const rhsPath = pathFromNode(rec.rhs)
      const lhsValue = scalarLiteral(rec.lhs)
      const rhsValue = scalarLiteral(rec.rhs)

      if (lhsPath && rhsValue !== null) pushValueForPath(joinPath(scopePath, lhsPath), rhsValue)
      if (rhsPath && lhsValue !== null) pushValueForPath(joinPath(scopePath, rhsPath), lhsValue)
    }

    if (rec.type === 'function' && rec.procedure && typeof rec.procedure === 'object') {
      const procedure = rec.procedure as AstNode
      const functionName = typeof procedure.value === 'string' ? procedure.value : ''
      const args = Array.isArray(rec.arguments) ? rec.arguments : []

      if (functionName === 'contains' || functionName === '$contains') {
        const pathArg = args[0]
        const valueArg = args[1]
        const directPath = pathFromNode(pathArg)
        const directValue = scalarLiteral(valueArg)
        if (directPath && directValue !== null) {
          pushValueForPath(joinPath(scopePath, directPath), directValue)
        } else if (pathArg && typeof pathArg === 'object') {
          const pathArgRec = pathArg as AstNode
          if (pathArgRec.type === 'function') {
            const nestedArgs = Array.isArray(pathArgRec.arguments) ? pathArgRec.arguments : []
            const nestedPath = pathFromNode(nestedArgs[0])
            const nestedValue = scalarLiteral(valueArg)
            if (nestedPath && nestedValue !== null) {
              pushValueForPath(joinPath(scopePath, nestedPath), nestedValue)
            }
          }
        }
      }
    }

    if (rec.type === 'filter' && rec.expr) {
      visit(rec.expr, scopePath)
    }

    if (Array.isArray(rec.steps)) {
      for (const step of rec.steps) {
        if (!step || typeof step !== 'object') continue
        const stepRec = step as AstNode
        const stepPath = typeof stepRec.value === 'string' ? joinPath(scopePath, stepRec.value) : scopePath
        const stages = Array.isArray(stepRec.stages) ? stepRec.stages : []
        for (const stage of stages) {
          visit(stage, stepPath)
        }
      }
    }

    for (const value of Object.values(rec)) {
      if (Array.isArray(value)) {
        for (const item of value) visit(item, scopePath)
        continue
      }
      if (value && typeof value === 'object') visit(value, scopePath)
    }
  }

  try {
    const ast = jsonata(query).ast()
    visit(ast, null)
  } catch {
    const quoted = query.match(/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g) ?? []
    for (const token of quoted) {
      const text = token.slice(1, -1).trim()
      if (text) pushUnique(plan.standaloneTerms, text)
    }
  }

  return plan
}

function toMatchList(value: unknown): unknown[] {
  if (typeof value === 'undefined') return []
  return Array.isArray(value) ? value : [value]
}

function inferDisplayMatches(value: unknown): unknown[] {
  if (typeof value === 'undefined') return []
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return [value]

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length !== 1) return [value]

  const [, nested] = entries[0]
  if (Array.isArray(nested)) return nested
  if (typeof nested === 'undefined') return []
  return [nested]
}

export async function evaluateJsonSearch(json: JsonValue, query: string): Promise<JsonSearchResult> {
  const q = query.trim()
  if (!q) {
    return {
      matches: [],
      displayMatches: [],
      output: [],
      highlightPlan: createEmptyHighlightPlan(),
      error: null,
    }
  }

  try {
    const expression = jsonata(q)
    const output = await expression.evaluate(json)
    const matches = toMatchList(output)
    const displayMatches = inferDisplayMatches(output)
    return {
      matches,
      displayMatches,
      output,
      highlightPlan: buildJsonataHighlightPlan(q),
      error: null,
    }
  } catch (e: unknown) {
    logWarn('evaluateJsonSearch', 'Failed to evaluate JSONata search query', { error: e, query: q })
    return {
      matches: [],
      displayMatches: [],
      output: [],
      highlightPlan: createEmptyHighlightPlan(),
      error: errorMessage(e) || 'Invalid JSONata query.',
    }
  }
}
