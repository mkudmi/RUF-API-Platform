import type { RequestHistoryItem } from '../types/requestHistory'
import { safeParseJson } from './json'

const REQUEST_HISTORY_KEY = 'ruf_request_history_v1'

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

function normalizeHistoryItem(raw: unknown): RequestHistoryItem | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : 0
  const method = typeof raw.method === 'string' ? (raw.method as any) : ''
  const url = typeof raw.url === 'string' ? raw.url : undefined
  const runId = typeof raw.runId === 'string' ? raw.runId : undefined
  const responseStatus = typeof raw.responseStatus === 'number'
    ? raw.responseStatus
    : null
  const responseStatusText = typeof raw.responseStatusText === 'string' ? raw.responseStatusText : undefined
  const draft = isRecord(raw.draft) ? (raw.draft as any) : {}
  if (!id || !createdAt || !method) return null
  return { id, createdAt, method, url, runId, responseStatus, responseStatusText, draft }
}

export function loadRequestHistoryByRequestId(): Record<string, RequestHistoryItem[]> {
  const parsed = safeParseJson<unknown>(localStorage.getItem(REQUEST_HISTORY_KEY))
  if (!isRecord(parsed)) return {}

  const out: Record<string, RequestHistoryItem[]> = {}
  for (const [requestId, arr] of Object.entries(parsed)) {
    if (typeof requestId !== 'string' || !requestId) continue
    if (!Array.isArray(arr)) continue
    const items: RequestHistoryItem[] = []
    for (const rawItem of arr) {
      const item = normalizeHistoryItem(rawItem)
      if (item) items.push(item)
    }
    if (items.length) out[requestId] = items
  }
  return out
}

export function saveRequestHistoryByRequestId(history: Record<string, RequestHistoryItem[]>) {
  localStorage.setItem(REQUEST_HISTORY_KEY, JSON.stringify(history))
}

export function appendRequestHistoryItem(args: {
  historyByRequestId: Record<string, RequestHistoryItem[]>
  requestId: string
  item: RequestHistoryItem
  maxItemsPerRequest?: number
}): Record<string, RequestHistoryItem[]> {
  const maxItemsPerRequest = args.maxItemsPerRequest ?? 30
  const prevItems = args.historyByRequestId[args.requestId] ?? []
  const nextItems = [args.item, ...prevItems].slice(0, Math.max(1, maxItemsPerRequest))
  return { ...args.historyByRequestId, [args.requestId]: nextItems }
}
