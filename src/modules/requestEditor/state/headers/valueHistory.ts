import { safeParseJson } from '../../utils/json'

const VALUE_HISTORY_KEY = 'ruf_value_history_v1'
const HEADER_HISTORY_KEY = '*'

export type ValueHistoryKind = 'header' | 'query' | 'path'
export type ValueHistoryStore = Record<ValueHistoryKind, Record<string, string[]>>

export function loadValueHistory(): ValueHistoryStore {
  const parsed = safeParseJson<any>(localStorage.getItem(VALUE_HISTORY_KEY))
  const empty: ValueHistoryStore = { header: {}, query: {}, path: {} }
  if (!parsed || typeof parsed !== 'object') return empty
  const obj = parsed as Partial<ValueHistoryStore>
  return {
    header: obj.header && typeof obj.header === 'object' ? obj.header : {},
    query: obj.query && typeof obj.query === 'object' ? obj.query : {},
    path: obj.path && typeof obj.path === 'object' ? obj.path : {},
  }
}

export function saveValueHistory(store: ValueHistoryStore) {
  localStorage.setItem(VALUE_HISTORY_KEY, JSON.stringify(store))
}

export function addValueHistoryEntry(
  prev: ValueHistoryStore,
  kind: ValueHistoryKind,
  keyRaw: string,
  valueRaw: string,
  maxItems = 10,
): ValueHistoryStore {
  const key = kind === 'header' ? HEADER_HISTORY_KEY : keyRaw.trim()
  const value = valueRaw.trim()
  if (!key || !value) return prev

  const prevByKind = prev[kind] ?? {}
  const prevList = kind === 'header' ? getHeaderValueHistoryItems(prev, maxItems) : (prevByKind[key] ?? [])
  const nextList = [value, ...prevList.filter(v => v !== value)].slice(0, maxItems)
  if (prevList.length === nextList.length && prevList.every((v, i) => v === nextList[i])) return prev

  return {
    ...prev,
    [kind]: {
      ...(kind === 'header' ? {} : prevByKind),
      [key]: nextList,
    },
  }
}

export function removeValueHistoryEntry(
  prev: ValueHistoryStore,
  kind: ValueHistoryKind,
  keyRaw: string,
  valueRaw: string,
): ValueHistoryStore {
  const key = kind === 'header' ? HEADER_HISTORY_KEY : keyRaw.trim()
  const value = valueRaw.trim()
  if (!key || !value) return prev

  const prevByKind = prev[kind] ?? {}
  const prevList = kind === 'header' ? getHeaderValueHistoryItems(prev) : (prevByKind[key] ?? [])
  if (!prevList.length) return prev

  const nextList = prevList.filter(v => v !== value)
  if (nextList.length === prevList.length) return prev

  const nextByKind: Record<string, string[]> = { ...prevByKind }
  if (nextList.length) nextByKind[key] = nextList
  else delete nextByKind[key]

  return { ...prev, [kind]: kind === 'header' ? (nextList.length ? { [HEADER_HISTORY_KEY]: nextList } : {}) : nextByKind }
}

export function getHeaderValueHistoryItems(store: ValueHistoryStore, maxItems = 10): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const byHeader = store.header ?? {}

  const push = (value: string) => {
    const next = value.trim()
    if (!next || seen.has(next)) return
    seen.add(next)
    out.push(next)
  }

  for (const value of byHeader[HEADER_HISTORY_KEY] ?? []) push(value)
  for (const [key, values] of Object.entries(byHeader)) {
    if (key === HEADER_HISTORY_KEY || !Array.isArray(values)) continue
    for (const value of values) push(value)
  }

  return out.slice(0, maxItems)
}
