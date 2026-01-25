import { safeJsonParse } from '../../../shared/utils/http'

const RESPONSE_SEARCH_HISTORY_KEY = 'ruf_response_search_history_v1'

export function loadResponseSearchHistory(maxItems = 10): string[] {
  const raw = localStorage.getItem(RESPONSE_SEARCH_HISTORY_KEY)
  if (!raw) return []
  const parsed = safeJsonParse(raw)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(Boolean)
    .slice(0, maxItems)
}

export function saveResponseSearchHistory(items: string[]) {
  localStorage.setItem(RESPONSE_SEARCH_HISTORY_KEY, JSON.stringify(items))
}

export function addResponseSearchHistoryEntry(prev: string[], queryRaw: string, maxItems = 10): string[] {
  const q = queryRaw.trim()
  if (!q) return prev
  const next = [q, ...prev.filter(v => v !== q)].slice(0, maxItems)
  if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev
  return next
}
