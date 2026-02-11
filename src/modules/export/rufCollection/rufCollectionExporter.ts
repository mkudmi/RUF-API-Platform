import type { Collection, Folder, RequestItem } from '../../collectionTree'
import type { Environment } from '../../../shared/types/environment'
import { uid } from '../../../shared/utils/id'
import { computeEffectiveBaseUrl, isAbsoluteUrl } from '../../../shared/utils/url'
import { isDbEnvKey } from '../../environment/utils/dbConnection'
import { logWarn } from '../../../shared/utils/logger'

function applySchemeIfHostLike(url: string, scheme: 'http' | 'https') {
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

function getHeaderCaseInsensitive(headers: Record<string, string>, name: string): string | undefined {
  const needle = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === needle) return v
  }
  return undefined
}

function setHeaderCaseInsensitive(headers: Record<string, string>, name: string, value: string) {
  const needle = name.toLowerCase()
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === needle) {
      headers[k] = value
      return
    }
  }
  headers[name] = value
}

function toPostmanPathParamSyntax(path: string) {
  return path.replaceAll(/\{([^}]+)\}/g, (_m: string, name: string) => `:${name}`)
}

function toPostmanUrlObject(req: RequestItem) {
  const raw = toPostmanPathParamSyntax((req.urlTemplate || '').trim() || '{{baseUrl}}/')
  const pathSegments = toPostmanPathParamSyntax((req.path || '').trim())
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)

  const query = (req.params ?? [])
    .filter(p => p?.in === 'query')
    .map(p => {
      const example = p?.example
      const value = typeof example === 'string' ? example : example == null ? '' : JSON.stringify(example)
      const disabled = value === ''
      return { key: p.name, value, disabled }
    })

  const variable = (req.params ?? [])
    .filter(p => p?.in === 'path')
    .map(p => {
      const example = p?.example
      const value = typeof example === 'string' ? example : example == null ? '' : JSON.stringify(example)
      return { key: p.name, value }
    })

  // Postman accepts partial Url objects; "raw" is the most important part for import.
  if (raw.startsWith('{{baseUrl}}')) {
    return {
      raw,
      host: ['{{baseUrl}}'],
      path: pathSegments,
      query,
      variable,
    }
  }

  if (isAbsoluteUrl(raw) && !raw.includes('{{')) {
    try {
      const u = new URL(raw)
      const host = u.hostname ? u.hostname.split('.').filter(Boolean) : []
      const port = u.port ? u.port : undefined
      const protocol = u.protocol ? u.protocol.replace(/:$/, '') : undefined
      const urlPath = (u.pathname || '').replace(/^\//, '').split('/').filter(Boolean)
      return {
        raw,
        protocol,
        host,
        port,
        path: urlPath,
        query,
        variable,
      }
    } catch (error) {
      logWarn('toPostmanUrlObject', 'Failed to parse absolute URL while building Postman URL object', { error, raw })
      // fall through
    }
  }

  return { raw, path: pathSegments, query, variable }
}

function toPostmanRequestItem(req: RequestItem, _environment?: Environment) {
  const headers: Record<string, string> = { ...(req.headers ?? {}) }
  const contentType = (req.body?.contentType || '').trim()
  if (req.body && contentType && !getHeaderCaseInsensitive(headers, 'Content-Type')) {
    setHeaderCaseInsensitive(headers, 'Content-Type', contentType)
  }

  const header = Object.entries(headers).map(([key, value]) => ({ key, value }))

  const body = (() => {
    if (!req.body) return undefined
    const ct = (req.body.contentType || '').trim().toLowerCase()
    const isJson = ct.includes('json')
    const example = req.body.example
    const raw =
      typeof example === 'string'
        ? example
        : example == null
          ? ''
          : JSON.stringify(example, null, 2)
    return isJson
      ? { mode: 'raw', raw, options: { raw: { language: 'json' } } }
      : { mode: 'raw', raw }
  })()

  return {
    name: req.name,
    request: {
      method: req.method,
      header,
      url: toPostmanUrlObject(req),
      ...(body ? { body } : {}),
    },
  }
}

function toPostmanFolder(folder: Folder, environment?: Environment) {
  const items: any[] = []
  for (const f of folder.folders ?? []) items.push(toPostmanFolder(f, environment))
  for (const r of folder.requests ?? []) items.push(toPostmanRequestItem(r, environment))
  return { name: folder.name, item: items }
}

export function buildPostmanCollectionFromRufCollection(args: {
  collection: Collection
  environment?: Environment
}) {
  const envVarsRaw = args.environment?.variables ?? {}
  const envVars = Object.fromEntries(Object.entries(envVarsRaw).filter(([k]) => !isDbEnvKey(k)))
  const envKey = args.environment?.baseUrlKey || 'baseUrl'
  const envBaseUrl = envVars[envKey] ?? ''
  const scheme = String(envVars.scheme || '').trim().toLowerCase() === 'https' ? 'https' : 'http'
  const effectiveBaseUrl = applySchemeIfHostLike(computeEffectiveBaseUrl(envBaseUrl, args.collection.baseUrl), scheme)

  const variables: Record<string, string> = {
    ...Object.fromEntries(Object.entries(args.collection.variables ?? {}).filter(([k]) => !isDbEnvKey(k))),
    ...envVars,
    scheme,
    baseUrl: effectiveBaseUrl,
  }

  const variable = Object.entries(variables)
    .filter(([k]) => k.trim())
    .map(([key, value]) => ({ key, value: value ?? '' }))

  const items: any[] = []
  for (const f of args.collection.folders ?? []) items.push(toPostmanFolder(f, args.environment))
  for (const r of args.collection.requests ?? []) items.push(toPostmanRequestItem(r, args.environment))

  return {
    info: {
      _postman_id: uid('postman'),
      name: args.collection.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
    variable,
    // Extra metadata for round-tripping back into RUF. Postman should ignore unknown keys.
    rufEnvironment: args.environment
      ? {
          baseUrlKey: args.environment.baseUrlKey,
          variables: envVars,
        }
      : undefined,
  }
}
