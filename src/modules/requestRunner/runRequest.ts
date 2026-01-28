import type { RequestItem } from '../collectionTree'
import { isAbsoluteUrl, joinUrlParts } from '../../shared/utils/url'
import { loadAppSettings } from '../../shared/utils/appSettings'
import { resolveVariableValue } from '../../shared/utils/variables'

export type RunResult = {
  ok: boolean
  status: number
  statusText: string
  timeMs: number
  requestHeadersBytes: number
  requestBodyBytes: number
  requestBytes: number
  responseHeadersBytes: number
  responseBodyBytes: number
  responseBytes: number
  requestHeaders: Record<string, string>
  responseHeaders: Record<string, string>
  bodyText: string
}

function byteLengthUtf8(text: string): number {
  return new TextEncoder().encode(text).length
}

function estimateHeadersBytes(headers: HeadersInit | undefined): number {
  if (!headers) return 0
  if (Array.isArray(headers)) {
    let total = 0
    for (const [k, v] of headers) total += byteLengthUtf8(`${k}: ${v}\r\n`)
    return total
  }
  if (headers instanceof Headers) {
    let total = 0
    headers.forEach((v, k) => { total += byteLengthUtf8(`${k}: ${v}\r\n`) })
    return total
  }
  let total = 0
  for (const [k, v] of Object.entries(headers)) total += byteLengthUtf8(`${k}: ${v}\r\n`)
  return total
}

function headersInitToObject(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  if (headers instanceof Headers) {
    const out: Record<string, string> = {}
    headers.forEach((v, k) => { out[k] = v })
    return out
  }
  return { ...headers }
}

function estimateBodyBytes(body: BodyInit | null | undefined): number {
  if (!body) return 0
  if (typeof body === 'string') return byteLengthUtf8(body)
  if (body instanceof Blob) return body.size
  if (body instanceof ArrayBuffer) return body.byteLength
  if (ArrayBuffer.isView(body)) return body.byteLength
  if (body instanceof URLSearchParams) return byteLengthUtf8(body.toString())
  if (body instanceof FormData) {
    let total = 0
    for (const [k, v] of body.entries()) {
      total += byteLengthUtf8(k)
      if (typeof v === 'string') total += byteLengthUtf8(v)
      else total += v.size
    }
    return total
  }
  return 0
}

function maybeProxyUrl(url: string, opts: { insecureTls?: boolean }) {
  const insecureTls = !!opts.insecureTls
  try {
    const u = new URL(url)
    if (typeof location !== 'undefined' && u.origin !== location.origin) {
      if (!import.meta.env.DEV && !insecureTls) return url
      const qs = new URLSearchParams()
      qs.set('url', u.toString())
      if (insecureTls) qs.set('insecure', '1')
      return `/__ruf_proxy?${qs.toString()}`
    }
  } catch {
    // ignore
  }
  return url
}

function shouldValidateCertificates(): boolean {
  try {
    return loadAppSettings().validateCertificates
  } catch {
    return true
  }
}

function applyVariables(text: string, vars: Record<string, string>) {
  return text.replaceAll(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m: string, name: string) => resolveVariableValue(name, vars) ?? '')
}

function applyPathParams(url: string, values: Record<string,string>) {
  const hashIdx = url.indexOf('#')
  const beforeHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : ''

  const queryIdx = beforeHash.indexOf('?')
  const beforeQuery = queryIdx >= 0 ? beforeHash.slice(0, queryIdx) : beforeHash
  const query = queryIdx >= 0 ? beforeHash.slice(queryIdx) : ''

  let out = beforeQuery

  out = out.replaceAll(/\/\{([^}]+)\}/g, (m: string, key: string) => {
    const raw = values[key]
    if (raw === undefined) return ''
    if (raw.trim() === '') return ''
    return m
  })

  out = out.replaceAll(/\{([^}]+)\}/g, (_m: string, key: string) => {
    const raw = values[key]
    if (raw === undefined) return ''
    const v = raw.trim()
    if (!v) return ''
    return encodeURIComponent(v)
  })

  const schemeIdx = out.indexOf('://')
  let pathStart = out.length
  if (schemeIdx >= 0) {
    const firstSlashAfterHost = out.indexOf('/', schemeIdx + 3)
    pathStart = firstSlashAfterHost >= 0 ? firstSlashAfterHost : out.length
  } else if (out.startsWith('//')) {
    const firstSlashAfterHost = out.indexOf('/', 2)
    pathStart = firstSlashAfterHost >= 0 ? firstSlashAfterHost : out.length
  } else {
    const firstSlash = out.indexOf('/')
    pathStart = firstSlash >= 0 ? firstSlash : out.length
  }

  if (pathStart < out.length) {
    const prefix = out.slice(0, pathStart)
    let path = out.slice(pathStart)
    path = path.replaceAll(/\/{2,}/g, '/')
    out = prefix + path
  }

  return out + query + hash
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
  files?: Array<{ fieldName: string, file: File }>
  formFields?: Record<string, string>
}): Promise<RunResult> {
  const start = performance.now()
  const vars = args.variables ?? {}
  const validateCertificates = shouldValidateCertificates()

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

  const methodAllowsBody = args.request.method !== 'GET' && args.request.method !== 'HEAD'
  const hasExplicitBodyInput = !!(args.bodyText && args.bodyText.trim()) || !!args.file || !!(args.formFields && Object.keys(args.formFields).length)
  const wantsBody = !!args.request.body || hasExplicitBodyInput

  if (methodAllowsBody && wantsBody) {
    const desiredCt = (getHeader(init.headers as any, 'Content-Type') || args.request.body?.contentType || '').trim()
    const ct = desiredCt.toLowerCase()
    const file = args.file ?? null
    const files = (args.files ?? []).filter(x => x?.file instanceof File)

    const multipartFiles = files.length
      ? files
      : file
        ? [{ fieldName: args.fileFieldName?.trim() || 'file', file }]
        : []

    if (ct.includes('multipart/form-data') && (multipartFiles.length || (args.formFields && Object.keys(args.formFields).length))) {
      const form = new FormData()
      for (const [k, v] of Object.entries(args.formFields ?? {})) form.set(k, applyVariables(v, vars))
      for (const { fieldName, file } of multipartFiles) {
        form.append(fieldName?.trim() || 'file', file)
      }

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

  const finalUrl = maybeProxyUrl(url, { insecureTls: !validateCertificates })
  const requestHeadersObj = headersInitToObject(init.headers)
  const requestHeadersBytes = estimateHeadersBytes(init.headers)
  const requestBodyBytes = estimateBodyBytes(init.body)
  const requestBytes = requestHeadersBytes + requestBodyBytes
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
      requestHeadersBytes,
      requestBodyBytes,
      requestBytes,
      responseHeadersBytes: 0,
      responseBodyBytes: 0,
      responseBytes: 0,
      requestHeaders: requestHeadersObj,
      responseHeaders: {},
      bodyText: e?.message || String(e),
    }
  }
  const timeMs = Math.round(performance.now() - start)

  const headersObj: Record<string,string> = {}
  res.headers.forEach((v,k)=>headersObj[k]=v)

  const bodyText = await res.text()
  const responseHeadersBytes = estimateHeadersBytes(headersObj)
  const responseBodyBytes = byteLengthUtf8(bodyText)
  const responseBytes = responseHeadersBytes + responseBodyBytes

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    timeMs,
    requestHeadersBytes,
    requestBodyBytes,
    requestBytes,
    responseHeadersBytes,
    responseBodyBytes,
    responseBytes,
    requestHeaders: requestHeadersObj,
    responseHeaders: headersObj,
    bodyText,
  }
}
