export function setFlagForKey(prev: Record<string, true>, keyRaw: string, active: boolean): Record<string, true> {
  const key = keyRaw.trim()
  if (!key) return prev

  if (active) {
    if (!(key in prev)) return prev
    const next = { ...prev }
    delete next[key]
    return next
  }

  if (key in prev) return prev
  return { ...prev, [key]: true }
}

export function renameFlagKey(prev: Record<string, true>, fromKey: string, toKey: string): Record<string, true> {
  const from = fromKey.trim()
  const to = toKey.trim()
  if (!from || !to || from === to) return prev
  if (!(from in prev)) return prev

  if (to in prev) {
    const next = { ...prev }
    delete next[from]
    return next
  }

  const next = { ...prev }
  delete next[from]
  next[to] = true
  return next
}

export function replaceKeyInOrder(prev: string[], fromKey: string, toKey: string): string[] {
  const from = fromKey.trim()
  const to = toKey.trim()
  if (!from || !to || from === to) return prev

  const fromIdx = prev.indexOf(from)
  if (fromIdx < 0) {
    return prev.includes(to) ? prev : [...prev, to]
  }

  const withoutTo = prev.filter(key => key !== to)
  const next = [...withoutTo]
  const idx = next.indexOf(from)
  next[idx] = to
  return next
}

export function renameStoreKey(
  prev: Record<string, string>,
  fromKey: string,
  toKey: string,
) {
  const from = fromKey.trim()
  const to = toKey.trim()
  if (!from || !to || to === from) return prev

  const value = prev[from]
  if (value === undefined) return prev
  if (Object.prototype.hasOwnProperty.call(prev, to)) return prev

  const next: Record<string, string> = { ...prev }
  delete next[from]
  next[to] = value
  return next
}
