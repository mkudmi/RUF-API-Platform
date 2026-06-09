import { isAbsoluteUrl } from '../../../shared/utils/url'
import { resolveVariableValue } from '../../../shared/utils/variables'

export function shouldDefaultOpenFileTab(method: string, contentType: string | undefined): boolean {
  if (method === 'GET' || method === 'HEAD') return false
  const ct = (contentType || '').toLowerCase()
  return ct.includes('multipart/form-data') || ct.includes('application/octet-stream')
}

export function applyPathParamsForDisplay(url: string, values: Record<string, string>) {
  let out = ''
  for (let i = 0; i < url.length; i++) {
    const ch = url[i]
    if (ch !== '{') {
      out += ch
      continue
    }

    const next = url[i + 1] ?? ''
    if (next === '{') {
      const close = url.indexOf('}}', i + 2)
      if (close >= 0) {
        out += url.slice(i, close + 2)
        i = close + 1
        continue
      }
      out += ch
      continue
    }

    const close = url.indexOf('}', i + 1)
    if (close < 0) {
      out += ch
      continue
    }

    const key = url.slice(i + 1, close).trim()
    i = close

    const value = (values[key] ?? '').trim()
    out += value ? value : `{${key}}`
  }

  return out
}

export function applyVariablesForDisplay(text: string, vars: Record<string, string>) {
  return text.replaceAll(/\{\{\s*([^}\s]+)\s*\}\}/g, (_match: string, name: string) => resolveVariableValue(name, vars) ?? '')
}

export function extractPathParamNamesFromTemplate(template: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (let i = 0; i < template.length; i++) {
    const ch = template[i]
    if (ch !== '{') continue

    const next = template[i + 1] ?? ''
    if (next === '{') {
      const close = template.indexOf('}}', i + 2)
      if (close >= 0) i = close + 1
      continue
    }

    const close = template.indexOf('}', i + 1)
    if (close < 0) continue
    if (template[close + 1] === '}') continue

    const name = template.slice(i + 1, close).trim()
    i = close

    if (!name) continue
    if (name.includes('{') || name.includes('}')) continue
    if (name.includes('/') || name.includes('?') || name.includes('#')) continue
    if (seen.has(name)) continue

    seen.add(name)
    out.push(name)
  }

  return out
}

export function applySchemeIfHostLike(url: string, scheme: 'http' | 'https') {
  const raw = url.trim().replace(/\/+$/, '')
  if (!raw) return ''
  if (isAbsoluteUrl(raw) || raw.startsWith('/') || raw.startsWith('//')) return raw

  const looksLikeHost =
    /^localhost(?::\d+)?(?:\/.*)?$/i.test(raw) ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/.*)?$/.test(raw) ||
    /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(raw)

  if (!looksLikeHost) return raw
  return `${scheme}://${raw}`.replace(/\/+$/, '')
}

export function parseUrlInput(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return { template: '', hasQuery: false, query: {} as Record<string, string> }

  const hashIdx = trimmed.indexOf('#')
  const withoutHash = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed
  const queryIdx = withoutHash.indexOf('?')

  const template = (queryIdx >= 0 ? withoutHash.slice(0, queryIdx) : withoutHash).trim()
  const qs = queryIdx >= 0 ? withoutHash.slice(queryIdx + 1) : ''
  if (!qs) return { template, hasQuery: false, query: {} as Record<string, string> }

  const searchParams = new URLSearchParams(qs)
  const query: Record<string, string> = {}
  searchParams.forEach((value, key) => {
    query[key] = value
  })

  return { template, hasQuery: true, query }
}

export function normalizeMockRoutePath(pathRaw: string): string {
  const cleaned = (pathRaw || '').trim()
    .replaceAll(/%7B/ig, '{')
    .replaceAll(/%7D/ig, '}')
  if (!cleaned) return '/'

  const withLeadingSlash = cleaned.startsWith('/') ? cleaned : `/${cleaned}`
  const withoutPathPlaceholders = withLeadingSlash.replaceAll(/\/\{[^/{}]+\}(?=\/|$)/g, '/')
  return withoutPathPlaceholders || '/'
}
