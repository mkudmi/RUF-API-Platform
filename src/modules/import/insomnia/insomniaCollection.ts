import type { Collection, Folder, HttpMethod, RequestItem, RequestParam } from '../../collectionTree'
import { uid } from '../../../shared/utils/id'
import { isAbsoluteUrl } from '../../../shared/utils/url'
import { logWarn } from '../../../shared/utils/logger'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

type InsomniaHeader = { name?: unknown, value?: unknown, disabled?: unknown }
type InsomniaParameter = { name?: unknown, value?: unknown, disabled?: unknown }

type InsomniaRequestNode = {
  url?: unknown
  name?: unknown
  method?: unknown
  body?: unknown
  headers?: unknown
  parameters?: unknown
}

type InsomniaFolderNode = {
  name?: unknown
  children?: unknown
}

type InsomniaExportV5 = {
  type?: unknown
  name?: unknown
  collection?: unknown
  environments?: unknown
}

export function isInsomniaExport(doc: any): boolean {
  const type = typeof doc?.type === 'string' ? doc.type : ''
  if (type.startsWith('collection.insomnia.rest/')) return true

  // legacy Insomnia export format
  if (Array.isArray(doc?.resources) && doc.resources.some((r: any) => r?._type === 'request' || r?._type === 'request_group')) {
    return true
  }

  return false
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
  for (const h of headers as InsomniaHeader[]) {
    if (!h || typeof h !== 'object') continue
    if ((h as any).disabled) continue
    const key = typeof h.name === 'string' ? h.name.trim() : ''
    if (!key) continue
    const value = typeof h.value === 'string' ? h.value : ''
    out[key] = value
  }
  return out
}

function stripQueryAndHash(raw: string) {
  const hashIdx = raw.indexOf('#')
  const beforeHash = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw
  const qIdx = beforeHash.indexOf('?')
  return qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash
}

function extractPathFromInsomniaUrl(rawUrl: string) {
  let s = rawUrl.trim()
  if (!s) return '/'

  s = stripQueryAndHash(s)

  // {{baseUrl}}/path
  const m = s.match(/^\{\{\s*baseUrl\s*\}\}(.*)$/)
  if (m) {
    const after = (m[1] || '').trim()
    const out = after.startsWith('/') ? after : after ? `/${after}` : '/'
    return out || '/'
  }

  if (s.startsWith('/')) return s

  if (isAbsoluteUrl(s) && !s.includes('{{')) {
    try {
      const u = new URL(s)
      return u.pathname || '/'
    } catch (error) {
      logWarn('extractPathFromInsomniaUrl', 'Failed to parse absolute URL while extracting path', { error, raw: s })
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

function parseQueryParams(params: any): RequestParam[] {
  if (!Array.isArray(params)) return []

  const out: RequestParam[] = []
  for (const p of params as InsomniaParameter[]) {
    if (!p || typeof p !== 'object') continue
    const name = typeof p.name === 'string' ? p.name.trim() : ''
    if (!name) continue
    const value = typeof p.value === 'string' ? p.value : ''
    out.push({ name, in: 'query', example: value })
  }
  return out
}

function parseBody(body: any) {
  if (!body || typeof body !== 'object') return undefined
  const mimeType = typeof (body as any).mimeType === 'string' ? (body as any).mimeType.trim() : ''
  const text = typeof (body as any).text === 'string' ? (body as any).text : ''
  if (!mimeType && !text) return undefined
  return { contentType: mimeType || 'text/plain', example: text }
}

function buildRequestFromNode(node: InsomniaRequestNode): RequestItem | null {
  const method = toHttpMethod(node.method)
  if (!method) return null

  const rawUrl = typeof node.url === 'string' ? node.url.trim() : ''
  const urlTemplate = rawUrl || '{{baseUrl}}/'

  const name = normalizeName(node.name, `${method}`)
  const descriptionRaw = typeof (node as any)?.description === 'string' ? (node as any).description : ''
  const description = descriptionRaw.trim() || undefined
  const headers = toHeaderMap(node.headers)
  const body = parseBody(node.body)

  const params = parseQueryParams(node.parameters)
  const path = extractPathFromInsomniaUrl(urlTemplate)

  const out: RequestItem = {
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

  if (out.body?.contentType) {
    const hasCt = Object.keys(out.headers).some(k => k.toLowerCase() === 'content-type')
    if (!hasCt) out.headers = { ...out.headers, 'Content-Type': out.body.contentType }
  }

  // ensure path params are represented
  out.path.replaceAll(/\{([^}]+)\}/g, (_m: string, name: string) => {
    if (!out.params.some(p => p.in === 'path' && p.name === name)) {
      out.params.push({ name, in: 'path', required: true })
    }
    return _m
  })

  return out
}

function buildFolderFromNode(node: InsomniaFolderNode): Folder {
  const name = normalizeName(node.name, 'Folder')
  const children: any[] = Array.isArray(node.children) ? (node.children as any[]) : []

  const folders: Folder[] = []
  const requests: RequestItem[] = []

  for (const child of children) {
    if (!child || typeof child !== 'object') continue

    if (Array.isArray((child as any).children)) {
      folders.push(buildFolderFromNode(child as any))
      continue
    }

    const req = buildRequestFromNode(child as any)
    if (req) requests.push(req)
  }

  return { id: uid('folder'), name, requests, folders }
}

function parseVariablesFromV5(doc: InsomniaExportV5): Record<string, string> | undefined {
  const env = doc.environments
  const data = env && typeof env === 'object' ? (env as any).data : undefined
  if (!data || typeof data !== 'object') return undefined

  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data)) {
    const key = k.trim()
    if (!key) continue
    out[key] = typeof v === 'string' ? v : JSON.stringify(v)
  }
  return Object.keys(out).length ? out : undefined
}

export function buildCollectionFromInsomnia(doc: any, nameOverride?: string): Collection {
  const name = (nameOverride || normalizeName(doc?.name, 'Imported Insomnia')).trim()

  // Insomnia v5 export: nested `collection` tree
  if (Array.isArray(doc?.collection)) {
    const folders: Folder[] = []
    const rootRequests: RequestItem[] = []

    const collectionNodes = doc.collection as any[]
    let topNodes: any[] = collectionNodes

    // Common Insomnia v5 export shape: a single root folder that duplicates the collection name.
    // Unwrap it to avoid "folder inside same-named folder".
    if (collectionNodes.length === 1) {
      const only = collectionNodes[0]
      if (only && typeof only === 'object' && Array.isArray((only as any).children)) {
        const onlyName = normalizeName((only as any).name, '')
        const docName = normalizeName(doc?.name, '')
        if (onlyName && (onlyName === name || onlyName === docName)) {
          topNodes = (only as any).children as any[]
        }
      }
    }

    for (const node of topNodes) {
      if (!node || typeof node !== 'object') continue
      if (Array.isArray((node as any).children)) {
        folders.push(buildFolderFromNode(node as any))
        continue
      }
      const req = buildRequestFromNode(node as any)
      if (req) rootRequests.push(req)
    }

    if (rootRequests.length) {
      folders.unshift({ id: uid('folder'), name: 'root', requests: rootRequests, folders: [] })
    }

    return {
      id: uid('col'),
      name,
      variables: parseVariablesFromV5(doc),
      folders,
    }
  }

  // Legacy export format not implemented (yet)
  throw new Error('Unsupported Insomnia export format (expected a v5 collection file).')
}
