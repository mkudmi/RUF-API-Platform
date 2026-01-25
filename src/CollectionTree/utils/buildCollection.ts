import type { Collection, Folder, HttpMethod, RequestItem, RequestParam } from '../types'
import { uid } from '../../shared/utils/id'
import { isAbsoluteUrl, joinUrlParts } from '../../shared/utils/url'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

function resolveServerUrl(server: any): string | undefined {
  const url = server?.url
  if (typeof url !== 'string' || !url.trim()) return undefined

  const vars = server?.variables && typeof server.variables === 'object' ? server.variables : undefined
  if (!vars) return url.trim()

  return url.trim().replaceAll(/\{([^}]+)\}/g, (_m: string, name: string) => {
    const v = (vars as any)[name]
    const def = v?.default
    if (typeof def === 'string') return def
    const enum0 = Array.isArray(v?.enum) ? v.enum[0] : undefined
    if (typeof enum0 === 'string') return enum0
    return `{${name}}`
  })
}

function pickSuggestedBaseUrl(spec: any, sourceOrigin?: string): string | undefined {
  const first = Array.isArray(spec?.servers) ? spec.servers[0] : undefined
  const resolved = resolveServerUrl(first)
  if (!resolved) return undefined

  if (isAbsoluteUrl(resolved)) return resolved.replace(/\/+$/, '')

  const rel = (resolved.startsWith('/') ? resolved : `/${resolved}`).replace(/\/+$/, '')
  if (sourceOrigin) return `${sourceOrigin.replace(/\/+$/, '')}${rel}`.replace(/\/+$/, '')
  return rel
}

function opDisplayName(method: string, path: string, op: any): string {
  return op?.summary || op?.operationId || `${method.toUpperCase()} ${path}`
}

function collectParams(op: any, pathItem?: any): RequestParam[] {
  const pathParams: any[] = Array.isArray(pathItem?.parameters) ? pathItem.parameters : []
  const opParams: any[] = Array.isArray(op?.parameters) ? op.parameters : []
  const merged = [...pathParams, ...opParams]

  const byKey = new Map<string, RequestParam>()
  for (const p of merged) {
    if (!p || (p.in !== 'path' && p.in !== 'query' && p.in !== 'header')) continue
    if (typeof p.name !== 'string' || !p.name.trim()) continue
    const key = `${p.in}:${p.name}`
    byKey.set(key, {
      name: p.name,
      in: p.in,
      required: !!p.required,
      schemaType: p.schema?.type || p.type,
      example: p.example ?? p.schema?.example,
    })
  }

  return Array.from(byKey.values())
}

function exampleFromSchema(schema: any, depth = 0): any {
  if (!schema || typeof schema !== 'object') return undefined
  if (depth > 6) return undefined

  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (schema.const !== undefined) return schema.const
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]

  const type = schema.type

  if (type === 'array' || schema.items) {
    const itemEx = exampleFromSchema(schema.items, depth + 1)
    return itemEx === undefined ? [] : [itemEx]
  }

  if (type === 'object' || schema.properties) {
    const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(props)) {
      const ex = exampleFromSchema(v, depth + 1)
      if (ex !== undefined) out[k] = ex
    }
    return out
  }

  if (type === 'integer' || type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'string') return ''

  return undefined
}

function buildBody(op: any) {
  const rb = op?.requestBody
  const content = rb?.content
  if (!content || typeof content !== 'object') return undefined

  function pickContentType(): string | undefined {
    const keys = Object.keys(content)
    if (!keys.length) return undefined
    if ((content as any)['application/json']) return 'application/json'
    const jsonLike = keys.find(k => k.toLowerCase().includes('json'))
    if (jsonLike) return jsonLike
    return keys[0]
  }

  const ct = pickContentType()
  if (!ct) return undefined

  const media = (content as any)[ct]
  const exFromExamples = media?.examples?.[Object.keys(media.examples || {})[0]]?.value
  const schemaEx = media?.schema?.example ?? media?.schema?.default
  const ex: any = media?.example ?? exFromExamples ?? schemaEx ?? exampleFromSchema(media?.schema)

  if (ex !== undefined) return { contentType: ct, example: ex }
  return { contentType: ct, example: ct.toLowerCase().includes('json') ? {} : '' }
}

export function buildCollectionFromV3(spec: any, name = 'Imported API', sourceOrigin?: string): Collection {
  const baseUrl = pickSuggestedBaseUrl(spec, sourceOrigin)

  const folderMap = new Map<string, Folder>()

  const paths = spec?.paths || {}
  for (const path of Object.keys(paths)) {
    const pathItem = paths[path]
    for (const m of Object.keys(pathItem)) {
      const method = m.toUpperCase() as HttpMethod
      if (!METHODS.includes(method)) continue

      const op = pathItem[m]
      const tags: string[] = Array.isArray(op?.tags) && op.tags.length ? op.tags : ['default']

      const req: RequestItem = {
        id: uid('req'),
        name: opDisplayName(method, path, op),
        method,
        path,
        urlTemplate: joinUrlParts('{{baseUrl}}', path),
        params: collectParams(op, pathItem),
        body: buildBody(op),
        headers: {},
}

      if (req.body?.contentType) {
        req.headers = { ...req.headers, 'Content-Type': req.body.contentType }
      }

      for (const tag of tags) {
        if (!folderMap.has(tag)) {
          folderMap.set(tag, { id: uid('folder'), name: tag, requests: [], folders: [] })
        }
        folderMap.get(tag)!.requests.push(req)
      }
    }
  }

  return {
    id: uid('col'),
    name,
    baseUrl,
    folders: Array.from(folderMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
  }
}
