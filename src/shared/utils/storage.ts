import type { Collection } from '../types/collection'
import type { Environment } from '../types/environment'

const COLLECTIONS_KEY = 'ruf_collections_v1'
const ENVS_BY_COLLECTION_KEY = 'ruf_env_by_collection_v1'

export function loadCollections(): Collection[] {
  try {
    const raw = localStorage.getItem(COLLECTIONS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as Collection[]
  } catch {
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
      const baseUrl = typeof (env as any)?.baseUrl === 'string' ? (env as any).baseUrl : ''
      const headersObj = (env as any)?.headers && typeof (env as any).headers === 'object' ? (env as any).headers : {}
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(headersObj)) {
        if (typeof k === 'string' && typeof v === 'string' && k.trim()) headers[k] = v
      }
      out[id] = { baseUrl, headers }
    }
    return out
  } catch {
    return {}
  }
}

export function saveEnvironmentsByCollection(envs: Record<string, Environment>) {
  localStorage.setItem(ENVS_BY_COLLECTION_KEY, JSON.stringify(envs))
}
