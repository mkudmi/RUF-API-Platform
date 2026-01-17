import type { RequestItem } from '../../shared/types/collection'
import { isAbsoluteUrl, joinUrlParts } from '../../shared/utils/url'

export type RunResult = {
  ok: boolean
  status: number
  statusText: string
  timeMs: number
  headers: Record<string, string>
  bodyText: string
}

function maybeProxyUrl(url: string) {
  if (!import.meta.env.DEV) return url
  try {
    const u = new URL(url)
    if (typeof location !== 'undefined' && u.origin !== location.origin) {
      return `/__ruf_proxy?url=${encodeURIComponent(u.toString())}`
    }
  } catch {
    // ignore
  }
  return url
}

function applyVariables(text: string, vars: Record<string, string>) {
  return text.replaceAll(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m: string, name: string) => vars[name] ?? '')
}

function applyPathParams(url: string, values: Record<string,string>) {
  return url.replaceAll(/\{([^}]+)\}/g, (_, key) => encodeURIComponent(values[key] ?? `{${key}}`))
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const needle = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === needle) return v
  }
  return undefined
}

function setHeader(headers: Record<string, string>, name: string, value: string) {
  const needle = name.toLowerCase()
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === needle) {
      headers[k] = value
      return
    }
  }
  headers[name] = value
}

function deleteHeader(headers: Record<string, string>, name: string) {
  const needle = name.toLowerCase()
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === needle) delete headers[k]
  }
}

export async function runRequest(args: {
  request: RequestItem
  baseUrl: string
  urlTemplateOverride?: string
  variables?: Record<string, string>
  pathParams: Record<string,string>
  queryParams: Record<string,string>
  headers: Record<string,string>
  bodyText?: string
  file?: File | null
  fileFieldName?: string
  formFields?: Record<string, string>
}): Promise<RunResult> {
  const start = performance.now()
  const vars = args.variables ?? {}

  const baseUrl = (args.baseUrl || '').trim()
  const urlTemplateOverride = (args.urlTemplateOverride || '').trim()
  let url = ''
  if (urlTemplateOverride) {
    if (isAbsoluteUrl(urlTemplateOverride) || urlTemplateOverride.startsWith('//')) {
      url = urlTemplateOverride
    } else if (baseUrl) {
      url = joinUrlParts(baseUrl, urlTemplateOverride)
    } else {
      url = urlTemplateOverride
    }
  } else {
    url = baseUrl
      ? joinUrlParts(baseUrl, args.request.path)
      : args.request.urlTemplate.replace('{{baseUrl}}', '')
  }

  const pathParams = Object.fromEntries(
    Object.entries(args.pathParams).map(([k, v]) => [k, applyVariables(v, vars)]),
  )
  url = applyPathParams(url, pathParams)
  url = applyVariables(url, vars)

  const usp = new URLSearchParams()
  for (const [k,v] of Object.entries(args.queryParams)) {
    const nextV = applyVariables(v, vars)
    if (nextV !== '') usp.set(k, nextV)
  }
  const qs = usp.toString()
  if (qs) url += (url.includes('?') ? '&' : '?') + qs

  const init: RequestInit = {
    method: args.request.method,
    headers: Object.fromEntries(
      Object.entries(args.headers).map(([k, v]) => [k, applyVariables(v, vars)]),
    ),
  }

  if (args.request.body && args.request.method !== 'GET' && args.request.method !== 'HEAD') {
    const desiredCt = (getHeader(init.headers as any, 'Content-Type') || args.request.body.contentType || '').trim()
    const ct = desiredCt.toLowerCase()
    const file = args.file ?? null

    if (ct.includes('multipart/form-data') && (file || (args.formFields && Object.keys(args.formFields).length))) {
      const form = new FormData()
      for (const [k, v] of Object.entries(args.formFields ?? {})) form.set(k, applyVariables(v, vars))
      if (file) form.set(args.fileFieldName?.trim() || 'file', file)

      const headers = { ...(init.headers as any) } as Record<string, string>
      deleteHeader(headers, 'Content-Type')
      init.headers = headers as any
      init.body = form
    } else if (file && ct.includes('application/octet-stream')) {
      const headers = { ...(init.headers as any) } as Record<string, string>
      if (desiredCt) setHeader(headers, 'Content-Type', desiredCt)
      init.headers = headers as any
      init.body = file
    } else {
      const headers = { ...(init.headers as any) } as Record<string, string>
      if (desiredCt) setHeader(headers, 'Content-Type', desiredCt)
      init.headers = headers as any
      init.body = applyVariables(args.bodyText ?? '', vars)
    }
  }

  if (typeof init.body === 'string') init.body = applyVariables(init.body, vars)

  const finalUrl = maybeProxyUrl(url)
  let res: Response
  try {
    res = await fetch(finalUrl, init)
  } catch (e: any) {
    const timeMs = Math.round(performance.now() - start)
    return {
      ok: false,
      status: 0,
      statusText: 'Failed to fetch',
      timeMs,
      headers: {},
      bodyText: e?.message || String(e),
    }
  }
  const timeMs = Math.round(performance.now() - start)

  const headersObj: Record<string,string> = {}
  res.headers.forEach((v,k)=>headersObj[k]=v)

  const bodyText = await res.text()

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    timeMs,
    headers: headersObj,
    bodyText,
  }
}
