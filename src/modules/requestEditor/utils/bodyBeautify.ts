import { parseDocument } from 'yaml'
import { logWarn } from '../../../shared/utils/logger'

export type BeautifyBodyFormat = 'json' | 'xml' | 'yaml' | 'text'

function stripJsonCommentsAndNormalizeWhitespace(input: string) {
  let out = ''
  let inString = false
  let escaped = false
  let inLineComment = false
  let inBlockComment = false

  const normalizeOutsideStringWhitespace = (ch: string) => {
    // JSON allows only: space, tab, CR, LF as whitespace.
    // Replace common copied Unicode spaces with a normal space.
    if (ch === '\u00A0' || ch === '\u1680' || ch === '\u202F' || ch === '\u205F' || ch === '\u3000') return ' '
    if (ch >= '\u2000' && ch <= '\u200A') return ' '
    return ch
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    const next = input[i + 1] ?? ''

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false
        out += ch
      }
      continue
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i += 1
      }
      continue
    }

    if (inString) {
      out += ch
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"' && !inString) {
      inString = true
      out += ch
      continue
    }

    if (ch === '/' && next === '/') {
      inLineComment = true
      i += 1
      continue
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true
      i += 1
      continue
    }

    out += normalizeOutsideStringWhitespace(ch)
  }

  return out
}

function stripJsonTrailingCommas(input: string) {
  let out = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (inString) {
      out += ch
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      continue
    }

    if (ch === ',') {
      let j = i + 1
      while (j < input.length && /\s/.test(input[j])) j += 1
      const nextNonWs = input[j] ?? ''
      if (nextNonWs === '}' || nextNonWs === ']') continue
    }

    out += ch
  }

  return out
}

function parseJsonLenient(input: string) {
  try {
    return JSON.parse(input)
  } catch (error) {
    logWarn('parseJsonLenient', 'Strict JSON parse failed, retrying with lenient cleanup', { error })
    const noComments = stripJsonCommentsAndNormalizeWhitespace(input)
    const noTrailingCommas = stripJsonTrailingCommas(noComments)
    return JSON.parse(noTrailingCommas)
  }
}

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
      const parsed = parseJsonLenient(input)
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
