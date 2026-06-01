import { buildResponseSearchIntent } from './responseSearchIntent'
import { collectScalarFieldCandidates, formatJsonataPath } from './responseSearchSchema'
import { resolveIntentToPredicate } from './responseSearchSemantics'
import type { PlannedSearchQuery, ResponseSearchSnapshot } from './responseSearchTypes'

function escapeJsonString(value: string) {
  return JSON.stringify(value)
}

function buildNestedObjectConstructor(path: string[], leafExpression: string): string {
  if (!path.length) return leafExpression
  const [head, ...rest] = path
  return `{${escapeJsonString(head)}: ${buildNestedObjectConstructor(rest, leafExpression)}}`
}

function wrapPredicate(arrayPath: string | null, predicate: string) {
  if (!arrayPath) return `$[${predicate}]`
  const parts = arrayPath.split('.').map(part => part.trim()).filter(Boolean)
  return buildNestedObjectConstructor(parts, `${formatJsonataPath(arrayPath)}[${predicate}]`)
}

export function planResponseSearchQuery(snapshot: ResponseSearchSnapshot, userQuery: string): PlannedSearchQuery | null {
  const candidates = collectScalarFieldCandidates(snapshot)
    .filter(candidate => candidate.kind === 'string' || candidate.kind === 'number' || candidate.kind === 'boolean')
  if (!candidates.length) return null

  const intent = buildResponseSearchIntent(userQuery, candidates)
  if (!intent) return null

  const resolved = resolveIntentToPredicate(intent, candidates)
  if (!resolved) return null

  return {
    intent,
    query: wrapPredicate(resolved.candidate.arrayPath, resolved.predicate),
    source: 'heuristic',
    resolver: resolved.resolver,
  }
}
