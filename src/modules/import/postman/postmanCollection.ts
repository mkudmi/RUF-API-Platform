import type { Collection, Folder, HttpMethod, RequestItem, RequestParam } from '../../collectionTree'
import { uid } from '../../../shared/utils/id'
import { isAbsoluteUrl } from '../../../shared/utils/url'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export function isPostmanCollection(doc: any): boolean {
  const schema = doc?.info?.schema
  if (typeof schema === 'string' && schema.includes('schema.getpostman.com/json/collection/')) return true
  if (doc?.info?._postman_id && Array.isArray(doc?.item)) return true
  return false
}

function parseVariables(vars: any): Record<string, string> | undefined {
  if (!Array.isArray(vars)) return undefined
  const out: Record<string, string> = {}
  for (const v of vars) {
    const key = typeof v?.key === 'string' ? v.key.trim() : ''
    if (!key) continue
    const value = typeof v?.value === 'string' ? v.value : ''
    out[key] = value
  }
  return Object.keys(out).length ? out : undefined
}

function normalizeName(value: any, fallback: string) {
  const n = typeof value === 'string' ? value.trim() : ''
  return n || fallback
}

function toHttpMethod(maybe: any): HttpMethod | null {
  const m = typeof maybe === 'string' ? maybe.trim().toUpperCase() : ''
  if (!m) return null
  if ((METHODS as string[]).includes(m)) return m as HttpMethod
  return null
}

function toHeaderMap(headers: any): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(headers)) return out
  for (const h of headers) {
    if (!h || typeof h !== 'object') continue
    if (h.disabled) continue
    const key = typeof h.key === 'string' ? h.key.trim() : ''
    if (!key) continue
    const value = typeof h.value === 'string' ? h.value : ''
    out[key] = value
  }
  return out
}

function getHeaderCaseInsensitive(headers: Record<string, string>, name: string): string | undefined {
  const needle = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === needle) return v
  }
  return undefined
}

function replaceColonPathParams(path: string) {
  return path.replaceAll(/\/:([A-Za-z0-9_]+)/g, '/{$1}')
}

function stripQuery(raw: string) {
  const i = raw.indexOf('?')
  return i >= 0 ? raw.slice(0, i) : raw
}

function extractPathFromRawUrl(raw: string): string {
  let s = raw.trim()
  if (!s) return '/'

  s = stripQuery(s)

  if (s.startsWith('{{')) {
    const end = s.indexOf('}}')
    if (end >= 0) {
      const after = s.slice(end + 2)
      if (after.startsWith('/')) s = after
    }
  }

  if (s.startsWith('/')) return s

  if (isAbsoluteUrl(s) && !s.includes('{{')) {
    try {
      const u = new URL(s)
      return u.pathname || '/'
    } catch {
      // fall through
    }
  }

  const idx = s.indexOf('://')
  if (idx >= 0) {
    const afterScheme = s.slice(idx + 3)
    const slash = afterScheme.indexOf('/')
    if (slash >= 0) return '/' + afterScheme.slice(slash + 1)
    return '/'
  }

  const firstSlash = s.indexOf('/')
  if (firstSlash >= 0) return s.slice(firstSlash)

  return '/'
}

function isNumericSegment(s: string) {
  return /^\d+$/.test(s)
}

function toCamelCase(s: string) {
  const parts = s.split(/[-_]+/g).filter(Boolean)
  if (!parts.length) return s
  return parts[0].toLowerCase() + parts.slice(1).map(p => (p ? p[0].toUpperCase() + p.slice(1) : '')).join('')
}

function suggestParamName(prevSegment: string | undefined, used: Set<string>) {
  const prev = (prevSegment || '').trim()
  let base = 'id'
  if (prev && /^[A-Za-z][A-Za-z0-9_-]*$/.test(prev)) {
    const singular = prev.endsWith('s') && prev.length > 1 ? prev.slice(0, -1) : prev
    base = `${toCamelCase(singular)}Id`
  }

  if (!used.has(base)) return base

  let i = 2
  while (used.has(`${base}${i}`)) i++
  return `${base}${i}`
}

function inferPathParamsFromConcreteSegments(path: string, params: RequestParam[]) {
  const segments = path.split('/').filter(Boolean)
  if (!segments.length) return { path, params }

  const used = new Set(params.filter(p => p.in === 'path').map(p => p.name))
  const outSegments = [...segments]
  const outParams = [...params]

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg) continue
    if (seg.startsWith('{') && seg.endsWith('}')) continue
    if (!isNumericSegment(seg)) continue

    const name = suggestParamName(segments[i - 1], used)
    used.add(name)
    outSegments[i] = `{${name}}`
    if (!outParams.some(p => p.in === 'path' && p.name === name)) {
      outParams.push({ name, in: 'path', required: true, example: seg })
    }
  }

  return { path: '/' + outSegments.join('/'), params: outParams }
}

function parseUrl(url: any): { path: string, params: RequestParam[] } {
  const params: RequestParam[] = []

  const raw =
    typeof url === 'string'
      ? url
      : typeof url?.raw === 'string'
        ? url.raw
        : ''

  let path = extractPathFromRawUrl(raw)
  if ((!path || path === '/') && raw.trim() === '' && Array.isArray(url?.path) && url.path.length) {
    const segments = url.path.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim())
    path = '/' + segments.join('/')
  }
  path = replaceColonPathParams(path)
  if (!path.startsWith('/')) path = `/${path}`

  const urlVars: any[] = Array.isArray(url?.variable) ? url.variable : []
  for (const v of urlVars) {
    if (!v || typeof v !== 'object') continue
    const name = typeof v.key === 'string' ? v.key.trim() : ''
    if (!name) continue
    if (params.some(p => p.in === 'path' && p.name === name)) continue
    params.push({ name, in: 'path', required: true, example: v.value })
  }

  const query: any[] = Array.isArray(url?.query) ? url.query : []
  for (const q of query) {
    if (!q || typeof q !== 'object') continue
    if (q.disabled) continue
    const name = typeof q.key === 'string' ? q.key.trim() : ''
    if (!name) continue
    if (params.some(p => p.in === 'query' && p.name === name)) continue
    const example = typeof q.value === 'string' ? q.value : undefined
    params.push({ name, in: 'query', example })
  }

  // ensure path params are represented even if they weren't listed in url.variable
  path.replaceAll(/\{([^}]+)\}/g, (_m: string, name: string) => {
    if (!params.some(p => p.in === 'path' && p.name === name)) {
      params.push({ name, in: 'path', required: true })
    }
    return _m
  })

  const inferred = inferPathParamsFromConcreteSegments(path, params)
  return { path: inferred.path, params: inferred.params }
}

function parseBody(body: any, headers: Record<string, string>) {
  if (!body || typeof body !== 'object') return undefined

  const mode = typeof body.mode === 'string' ? body.mode : ''
  const headerCt = (getHeaderCaseInsensitive(headers, 'Content-Type') || '').trim()

  if (mode === 'raw') {
    const raw = typeof body.raw === 'string' ? body.raw : ''
    const language = body?.options?.raw?.language
    const ct =
      headerCt ||
      (language === 'json' ? 'application/json' : 'text/plain')

    if (ct.toLowerCase().includes('json')) {
      try {
        const parsed = JSON.parse(raw)
        return { contentType: ct, example: parsed }
      } catch {
        return { contentType: ct, example: raw }
      }
    }

    return { contentType: ct, example: raw }
  }

  if (mode === 'formdata') {
    const fields: any[] = Array.isArray(body.formdata) ? body.formdata : []
    const exampleObj: Record<string, string> = {}
    for (const f of fields) {
      if (!f || typeof f !== 'object') continue
      if (f.disabled) continue
      if (f.type === 'file') continue
      const key = typeof f.key === 'string' ? f.key.trim() : ''
      if (!key) continue
      const value = typeof f.value === 'string' ? f.value : ''
      exampleObj[key] = value
    }
    return { contentType: headerCt || 'multipart/form-data', example: exampleObj }
  }

  if (mode === 'file') {
    return { contentType: headerCt || 'application/octet-stream', example: '' }
  }

  return undefined
}

function buildRequestFromItem(item: any): RequestItem | null {
  const req = item?.request
  if (!req || typeof req !== 'object') return null

  const method = toHttpMethod(req.method)
  if (!method) return null

  const name = normalizeName(item?.name, `${method}`)
  const descriptionRaw =
    typeof req?.description === 'string'
      ? req.description
      : typeof item?.description === 'string'
        ? item.description
        : ''
  const description = descriptionRaw.trim() || undefined

  const headers = toHeaderMap(req.header)
  const { path, params } = parseUrl(req.url)
  const body = parseBody(req.body, headers)

  const urlTemplate = `{{baseUrl}}${path.startsWith('/') ? '' : '/'}${path}`

  return {
    id: uid('req'),
    name,
    description,
    method,
    path,
    urlTemplate,
    params,
    headers,
    body,
  }
}

function buildFolderFromGroup(group: any): Folder {
  const name = normalizeName(group?.name, 'Folder')
  const children: any[] = Array.isArray(group?.item) ? group.item : []

  const folders: Folder[] = []
  const requests: RequestItem[] = []

  for (const child of children) {
    if (child && typeof child === 'object' && Array.isArray(child.item) && !child.request) {
      folders.push(buildFolderFromGroup(child))
      continue
    }
    const req = buildRequestFromItem(child)
    if (req) requests.push(req)
  }

  return {
    id: uid('folder'),
    name,
    requests,
    folders,
  }
}

export function buildCollectionFromPostman(postman: any, nameOverride?: string): Collection {
  const name = (nameOverride || normalizeName(postman?.info?.name, 'Imported Postman')).trim()
  const variables = parseVariables(postman?.variable)

  const topItems: any[] = Array.isArray(postman?.item) ? postman.item : []
  const folders: Folder[] = []
  const rootRequests: RequestItem[] = []

  for (const it of topItems) {
    if (it && typeof it === 'object' && Array.isArray(it.item) && !it.request) {
      folders.push(buildFolderFromGroup(it))
      continue
    }
    const req = buildRequestFromItem(it)
    if (req) rootRequests.push(req)
  }

  if (rootRequests.length) {
    folders.unshift({ id: uid('folder'), name: 'root', requests: rootRequests, folders: [] })
  }

  return {
    id: uid('col'),
    name,
    variables,
    folders,
  }
}
