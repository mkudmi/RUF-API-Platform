export type ClipboardParamEntry = {
  name: string
  value: string
}

export function formatParamsForClipboard(entries: ClipboardParamEntry[]) {
  return entries
    .map(({ name, value }) => `${name}: ${value}`)
    .join('\n')
}

export function parseParamsFromClipboard(raw: string): ClipboardParamEntry[] {
  const normalized = raw.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return []

  const parts = (normalized.includes('\n')
    ? normalized.split('\n')
    : normalized.split(/,\s*(?=[^,\n:=]+\s*[:=]\s*)/))
    .map(part => part.trim())
    .filter(Boolean)

  const entries: ClipboardParamEntry[] = []

  for (const part of parts) {
    const delimiterMatch = part.match(/[:=]/)
    if (!delimiterMatch || delimiterMatch.index === undefined) continue

    const delimiterIndex = delimiterMatch.index

    const name = part.slice(0, delimiterIndex).trim()
    if (!name) continue

    const value = part.slice(delimiterIndex + 1).trim()
    entries.push({ name, value })
  }

  return entries
}
