import type { ScalarFieldCandidate, SearchIntent, SearchSemanticState } from './responseSearchTypes'
import { formatJsonataPath, isIsoDateLike, normalizeComparableSearchText, normalizeSearchText, splitFieldPathTokens } from './responseSearchSchema'

type ResolvedPredicate = {
  candidate: ScalarFieldCandidate
  predicate: string
  resolver: string
}

type ScoredCandidate = {
  candidate: ScalarFieldCandidate
  score: number
}

function escapeJsonString(value: string) {
  return JSON.stringify(value)
}

function scoreCandidate(candidate: ScalarFieldCandidate, fieldHint: string | null, tokens: string[]) {
  let score = candidate.arrayPath ? 2 : 0
  const pathTokens = splitFieldPathTokens(candidate.absolutePath)
  if (fieldHint && pathTokens.includes(fieldHint)) score += 14
  for (const token of tokens) {
    if (pathTokens.includes(token)) score += 4
  }
  if (fieldHint === 'type' && pathTokens.includes('type')) score += 10
  if (fieldHint === 'status' && (pathTokens.includes('status') || pathTokens.includes('state'))) score += 10
  if (fieldHint === 'segment' && pathTokens.includes('segment')) score += 10
  if (fieldHint === 'date' && (pathTokens.includes('date') || pathTokens.includes('created') || pathTokens.includes('updated') || pathTokens.includes('opened') || pathTokens.includes('closed'))) score += 10
  return score
}

function bestCandidateWithScore(candidates: ScalarFieldCandidate[], filter: (candidate: ScalarFieldCandidate) => boolean, fieldHint: string | null, rawQuery: string): ScoredCandidate | null {
  const tokens = normalizeSearchText(rawQuery).split(' ').filter(Boolean)
  let best: ScalarFieldCandidate | null = null
  let bestScore = -1

  for (const candidate of candidates) {
    if (!filter(candidate)) continue
    const score = scoreCandidate(candidate, fieldHint, tokens)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  return best ? { candidate: best, score: bestScore } : null
}

function bestCandidate(candidates: ScalarFieldCandidate[], filter: (candidate: ScalarFieldCandidate) => boolean, fieldHint: string | null, rawQuery: string) {
  return bestCandidateWithScore(candidates, filter, fieldHint, rawQuery)?.candidate ?? null
}

function isUnambiguousWithoutHint(candidates: ScalarFieldCandidate[], filter: (candidate: ScalarFieldCandidate) => boolean, fieldHint: string | null, rawQuery: string) {
  if (fieldHint) return true
  const matched = candidates.filter(filter)
  if (matched.length <= 1) return true
  const scored = bestCandidateWithScore(candidates, filter, fieldHint, rawQuery)
  return !!scored && scored.score >= 4
}

function resolveComparison(intent: Extract<SearchIntent, { kind: 'comparison' }>, candidates: ScalarFieldCandidate[]): ResolvedPredicate | null {
  const filter = (item: ScalarFieldCandidate) => item.kind === 'number'
  if (!isUnambiguousWithoutHint(candidates, filter, intent.fieldHint, intent.rawQuery)) return null
  const candidate = bestCandidate(candidates, filter, intent.fieldHint, intent.rawQuery)
  if (!candidate) return null
  return {
    candidate,
    predicate: `${formatJsonataPath(candidate.relativePath)} ${intent.op} ${String(intent.value)}`,
    resolver: 'numeric-comparison',
  }
}

function resolveDate(intent: Extract<SearchIntent, { kind: 'date' }>, candidates: ScalarFieldCandidate[]): ResolvedPredicate | null {
  const candidate = bestCandidate(
    candidates,
    item => item.kind === 'string' && item.samples.some(isIsoDateLike),
    intent.fieldHint ?? 'date',
    intent.rawQuery,
  )
  if (!candidate) return null

  if (intent.op === 'on') {
    return {
      candidate,
      predicate: `$contains(${formatJsonataPath(candidate.relativePath)}, ${escapeJsonString(intent.value)})`,
      resolver: 'date-contains',
    }
  }

  const operator = intent.op === 'after' ? '>' : '<'
  return {
    candidate,
    predicate: `${formatJsonataPath(candidate.relativePath)} ${operator} ${escapeJsonString(intent.value)}`,
    resolver: 'date-comparison',
  }
}

function resolveSemanticByBoolean(state: SearchSemanticState, candidates: ScalarFieldCandidate[], rawQuery: string) {
  if (state !== 'active' && state !== 'inactive' && state !== 'closed' && state !== 'open') return null
  const candidate = bestCandidate(
    candidates,
    item => item.kind === 'boolean' && splitFieldPathTokens(item.absolutePath).some(token => token === 'active' || token === 'open' || token === 'closed'),
    null,
    rawQuery,
  )
  if (!candidate) return null

  let booleanValue = true
  if (state === 'closed') booleanValue = true
  if (state === 'active' || state === 'open') booleanValue = true
  if (state === 'inactive') booleanValue = false
  if (splitFieldPathTokens(candidate.absolutePath).includes('closed') && (state === 'active' || state === 'open')) {
    booleanValue = false
  }
  if (splitFieldPathTokens(candidate.absolutePath).includes('closed') && state === 'inactive') {
    booleanValue = true
  }

  return {
    candidate,
    predicate: `${formatJsonataPath(candidate.relativePath)} = ${String(booleanValue)}`,
    resolver: 'semantic-boolean-flag',
  } satisfies ResolvedPredicate
}

function resolveSemanticByStatus(state: SearchSemanticState, candidates: ScalarFieldCandidate[], rawQuery: string) {
  const stateMap: Record<SearchSemanticState, string[]> = {
    active: ['active'],
    inactive: ['inactive', 'disabled', 'archived'],
    archived: ['archived'],
    failed: ['failed'],
    open: ['open', 'active'],
    closed: ['closed', 'archived'],
  }
  const expectedValues = stateMap[state]
  const candidate = bestCandidate(
    candidates,
    item => item.kind === 'string' && item.samples.some(sample => expectedValues.includes(normalizeComparableSearchText(sample))),
    'status',
    rawQuery,
  )
  if (!candidate) return null

  const exactSample = candidate.samples.find(sample => expectedValues.includes(normalizeComparableSearchText(sample)))
  if (!exactSample) return null

  return {
    candidate,
    predicate: `${formatJsonataPath(candidate.relativePath)} = ${escapeJsonString(exactSample)}`,
    resolver: 'semantic-status-value',
  } satisfies ResolvedPredicate
}

function resolveSemanticByDateWindow(state: SearchSemanticState, candidates: ScalarFieldCandidate[], rawQuery: string) {
  if (state !== 'active' && state !== 'inactive' && state !== 'open' && state !== 'closed') return null

  const openedCandidate = bestCandidate(
    candidates,
    item => item.kind === 'string' && item.samples.some(isIsoDateLike) && splitFieldPathTokens(item.absolutePath).some(token => token === 'opened' || token === 'start'),
    'date',
    rawQuery,
  )
  const closedCandidate = bestCandidate(
    candidates,
    item => item.kind === 'string' && item.samples.some(isIsoDateLike) && splitFieldPathTokens(item.absolutePath).some(token => token === 'closed' || token === 'end'),
    'date',
    rawQuery,
  )

  if (!openedCandidate && !closedCandidate) return null

  if ((state === 'closed' || state === 'inactive') && closedCandidate) {
    return {
      candidate: closedCandidate,
      predicate: `${formatJsonataPath(closedCandidate.relativePath)} != null`,
      resolver: 'semantic-date-window-closed',
    }
  }

  if (closedCandidate) {
    return {
      candidate: closedCandidate,
      predicate: `${formatJsonataPath(closedCandidate.relativePath)} = null`,
      resolver: 'semantic-date-window-open',
    }
  }

  if (openedCandidate) {
    return {
      candidate: openedCandidate,
      predicate: `${formatJsonataPath(openedCandidate.relativePath)} != null`,
      resolver: 'semantic-date-window-opened',
    }
  }

  return null
}

function resolveSemantic(intent: Extract<SearchIntent, { kind: 'semantic_state' }>, candidates: ScalarFieldCandidate[]): ResolvedPredicate | null {
  return resolveSemanticByBoolean(intent.value, candidates, intent.rawQuery)
    ?? resolveSemanticByStatus(intent.value, candidates, intent.rawQuery)
    ?? resolveSemanticByDateWindow(intent.value, candidates, intent.rawQuery)
}

function resolveEquals(intent: Extract<SearchIntent, { kind: 'equals' }>, candidates: ScalarFieldCandidate[]): ResolvedPredicate | null {
  const candidate = bestCandidate(
    candidates,
    item => {
      if (typeof intent.value === 'number') {
        return item.kind === 'number' && item.samples.some(sample => Number(sample.replace(',', '.')) === intent.value)
      }
      if (typeof intent.value === 'boolean') {
        return item.kind === 'boolean' && item.samples.some(sample => sample === String(intent.value))
      }
      return item.kind === 'string'
    },
    intent.fieldHint,
    intent.rawQuery,
  )
  if (!candidate) return null

  const value =
    typeof intent.value === 'string'
      ? candidate.samples.find(sample => normalizeComparableSearchText(sample) === normalizeComparableSearchText(intent.value as string)) ?? intent.value
      : intent.value

  return {
    candidate,
    predicate: `${formatJsonataPath(candidate.relativePath)} = ${typeof value === 'string' ? escapeJsonString(value) : String(value)}`,
    resolver: 'exact-equals',
  }
}

function resolveContains(intent: Extract<SearchIntent, { kind: 'contains' }>, candidates: ScalarFieldCandidate[]): ResolvedPredicate | null {
  const normalizedValue = normalizeComparableSearchText(intent.value)
  const candidate = bestCandidate(
    candidates,
    item => item.kind === 'string' && item.samples.some(sample => {
      const normalizedSample = normalizeComparableSearchText(sample)
      return normalizedSample === normalizedValue || normalizedValue.includes(normalizedSample) || normalizedSample.includes(normalizedValue)
    }),
    intent.fieldHint,
    intent.rawQuery,
  )

  if (!candidate) return null

  const exactSample = candidate.samples.find(sample => normalizeComparableSearchText(sample) === normalizedValue)
  if (exactSample) {
    return {
      candidate,
      predicate: `${formatJsonataPath(candidate.relativePath)} = ${escapeJsonString(exactSample)}`,
      resolver: 'contains-exact-sample',
    }
  }

  return {
    candidate,
    predicate: `$contains($lowercase(${formatJsonataPath(candidate.relativePath)}), ${escapeJsonString(normalizedValue)})`,
    resolver: 'contains-text',
  }
}

export function resolveIntentToPredicate(intent: SearchIntent, candidates: ScalarFieldCandidate[]): ResolvedPredicate | null {
  switch (intent.kind) {
    case 'comparison':
      return resolveComparison(intent, candidates)
    case 'date':
      return resolveDate(intent, candidates)
    case 'semantic_state':
      return resolveSemantic(intent, candidates)
    case 'equals':
      return resolveEquals(intent, candidates)
    case 'contains':
      return resolveContains(intent, candidates)
  }
}
