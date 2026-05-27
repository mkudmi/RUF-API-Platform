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
  const plan = createEmptyHighlightPlan()
  const quoted = query.match(/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g) ?? []
  for (const token of quoted) {
    const text = token.slice(1, -1).trim()
    if (text) pushUnique(plan.standaloneTerms, text)
  }

  const scalarLiterals = query.match(/\btrue\b|\bfalse\b|\bnull\b|-?(?:0|[1-9]\d*)(?:\.\d+)?/g) ?? []
  for (const token of scalarLiterals) pushUnique(plan.standaloneTerms, token)

  return plan
}

function toMatchList(value: unknown): unknown[] {
  if (typeof value === 'undefined') return []
  return Array.isArray(value) ? value : [value]
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
    return {
      matches,
      displayMatches: matches,
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
