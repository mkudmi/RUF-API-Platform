import type { ScalarFieldCandidate, SearchIntent, SearchSemanticState } from './responseSearchTypes'
import { isIsoDateLike, normalizeComparableSearchText, normalizeSearchText } from './responseSearchSchema'

const MONTH_ALIASES: Record<string, string> = {
  january: '01', jan: '01', 'января': '01', 'январь': '01',
  february: '02', feb: '02', 'февраля': '02', 'февраль': '02',
  march: '03', mar: '03', 'марта': '03', 'март': '03',
  april: '04', apr: '04', 'апреля': '04', 'апрель': '04',
  may: '05', 'мая': '05',
  june: '06', jun: '06', 'июня': '06', 'июнь': '06',
  july: '07', jul: '07', 'июля': '07', 'июль': '07',
  august: '08', aug: '08', 'августа': '08', 'август': '08',
  september: '09', sep: '09', sept: '09', 'сентября': '09', 'сентябрь': '09',
  october: '10', oct: '10', 'октября': '10', 'октябрь': '10',
  november: '11', nov: '11', 'ноября': '11', 'ноябрь': '11',
  december: '12', dec: '12', 'декабря': '12', 'декабрь': '12',
}

const SEMANTIC_STATE_ALIASES: Array<{ terms: string[]; value: SearchSemanticState }> = [
  { terms: ['не активн', 'неактивн', 'inactive', 'disabled'], value: 'inactive' },
  { terms: ['активн', 'active'], value: 'active' },
  { terms: ['архив', 'archived'], value: 'archived' },
  { terms: ['ошибк', 'failed', 'failure'], value: 'failed' },
  { terms: ['открыт', 'open'], value: 'open' },
  { terms: ['закрыт', 'closed'], value: 'closed' },
]

const VALUE_ALIASES: Array<{ terms: string[]; canonical: string }> = [
  { terms: ['b2b'], canonical: 'b2b' },
  { terms: ['b2c'], canonical: 'b2c' },
  { terms: ['ритейл', 'retail', 'рознич'], canonical: 'retail' },
  { terms: ['опт', 'wholesale'], canonical: 'wholesale' },
  { terms: ['active', 'активн'], canonical: 'active' },
  { terms: ['archived', 'архив'], canonical: 'archived' },
  { terms: ['failed', 'ошибк'], canonical: 'failed' },
  { terms: ['processing', 'обработ'], canonical: 'processing' },
]

const FIELD_HINT_ALIASES: Array<{ terms: string[]; value: string }> = [
  { terms: ['сегмент', 'segment'], value: 'segment' },
  { terms: ['статус', 'status', 'state'], value: 'status' },
  { terms: ['тип', 'type', 'kind'], value: 'type' },
  { terms: ['сумм', 'amount', 'total', 'price'], value: 'amount' },
  { terms: ['создан', 'created', 'дата', 'date', 'opened', 'closed', 'updated'], value: 'date' },
]

function detectFieldHint(query: string) {
  const normalized = normalizeSearchText(query)
  return FIELD_HINT_ALIASES.find(item => item.terms.some(term => normalized.includes(term)))?.value ?? null
}

function detectComparison(query: string): SearchIntent | null {
  const normalized = normalizeSearchText(query)
  const rawLower = query.toLowerCase()
  const numberMatch = normalized.match(/-?\d+(?:[.,]\d+)?/)
  if (!numberMatch) return null
  const value = Number(numberMatch[0].replace(',', '.'))
  if (!Number.isFinite(value)) return null

  if (normalized.includes('не меньше') || normalized.includes('at least') || rawLower.includes('>=') || normalized.includes('не менее')) return { kind: 'comparison', rawQuery: query, fieldHint: detectFieldHint(query), op: '>=', value }
  if (normalized.includes('не больше') || normalized.includes('at most') || rawLower.includes('<=') || normalized.includes('не более')) return { kind: 'comparison', rawQuery: query, fieldHint: detectFieldHint(query), op: '<=', value }
  if (normalized.includes('больше') || normalized.includes('greater than') || normalized.includes('more than') || normalized.includes('over') || normalized.includes('above') || rawLower.includes('>')) return { kind: 'comparison', rawQuery: query, fieldHint: detectFieldHint(query), op: '>', value }
  if (normalized.includes('меньше') || normalized.includes('less than') || normalized.includes('under') || normalized.includes('below') || rawLower.includes('<')) return { kind: 'comparison', rawQuery: query, fieldHint: detectFieldHint(query), op: '<', value }
  return null
}

function findIsoYearForMonthDay(candidates: ScalarFieldCandidate[], month: string, day: string) {
  for (const candidate of candidates) {
    for (const sample of candidate.samples) {
      const match = sample.match(/^(\d{4})-(\d{2})-(\d{2})/)
      if (match?.[2] === month && match?.[3] === day) return match[1]
    }
  }
  return null
}

function detectDate(query: string, candidates: ScalarFieldCandidate[]): SearchIntent | null {
  const normalized = normalizeSearchText(query)
  let value: string | null = null

  const iso = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (iso) value = iso[1]

  const dot = !value ? normalized.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\b/) : null
  if (!value && dot) {
    const day = dot[1].padStart(2, '0')
    const month = dot[2].padStart(2, '0')
    const year = dot[3] ?? findIsoYearForMonthDay(candidates, month, day)
    if (year) value = `${year}-${month}-${day}`
  }

  const named = !value ? normalized.match(/\b(\d{1,2})\s+([a-zа-я]+)(?:\s+(\d{4}))?\b/u) : null
  if (!value && named) {
    const day = named[1].padStart(2, '0')
    const month = MONTH_ALIASES[named[2]]
    if (month) {
      if (named[3]) {
        value = `${named[3]}-${month}-${day}`
      } else {
        const year = findIsoYearForMonthDay(candidates, month, day)
        if (year) value = `${year}-${month}-${day}`
      }
    }
  }

  if (!value) return null

  let op: 'on' | 'before' | 'after' = 'on'
  if (normalized.includes('после') || normalized.includes('after') || normalized.includes('later than')) op = 'after'
  else if (normalized.includes('до') || normalized.includes('before') || normalized.includes('earlier than')) op = 'before'

  return { kind: 'date', rawQuery: query, fieldHint: detectFieldHint(query), op, value }
}

function inferValueNeedle(query: string, candidates: ScalarFieldCandidate[]) {
  const normalizedQuery = normalizeComparableSearchText(query)
  let best: string | null = null

  for (const candidate of candidates) {
    for (const sample of candidate.samples) {
      if (!sample || isIsoDateLike(sample)) continue
      const normalizedSample = normalizeComparableSearchText(sample)
      if (!normalizedSample) continue
      if (normalizedQuery.includes(normalizedSample)) {
        if (!best || normalizedSample.length > best.length) best = sample
      }
    }
  }

  if (best) return best

  for (const alias of VALUE_ALIASES) {
    if (!alias.terms.some(term => normalizedQuery.includes(term))) continue
    const exact = candidates
      .flatMap(candidate => candidate.samples)
      .find(sample => normalizeComparableSearchText(sample) === alias.canonical)
    if (exact) return exact
    return alias.canonical
  }

  const quoted = query.match(/"([^"]+)"|'([^']+)'/)
  const rawQuoted = quoted?.[1] ?? quoted?.[2]
  if (rawQuoted?.trim()) return rawQuoted.trim()

  return null
}

function detectSemanticState(query: string): SearchIntent | null {
  const normalized = normalizeSearchText(query)
  const found = SEMANTIC_STATE_ALIASES.find(item => item.terms.some(term => normalized.includes(term)))
  if (!found) return null
  return { kind: 'semantic_state', rawQuery: query, fieldHint: detectFieldHint(query), value: found.value }
}

export function buildResponseSearchIntent(userQuery: string, candidates: ScalarFieldCandidate[]): SearchIntent | null {
  const query = userQuery.trim()
  if (!query) return null

  const comparison = detectComparison(query)
  if (comparison) return comparison

  const date = detectDate(query, candidates)
  if (date) return date

  const semantic = detectSemanticState(query)
  if (semantic) return semantic

  const valueNeedle = inferValueNeedle(query, candidates)
  if (!valueNeedle) return null

  if (valueNeedle === 'true' || valueNeedle === 'false') {
    return { kind: 'equals', rawQuery: query, fieldHint: detectFieldHint(query), value: valueNeedle === 'true' }
  }

  const numeric = Number(valueNeedle.replace(',', '.'))
  if (Number.isFinite(numeric) && /-?\d+(?:[.,]\d+)?/.test(valueNeedle)) {
    return { kind: 'equals', rawQuery: query, fieldHint: detectFieldHint(query), value: numeric }
  }

  return { kind: 'contains', rawQuery: query, fieldHint: detectFieldHint(query), value: valueNeedle }
}
