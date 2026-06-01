import type { Collection } from '../../modules/collectionTree'
import type { Environment } from '../types/environment'
import { logError } from './logger'

const COLLECTIONS_KEY = 'ruf_collections_v1'
const ENVS_BY_COLLECTION_KEY = 'ruf_env_by_collection_v1'

function findKeyCaseInsensitive(obj: Record<string, unknown>, name: string): string | undefined {
  const needle = name.toLowerCase()
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === needle) return key
  }
  return undefined
}

function setHeaderCaseInsensitive(headers: Record<string, string>, name: string, value: string) {
  const existingKey = findKeyCaseInsensitive(headers, name)
  if (existingKey && existingKey !== name) delete headers[existingKey]
  headers[name] = value
}

export function loadCollections(): Collection[] {
  try {
    const raw = localStorage.getItem(COLLECTIONS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as Collection[]
  } catch (error) {
    logError('loadCollections', error)
    return []
  }
}

export function saveCollections(cols: Collection[]) {
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(cols))
}

export function loadEnvironmentsByCollection(): Record<string, Environment> {
  try {
    const raw = localStorage.getItem(ENVS_BY_COLLECTION_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as any
    if (!parsed || typeof parsed !== 'object') return {}

    const out: Record<string, Environment> = {}
    for (const [id, env] of Object.entries(parsed)) {
      if (typeof id !== 'string' || !id) continue
      const baseUrlKey = typeof (env as any)?.baseUrlKey === 'string' && (env as any).baseUrlKey.trim()
        ? (env as any).baseUrlKey.trim()
        : 'baseUrl'

      const varsObj = (env as any)?.variables && typeof (env as any).variables === 'object' ? (env as any).variables : {}
      const variables: Record<string, string> = {}
      for (const [k, v] of Object.entries(varsObj)) {
        if (typeof k === 'string' && k.trim() && typeof v === 'string') variables[k.trim()] = v
      }

      // backward-compat: old env schema stored { baseUrl, headers }
      const legacyBaseUrl = typeof (env as any)?.baseUrl === 'string' ? (env as any).baseUrl : ''
      if (!variables[baseUrlKey] && legacyBaseUrl) variables[baseUrlKey] = legacyBaseUrl
      if (!variables[baseUrlKey]) variables[baseUrlKey] = ''
      if (typeof variables.scheme !== 'string' || !variables.scheme.trim()) variables.scheme = 'http'

      const headersObj = (env as any)?.headers && typeof (env as any).headers === 'object' ? (env as any).headers : {}
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(headersObj)) {
        if (typeof k === 'string' && typeof v === 'string' && k.trim()) setHeaderCaseInsensitive(headers, k.trim(), v)
      }
      out[id] = { baseUrlKey, variables, headers }
    }
    return out
  } catch (error) {
    logError('loadEnvironmentsByCollection', error)
    return {}
  }
}

export function saveEnvironmentsByCollection(envs: Record<string, Environment>) {
  localStorage.setItem(ENVS_BY_COLLECTION_KEY, JSON.stringify(envs))
}
