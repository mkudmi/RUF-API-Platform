import { parseDocument } from 'yaml'

export type BeautifyBodyFormat = 'json' | 'xml' | 'yaml' | 'text'

function prettyPrintXml(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const parser = new DOMParser()
  const doc = parser.parseFromString(input, 'application/xml')
  const errors = doc.getElementsByTagName('parsererror')
  if (errors?.length) throw new Error(errors[0]?.textContent?.trim() || 'Invalid XML')

  const serialized = new XMLSerializer().serializeToString(doc)
  const tokens = serialized
    .replace(/>\s*</g, '><')
    .replaceAll('<', '\n<')
    .replaceAll('>', '>\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)

  let indent = 0
  const lines: string[] = []
  for (const token of tokens) {
    if (/^<\/.+>$/.test(token)) indent = Math.max(0, indent - 1)
    lines.push(`${'  '.repeat(indent)}${token}`)
    if (/^<[^!?/][^>]*[^/]>$/.test(token)) indent++
  }
  return lines.join('\n')
}

export function beautifyBody(raw: string, format: BeautifyBodyFormat): string {
  const input = raw ?? ''
  if (!input.trim()) return ''

  switch (format) {
    case 'json': {
      const parsed = JSON.parse(input)
      return JSON.stringify(parsed, null, 2)
    }
    case 'yaml': {
      const doc = parseDocument(input)
      if (doc.errors.length) throw doc.errors[0]
      return doc.toString()
    }
    case 'xml': {
      return prettyPrintXml(input)
    }
    case 'text': {
      return input.replaceAll('\r\n', '\n')
    }
  }
}

