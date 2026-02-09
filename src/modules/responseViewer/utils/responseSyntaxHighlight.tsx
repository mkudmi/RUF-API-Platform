import type { ReactNode } from 'react'

export function renderJsonLineSyntax(line: string): ReactNode[] {
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

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx]

    if (seg.kind === 'string') {
      let j = seg.end
      while (j < line.length && /\s/.test(line[j])) j += 1
      const isKey = j < line.length && line[j] === ':'
      out.push(
        <span key={`s:${seg.start}:${seg.end}`} className={isKey ? 'jsonKeyToken' : 'jsonStringToken'}>
          {seg.text}
        </span>,
      )
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

      if (idx > last) out.push(<span key={`t:${seg.start}:${last}`}>{chunk.slice(last, idx)}</span>)

      if (value === 'true' || value === 'false') {
        out.push(<span key={`b:${seg.start + idx}`} className="jsonBooleanToken">{value}</span>)
      } else if (value === 'null') {
        out.push(<span key={`u:${seg.start + idx}`} className="jsonNullToken">{value}</span>)
      } else if (value.length === 1 && '{}[],:'.includes(value)) {
        out.push(<span key={`p:${seg.start + idx}`} className="jsonPunctuationToken">{value}</span>)
      } else {
        out.push(<span key={`n:${seg.start + idx}`} className="jsonNumberToken">{value}</span>)
      }

      last = nextPos
      m = tokenRegex.exec(chunk)
    }

    if (last < chunk.length) out.push(<span key={`t:${seg.start}:${last}:end`}>{chunk.slice(last)}</span>)
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

export function renderXmlLineSyntax(line: string): ReactNode[] {
  const tagRegex = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[^>]+>/g
  const out: ReactNode[] = []
  let last = 0
  let idx = 0
  let m = tagRegex.exec(line)
  while (m) {
    if (m.index > last) {
      out.push(<span key={`x:t:${idx}`} className="xmlTextToken">{line.slice(last, m.index)}</span>)
      idx += 1
    }
    out.push(...renderXmlTagSyntax(m[0], `x:g:${idx}`))
    idx += 1
    last = m.index + m[0].length
    m = tagRegex.exec(line)
  }
  if (last < line.length) out.push(<span key="x:t:end" className="xmlTextToken">{line.slice(last)}</span>)
  if (!out.length) out.push(<span key="x:raw" className="xmlTextToken">{line}</span>)
  return out
}
