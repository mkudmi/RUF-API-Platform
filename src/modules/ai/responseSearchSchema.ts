import { safeJsonParse } from '../../shared/utils/http'
import type { ResponseSearchSnapshot, ScalarFieldCandidate, ScalarFieldKind } from './responseSearchTypes'

const MAX_ARRAY_ITEMS = 25
const MAX_SAMPLES_PER_FIELD = 6

function scalarKind(value: string | number | boolean | null): ScalarFieldKind {
  return value === null ? 'null' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string'
}

export function normalizeSearchText(text: string) {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s._:-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeComparableSearchText(text: string) {
  return normalizeSearchText(text).replace(/["']/g, '').trim()
}

export function splitFieldPathTokens(path: string) {
  return path
    .split('.')
    .flatMap(part => part.split(/[_\-\s]+/g))
    .map(token => token.trim().toLowerCase())
    .filter(Boolean)
}

export function isSafeJsonataName(name: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
}

export function formatJsonataPath(path: string) {
  const parts = path.split('.').map(part => part.trim()).filter(Boolean)
  if (!parts.length) return '$'

  let expression = ''
  for (const part of parts) {
    if (isSafeJsonataName(part)) {
      expression = expression ? `${expression}.${part}` : part
      continue
    }

    if (!part.includes('`')) {
      expression = expression ? `${expression}.\`${part}\`` : `\`${part}\``
      continue
    }

    expression = `$lookup(${expression || '$'}, ${JSON.stringify(part)})`
  }

  return expression
}

export function isIsoDateLike(value: string) {
  return /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(value.trim())
}

export function collectScalarFieldCandidates(snapshot: ResponseSearchSnapshot): ScalarFieldCandidate[] {
  const parsed = safeJsonParse(snapshot.response.bodyText)
  if (parsed === null || typeof parsed !== 'object') return []

  const candidates = new Map<string, ScalarFieldCandidate>()

  function ensureCandidate(absolutePath: string, arrayPath: string | null, value: string | number | boolean | null) {
    const kind = scalarKind(value)
    const relativePath = arrayPath && absolutePath.startsWith(`${arrayPath}.`)
      ? absolutePath.slice(arrayPath.length + 1)
      : absolutePath
    const key = `${arrayPath || '$'}::${absolutePath}`

    let candidate = candidates.get(key)
    if (!candidate) {
      candidate = { absolutePath, relativePath, arrayPath, kind, samples: [] }
      candidates.set(key, candidate)
    }

    const sample = typeof value === 'string' ? value : value === null ? 'null' : String(value)
    if (!candidate.samples.includes(sample) && candidate.samples.length < MAX_SAMPLES_PER_FIELD) {
      candidate.samples.push(sample)
    }
  }

  function visit(value: unknown, path: string, nearestArrayPath: string | null) {
    if (Array.isArray(value)) {
      const arrayPath = path
      for (const item of value.slice(0, MAX_ARRAY_ITEMS)) {
        visit(item, `${path}[*]`, arrayPath)
      }
      return
    }

    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const absolutePath = path.replaceAll('[*].', '.').replaceAll('[*]', '')
      ensureCandidate(absolutePath, nearestArrayPath?.replaceAll('[*]', '') ?? null, value)
      return
    }

    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      visit(child, path ? `${path}.${key}` : key, nearestArrayPath)
    }
  }

  visit(parsed, '', null)
  return Array.from(candidates.values())
}
