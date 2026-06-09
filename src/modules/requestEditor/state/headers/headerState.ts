import type { RequestParam } from '../../../collectionTree'

export function headerNameExistsCaseInsensitive(headers: Record<string, string>, name: string): boolean {
  const needle = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === needle) return true
  }
  return false
}

export function findHeaderKeyCaseInsensitive(headers: Record<string, unknown>, name: string): string | undefined {
  const needle = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === needle) return key
  }
  return undefined
}

export function getHeaderCaseInsensitive(headers: Record<string, string>, name: string): string | undefined {
  const key = findHeaderKeyCaseInsensitive(headers, name)
  return key ? headers[key] : undefined
}

export function setHeaderCaseInsensitive(headers: Record<string, string>, name: string, value: string) {
  const existingKey = findHeaderKeyCaseInsensitive(headers, name)
  if (existingKey && existingKey !== name) delete headers[existingKey]
  headers[name] = value
}

export function deleteHeaderCaseInsensitive(headers: Record<string, unknown>, name: string): boolean {
  const existingKey = findHeaderKeyCaseInsensitive(headers, name)
  if (!existingKey) return false
  delete headers[existingKey]
  return true
}

export function mergeHeadersCaseInsensitive(...sources: Array<Record<string, string>>): Record<string, string> {
  const next: Record<string, string> = {}
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) setHeaderCaseInsensitive(next, key, value)
  }
  return next
}

export function setFlagForHeaderName(prev: Record<string, true>, headerNameRaw: string, active: boolean): Record<string, true> {
  const headerName = headerNameRaw.trim()
  if (!headerName) return prev
  const needle = headerName.toLowerCase()

  let changed = false
  const next: Record<string, true> = {}
  for (const key of Object.keys(prev)) {
    if (key.toLowerCase() === needle) {
      changed = true
      continue
    }
    next[key] = true
  }

  if (!active && !(headerName in next)) {
    next[headerName] = true
    changed = true
  }

  return changed ? next : prev
}

export function headerIsInactive(inactiveHeaderNames: Record<string, true>, headerName: string): boolean {
  const needle = headerName.toLowerCase()
  for (const key of Object.keys(inactiveHeaderNames)) {
    if (key.toLowerCase() === needle) return true
  }
  return false
}

export function defaultInactiveHeaderNamesFromSpec(
  params: RequestParam[],
  requestBaseHeaders: Record<string, string>,
): Record<string, true> {
  const out: Record<string, true> = {}
  for (const param of params) {
    if (!param || param.in !== 'header') continue
    if (param.required !== false) continue
    const name = (param.name || '').trim()
    if (!name) continue
    if (name.toLowerCase() === 'authorization') continue
    if (headerNameExistsCaseInsensitive(requestBaseHeaders, name)) continue
    out[name] = true
  }
  return out
}

export function removeInactiveHeaders(
  headers: Record<string, string>,
  inactiveHeaderNames: Record<string, true>,
): Record<string, string> {
  const needles = new Set(Object.keys(inactiveHeaderNames).map(key => key.toLowerCase()).filter(Boolean))
  if (!needles.size) return headers

  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (needles.has(key.toLowerCase())) continue
    next[key] = value
  }
  return next
}

export function findKeyIndexCaseInsensitive(list: string[], needle: string): number {
  const loweredNeedle = needle.toLowerCase()
  for (let index = 0; index < list.length; index++) {
    if ((list[index] ?? '').toLowerCase() === loweredNeedle) return index
  }
  return -1
}

export function replaceKeyInOrderCaseInsensitive(prev: string[], fromKey: string, toKey: string): string[] {
  const from = fromKey.trim()
  const to = toKey.trim()
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return prev

  const fromIdx = findKeyIndexCaseInsensitive(prev, from)
  if (fromIdx < 0) {
    return findKeyIndexCaseInsensitive(prev, to) >= 0 ? prev : [...prev, to]
  }

  const next = prev.filter(key => (key ?? '').toLowerCase() !== to.toLowerCase())
  const idx = findKeyIndexCaseInsensitive(next, from)
  next[idx] = to
  return next
}

export function normalizeHeaderParams(
  requestHeaders: RequestParam[],
  headersStore: Record<string, string>,
  keyOrder: string[],
) {
  const spec = requestHeaders.filter(Boolean)
  const out: RequestParam[] = [...spec]
  for (const key of Object.keys(headersStore)) {
    if (spec.some(item => item.name === key)) continue
    out.push({ name: key, in: 'header', required: false })
  }

  const byLower = new Map<string, RequestParam>()
  for (const param of out) {
    const lower = (param.name ?? '').toLowerCase()
    if (!lower || byLower.has(lower)) continue
    byLower.set(lower, param)
  }

  const ordered: RequestParam[] = []
  const seen = new Set<string>()

  for (const key of keyOrder) {
    const lower = (key ?? '').toLowerCase()
    const param = byLower.get(lower)
    if (!param || seen.has(lower)) continue
    seen.add(lower)
    ordered.push(param)
  }

  for (const param of out) {
    const lower = (param.name ?? '').toLowerCase()
    if (!lower || seen.has(lower)) continue
    seen.add(lower)
    ordered.push(param)
  }

  return ordered
}
