import { safeParseJson } from './json'

const VALUE_HISTORY_KEY = 'ruf_value_history_v1'

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
  const key = keyRaw.trim()
  const value = valueRaw.trim()
  if (!key || !value) return prev

  const prevByKind = prev[kind] ?? {}
  const prevList = prevByKind[key] ?? []
  const nextList = [value, ...prevList.filter(v => v !== value)].slice(0, maxItems)
  if (prevList.length === nextList.length && prevList.every((v, i) => v === nextList[i])) return prev

  return {
    ...prev,
    [kind]: {
      ...prevByKind,
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
  const key = keyRaw.trim()
  const value = valueRaw.trim()
  if (!key || !value) return prev

  const prevByKind = prev[kind] ?? {}
  const prevList = prevByKind[key] ?? []
  if (!prevList.length) return prev

  const nextList = prevList.filter(v => v !== value)
  if (nextList.length === prevList.length) return prev

  const nextByKind: Record<string, string[]> = { ...prevByKind }
  if (nextList.length) nextByKind[key] = nextList
  else delete nextByKind[key]

  return { ...prev, [kind]: nextByKind }
}

