import { safeJsonParse } from '../../shared/utils/http'
import { generateJsonSchema, stringifyJsonSchema } from '../../shared/utils/jsonSchema'

export type ResponseSearchFieldKind = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'

export type ResponseSearchFieldCandidate = {
  fieldPath: string
  kind: ResponseSearchFieldKind
  samples: string[]
}

export type ResponseSearchContext = {
  schemaText: string
  structureHintsText: string
  stringValueHintsText: string
  fieldCandidates: ResponseSearchFieldCandidate[]
}

const MAX_STRUCTURE_DEPTH = 8
const MAX_STRUCTURE_ENTRIES = 160
const MAX_SAMPLES_PER_PATH = 3
const MAX_STRING_VALUE_HINTS = 120
const MAX_FIELD_CANDIDATES = 160

function jsonKind(value: unknown): ResponseSearchFieldKind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'object'
}

function formatSampleValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}...` : value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  return ''
}

export function normalizeResponseSearchFieldPath(path: string) {
  return path
    .trim()
    .replace(/^\$\.?/, '')
    .replaceAll('[*]', '')
    .replaceAll(/\.\./g, '.')
    .replaceAll(/\.$/g, '')
    .replaceAll(/^\./g, '')
}

export function buildResponseSearchContext(bodyText: string): ResponseSearchContext {
  const parsed = safeJsonParse(bodyText)
  if (parsed === null || typeof parsed !== 'object') {
    return {
      schemaText: '(response body is not valid JSON)',
      structureHintsText: '(response body is not valid JSON)',
      stringValueHintsText: '(no string values discovered)',
      fieldCandidates: [],
    }
  }

  const structureEntries = new Map<string, { path: string, kind: ResponseSearchFieldKind, samples: string[] }>()
  const stringValueHints: string[] = []
  const seenStringValueHints = new Set<string>()
  const fieldCandidates = new Map<string, ResponseSearchFieldCandidate>()

  const ensureStructureEntry = (path: string, value: unknown) => {
    if (!path || structureEntries.size >= MAX_STRUCTURE_ENTRIES) return
    const kind = jsonKind(value)
    let entry = structureEntries.get(path)
    if (!entry) {
      entry = { path, kind, samples: [] }
      structureEntries.set(path, entry)
    }

    if (entry.kind === kind && entry.samples.length < MAX_SAMPLES_PER_PATH) {
      const sample = formatSampleValue(value)
      if (sample && !entry.samples.includes(sample)) entry.samples.push(sample)
    }
  }

  const ensureFieldCandidate = (path: string, value: unknown) => {
    const normalizedPath = normalizeResponseSearchFieldPath(path)
    if (!normalizedPath || fieldCandidates.size >= MAX_FIELD_CANDIDATES) return

    const kind = jsonKind(value)
    let entry = fieldCandidates.get(normalizedPath)
    if (!entry) {
      entry = { fieldPath: normalizedPath, kind, samples: [] }
      fieldCandidates.set(normalizedPath, entry)
    }

    if (entry.kind === kind && entry.samples.length < MAX_SAMPLES_PER_PATH) {
      const sample = formatSampleValue(value)
      if (sample && !entry.samples.includes(sample)) entry.samples.push(sample)
    }
  }

  const visit = (value: unknown, path: string, depth: number) => {
    if (depth > MAX_STRUCTURE_DEPTH) return

    ensureStructureEntry(path, value)
    ensureFieldCandidate(path, value)

    if (typeof value === 'string') {
      if (stringValueHints.length < MAX_STRING_VALUE_HINTS) {
        const normalized = value.trim()
        if (normalized) {
          const sample = normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
          const line = `${path} = ${JSON.stringify(sample)}`
          if (!seenStringValueHints.has(line)) {
            seenStringValueHints.add(line)
            stringValueHints.push(line)
          }
        }
      }
      return
    }

    if (Array.isArray(value)) {
      const sampleItems = value.slice(0, 5)
      for (const item of sampleItems) visit(item, `${path}[*]`, depth + 1)
      return
    }

    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      visit(child, `${path}.${key}`, depth + 1)
    }
  }

  visit(parsed, '$', 0)

  const structureHintsText = Array.from(structureEntries.values())
    .map(entry => {
      const sampleText = entry.samples.length ? ` | examples: ${entry.samples.join(', ')}` : ''
      return `${entry.path} -> ${entry.kind}${sampleText}`
    })
    .join('\n') || '(no paths discovered)'

  const schemaText = stringifyJsonSchema(generateJsonSchema(parsed, 'responseSearchSchema'))
  const stringValueHintsText = stringValueHints.join('\n') || '(no string values discovered)'

  return {
    schemaText,
    structureHintsText,
    stringValueHintsText,
    fieldCandidates: Array.from(fieldCandidates.values()),
  }
}

export function buildResponseSearchFieldCandidatesText(context: ResponseSearchContext) {
  if (!context.fieldCandidates.length) return '(no field candidates discovered)'
  return context.fieldCandidates
    .map(candidate => {
      const sampleText = candidate.samples.length ? ` | examples: ${candidate.samples.join(', ')}` : ''
      return `${candidate.fieldPath} -> ${candidate.kind}${sampleText}`
    })
    .join('\n')
}

export function hasResponseSearchFieldCandidate(context: ResponseSearchContext, fieldPath: string) {
  const normalized = normalizeResponseSearchFieldPath(fieldPath)
  if (!normalized) return false
  return context.fieldCandidates.some(candidate => candidate.fieldPath === normalized)
}

export function serializeResponseSearchValue(value: unknown): string | null {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    const parts = value
      .map(item => serializeResponseSearchValue(item))
      .filter((item): item is string => !!item)
    return parts.length ? parts.join(', ') : null
  }
  return null
}
