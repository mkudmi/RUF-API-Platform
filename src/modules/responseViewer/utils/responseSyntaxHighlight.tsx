import type { ReactNode } from 'react'
import type { JsonSearchHighlightPlan } from './jsonPathSearch'

function renderHighlightedText(text: string, keyPrefix: string, className: string | null, highlightTerms: string[]): ReactNode[] {
  if (!text) return []

  const terms = Array.from(new Set(
    highlightTerms
      .map(term => term.trim())
      .filter(Boolean),
  ))
    .sort((a, b) => b.length - a.length)

  if (!terms.length) {
    return [className ? <span key={keyPrefix} className={className}>{text}</span> : <span key={keyPrefix}>{text}</span>]
  }

  const lower = text.toLowerCase()
  const out: ReactNode[] = []
  let i = 0
  let part = 0

  while (i < text.length) {
    let found: string | null = null
    for (const term of terms) {
      if (lower.startsWith(term.toLowerCase(), i)) {
        found = text.slice(i, i + term.length)
        break
      }
    }

    if (!found) {
      let next = i + 1
      while (next < text.length) {
        const hasMatch = terms.some(term => lower.startsWith(term.toLowerCase(), next))
        if (hasMatch) break
        next += 1
      }
      const chunk = text.slice(i, next)
      out.push(className ? <span key={`${keyPrefix}:n:${part}`} className={className}>{chunk}</span> : <span key={`${keyPrefix}:n:${part}`}>{chunk}</span>)
      i = next
      part += 1
      continue
    }

    const cls = className ? `${className} searchMatchToken` : 'searchMatchToken'
    out.push(<span key={`${keyPrefix}:h:${part}`} className={cls}>{found}</span>)
    i += found.length
    part += 1
  }

  return out
}

function stripJsonQuotes(text: string) {
  const trimmed = text.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function renderJsonLineSyntax(
  line: string,
  highlightPlan: JsonSearchHighlightPlan = { keyTerms: [], valuesByKey: {}, standaloneTerms: [] },
): ReactNode[] {
  type Segment = { kind: 'text' | 'string', text: string, start: number, end: number }
  const segments: Segment[] = []
  let i = 0
  let textStart = 0

  while (i < line.length) {
    if (line[i] !== '"') {
      i += 1
      continue
    }

    if (textStart < i) {
      segments.push({ kind: 'text', text: line.slice(textStart, i), start: textStart, end: i })
    }

    const start = i
    i += 1
    let escaped = false
    while (i < line.length) {
      const ch = line[i]
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        i += 1
        break
      }
      i += 1
    }

    const end = i
    segments.push({ kind: 'string', text: line.slice(start, end), start, end })
    textStart = i
  }

  if (textStart < line.length) {
    segments.push({ kind: 'text', text: line.slice(textStart), start: textStart, end: line.length })
  }
  if (!segments.length) segments.push({ kind: 'text', text: line, start: 0, end: line.length })

  const out: ReactNode[] = []
  const tokenRegex = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}[\],:]/g
  let activeValueTerms: string[] = highlightPlan.standaloneTerms

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx]

    if (seg.kind === 'string') {
      let j = seg.end
      while (j < line.length && /\s/.test(line[j])) j += 1
      const isKey = j < line.length && line[j] === ':'
      if (isKey) {
        const rawKey = stripJsonQuotes(seg.text)
        activeValueTerms = highlightPlan.valuesByKey[rawKey] ?? highlightPlan.standaloneTerms
      }
      const stringHighlightTerms = isKey
        ? (highlightPlan.keyTerms.includes(stripJsonQuotes(seg.text)) ? [stripJsonQuotes(seg.text)] : [])
        : activeValueTerms
      out.push(...renderHighlightedText(seg.text, `s:${seg.start}:${seg.end}`, isKey ? 'jsonKeyToken' : 'jsonStringToken', stringHighlightTerms))
      continue
    }

    const chunk = seg.text
    let last = 0
    tokenRegex.lastIndex = 0
    let m = tokenRegex.exec(chunk)
    while (m) {
      const idx = m.index
      const value = m[0]
      const nextPos = idx + value.length

      if (idx > last) out.push(...renderHighlightedText(chunk.slice(last, idx), `t:${seg.start}:${last}`, null, activeValueTerms))

      if (value === 'true' || value === 'false') {
        out.push(...renderHighlightedText(value, `b:${seg.start + idx}`, 'jsonBooleanToken', activeValueTerms))
      } else if (value === 'null') {
        out.push(...renderHighlightedText(value, `u:${seg.start + idx}`, 'jsonNullToken', activeValueTerms))
      } else if (value.length === 1 && '{}[],:'.includes(value)) {
        out.push(...renderHighlightedText(value, `p:${seg.start + idx}`, 'jsonPunctuationToken', []))
      } else {
        out.push(...renderHighlightedText(value, `n:${seg.start + idx}`, 'jsonNumberToken', activeValueTerms))
      }

      last = nextPos
      m = tokenRegex.exec(chunk)
    }

    if (last < chunk.length) out.push(...renderHighlightedText(chunk.slice(last), `t:${seg.start}:${last}:end`, null, activeValueTerms))
  }

  return out
}

function renderXmlTagSyntax(tagText: string, keyPrefix: string): ReactNode[] {
  if (tagText.startsWith('<!--')) {
    return [<span key={`${keyPrefix}:comment`} className="xmlCommentToken">{tagText}</span>]
  }
  if (tagText.startsWith('<?')) {
    return [<span key={`${keyPrefix}:decl`} className="xmlDeclarationToken">{tagText}</span>]
  }
  if (tagText.startsWith('</')) {
    const nameMatch = tagText.match(/^<\/\s*([^\s>]+)/)
    if (!nameMatch) return [<span key={`${keyPrefix}:raw`} className="xmlTagBracketToken">{tagText}</span>]
    const name = nameMatch[1]
    const nameStart = tagText.indexOf(name)
    const nameEnd = nameStart + name.length
    return [
      <span key={`${keyPrefix}:open`} className="xmlTagBracketToken">{tagText.slice(0, nameStart)}</span>,
      <span key={`${keyPrefix}:name`} className="xmlTagNameToken">{name}</span>,
      <span key={`${keyPrefix}:close`} className="xmlTagBracketToken">{tagText.slice(nameEnd)}</span>,
    ]
  }

  const isSelfClosing = tagText.endsWith('/>')
  const closingToken = isSelfClosing ? '/>' : '>'
  const inner = tagText.slice(1, tagText.length - closingToken.length)
  const out: ReactNode[] = [<span key={`${keyPrefix}:lt`} className="xmlTagBracketToken">{'<'}</span>]

  const nameMatch = inner.match(/^\s*([^\s/>]+)/)
  if (!nameMatch) {
    out.push(<span key={`${keyPrefix}:fallback`} className="xmlTagBracketToken">{inner}</span>)
    out.push(<span key={`${keyPrefix}:gt`} className="xmlTagBracketToken">{closingToken}</span>)
    return out
  }

  const name = nameMatch[1]
  const nameStart = inner.indexOf(name)
  const afterNameIdx = nameStart + name.length
  const preName = inner.slice(0, nameStart)
  if (preName) out.push(<span key={`${keyPrefix}:pre`} className="xmlTagBracketToken">{preName}</span>)
  out.push(<span key={`${keyPrefix}:name`} className="xmlTagNameToken">{name}</span>)

  const attrsText = inner.slice(afterNameIdx)
  let i = 0
  let part = 0
  while (i < attrsText.length) {
    while (i < attrsText.length && /\s/.test(attrsText[i])) i += 1
    if (i >= attrsText.length) break

    const attrStart = i
    while (i < attrsText.length && !/[\s=]/.test(attrsText[i])) i += 1
    const attrName = attrsText.slice(attrStart, i)
    if (attrName) out.push(<span key={`${keyPrefix}:an:${part}`} className="xmlAttrNameToken">{attrName}</span>)

    while (i < attrsText.length && /\s/.test(attrsText[i])) i += 1
    if (i < attrsText.length && attrsText[i] === '=') {
      out.push(<span key={`${keyPrefix}:eq:${part}`} className="xmlTagBracketToken">=</span>)
      i += 1
      while (i < attrsText.length && /\s/.test(attrsText[i])) i += 1

      if (i < attrsText.length && (attrsText[i] === '"' || attrsText[i] === '\'')) {
        const quote = attrsText[i]
        const valueStart = i
        i += 1
        while (i < attrsText.length && attrsText[i] !== quote) i += 1
        if (i < attrsText.length) i += 1
        out.push(<span key={`${keyPrefix}:av:${part}`} className="xmlAttrValueToken">{attrsText.slice(valueStart, i)}</span>)
      } else {
        const valueStart = i
        while (i < attrsText.length && !/\s/.test(attrsText[i])) i += 1
        out.push(<span key={`${keyPrefix}:av:${part}`} className="xmlAttrValueToken">{attrsText.slice(valueStart, i)}</span>)
      }
    }

    part += 1
  }

  out.push(<span key={`${keyPrefix}:gt`} className="xmlTagBracketToken">{closingToken}</span>)
  return out
}

export function renderXmlLineSyntax(line: string, highlightTerms: string[] = []): ReactNode[] {
  const tagRegex = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[^>]+>/g
  const out: ReactNode[] = []
  let last = 0
  let idx = 0
  let m = tagRegex.exec(line)
  while (m) {
    if (m.index > last) {
      out.push(...renderHighlightedText(line.slice(last, m.index), `x:t:${idx}`, 'xmlTextToken', highlightTerms))
      idx += 1
    }
    out.push(...renderXmlTagSyntax(m[0], `x:g:${idx}`))
    idx += 1
    last = m.index + m[0].length
    m = tagRegex.exec(line)
  }
  if (last < line.length) out.push(...renderHighlightedText(line.slice(last), 'x:t:end', 'xmlTextToken', highlightTerms))
  if (!out.length) out.push(...renderHighlightedText(line, 'x:raw', 'xmlTextToken', highlightTerms))
  return out
}
