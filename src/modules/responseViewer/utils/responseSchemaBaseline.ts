import type { RequestItem } from '../../collectionTree'
import { parseJsonSchemaText, stringifyJsonSchema } from '../../../shared/utils/jsonSchema'
import { loadLocalStorageJson, saveLocalStorageJson } from '../../../shared/utils/localStorageJson'

export const RESPONSE_SCHEMA_BASELINES_KEY = 'ruf_response_schema_baselines_v1'
export const RESPONSE_SCHEMA_BASELINE_KEY_PREFIX = `${RESPONSE_SCHEMA_BASELINES_KEY}/`

export type ResponseSchemaBaseline = {
  requestId: string
  requestName: string
  method: string
  path: string
  schemaText: string
  updatedAt: number
}

type ResponseSchemaBaselinesRecord = Record<string, ResponseSchemaBaseline>

function getResponseSchemaBaselineStorageKey(requestId: string) {
  return `${RESPONSE_SCHEMA_BASELINE_KEY_PREFIX}${requestId}`
}

function parseResponseSchemaBaseline(raw: unknown, requestId: string): ResponseSchemaBaseline | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const schemaText = typeof record.schemaText === 'string' ? record.schemaText.trim() : ''
  if (!requestId.trim() || !schemaText) return null
  return {
    requestId,
    requestName: typeof record.requestName === 'string' ? record.requestName : '',
    method: typeof record.method === 'string' ? record.method : '',
    path: typeof record.path === 'string' ? record.path : '',
    schemaText,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
  }
}

function loadLegacyResponseSchemaBaselines(): ResponseSchemaBaselinesRecord {
  const parsed = loadLocalStorageJson<unknown>(RESPONSE_SCHEMA_BASELINES_KEY, {})
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  const out: ResponseSchemaBaselinesRecord = {}
  for (const [requestId, raw] of Object.entries(parsed)) {
    const baseline = parseResponseSchemaBaseline(raw, requestId)
    if (baseline) out[requestId] = baseline
  }
  return out
}

function migrateLegacyResponseSchemaBaselinesIfNeeded() {
  const legacy = loadLegacyResponseSchemaBaselines()
  if (!Object.keys(legacy).length) return

  for (const baseline of Object.values(legacy)) {
    saveLocalStorageJson(getResponseSchemaBaselineStorageKey(baseline.requestId), baseline)
  }
  localStorage.removeItem(RESPONSE_SCHEMA_BASELINES_KEY)
}

export function isResponseSchemaBaselineStorageKey(key: string) {
  return key === RESPONSE_SCHEMA_BASELINES_KEY || key.startsWith(RESPONSE_SCHEMA_BASELINE_KEY_PREFIX)
}

export function getResponseSchemaBaselineStorageKeys() {
  const keys: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key || !isResponseSchemaBaselineStorageKey(key)) continue
    keys.push(key)
  }
  return keys
}

export function loadResponseSchemaBaseline(requestId: string): ResponseSchemaBaseline | null {
  if (!requestId.trim()) return null
  migrateLegacyResponseSchemaBaselinesIfNeeded()
  const raw = loadLocalStorageJson<unknown>(getResponseSchemaBaselineStorageKey(requestId), null)
  return parseResponseSchemaBaseline(raw, requestId)
}

export function saveResponseSchemaBaseline(args: {
  request: RequestItem
  schemaText: string
}): ResponseSchemaBaseline {
  migrateLegacyResponseSchemaBaselinesIfNeeded()

  const parsed = parseJsonSchemaText(args.schemaText)
  if (!parsed) throw new Error('Schema must be valid JSON.')

  const nextBaseline: ResponseSchemaBaseline = {
    requestId: args.request.id,
    requestName: args.request.name || 'Untitled request',
    method: args.request.method,
    path: args.request.path,
    schemaText: stringifyJsonSchema(parsed),
    updatedAt: Date.now(),
  }

  saveLocalStorageJson(getResponseSchemaBaselineStorageKey(args.request.id), nextBaseline)
  return nextBaseline
}

export function deleteResponseSchemaBaseline(requestId: string) {
  if (!requestId.trim()) return
  migrateLegacyResponseSchemaBaselinesIfNeeded()
  localStorage.removeItem(getResponseSchemaBaselineStorageKey(requestId))
}
