import type { RequestItem } from '../collectionTree'
import { isAbsoluteUrl, joinUrlParts } from '../../shared/utils/url'
import { getClientTlsFetchOptions, loadAppSettings } from '../../shared/utils/appSettings'
import { resolveVariableValue } from '../../shared/utils/variables'
import { platformFetch } from '../../shared/utils/platformFetch'
import { logWarn } from '../../shared/utils/logger'

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
  file?: RunResultFile
  testResults?: RunTestResult[]
}

export type RunResultFile = {
  fileName: string
  contentType: string
  size: number
  blob: Blob
  suppressBody: boolean
}

export type RunTestResult = {
  name: string
  source: 'global' | 'request'
  passed: boolean
  message: string
  expected?: unknown
  actual?: unknown
  error?: string
  durationMs: number
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

function shouldValidateCertificates(): boolean {
  try {
    return loadAppSettings().validateCertificates
  } catch (error) {
    logWarn('shouldValidateCertificates', 'Failed to read validateCertificates from settings', { error })
    return true
  }
}

function getCaCertsPem(): string[] {
  try {
    return (loadAppSettings().caCertificates || []).map(c => c.pem).filter(Boolean)
  } catch (error) {
    logWarn('getCaCertsPem', 'Failed to read CA certificates from settings', { error })
    return []
  }
}

function getClientTlsIdentity(): { clientPkcs12Base64?: string; clientPkcs12Password?: string } {
  try {
    return getClientTlsFetchOptions(loadAppSettings())
  } catch (error) {
    logWarn('getClientTlsIdentity', 'Failed to read client TLS identity from settings', { error })
    return {}
  }
}

function getRequestTimeoutMs(): number {
  try {
    const settings = loadAppSettings()
    if (settings.disableRequestTimeout) return 0
    const secRaw = settings.requestTimeoutSec
    const sec = Number.isFinite(secRaw) ? Math.round(secRaw) : 300
    if (sec <= 0) return 300
    return Math.max(1000, Math.min(600_000, sec * 1000))
  } catch (error) {
    logWarn('getRequestTimeoutMs', 'Failed to read request timeout from settings', { error })
    return 300_000
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

function getHeaderFromEntries(headers: [string, string][], name: string): string | undefined {
  const needle = name.toLowerCase()
  for (const [k, v] of headers) {
    if (k.toLowerCase() === needle) return v
  }
  return undefined
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const needle = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === needle) return v
  }
  return undefined
}

function sanitizeDownloadFileName(name: string): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return 'download'

  let withoutControl = ''
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i)
    if (code < 32 || code === 127) continue
    withoutControl += trimmed[i]
  }

  const withoutSlashes = withoutControl.replaceAll(/[\\/]/g, '_')
  const collapsed = withoutSlashes.replaceAll(/\s+/g, ' ').trim()
  return collapsed || 'download'
}

function parseContentDispositionFileName(contentDisposition: string | undefined): string | null {
  const raw = (contentDisposition || '').trim()
  if (!raw) return null

  // RFC 5987: filename*=UTF-8''...
  const filenameStarMatch = /(?:^|;)\s*filename\*\s*=\s*([^;]+)/i.exec(raw)
  if (filenameStarMatch) {
    const v = filenameStarMatch[1].trim().replaceAll(/^"(.*)"$/g, '$1')
    const parts = v.split("''")
    if (parts.length >= 2) {
      const encoded = parts.slice(1).join("''")
      try {
        return decodeURIComponent(encoded)
      } catch (error) {
        logWarn('parseContentDispositionFileName', 'Failed to decode RFC5987 filename* value', { error })
        return encoded
      }
    }
    return v
  }

  const filenameMatch = /(?:^|;)\s*filename\s*=\s*([^;]+)/i.exec(raw)
  if (filenameMatch) return filenameMatch[1].trim().replaceAll(/^"(.*)"$/g, '$1')
  return null
}

function isTextLikeContentType(contentType: string): boolean {
  const ct = (contentType || '').trim().toLowerCase()
  if (!ct) return true
  if (ct.startsWith('text/')) return true
  if (ct.includes('json')) return true
  if (ct.includes('xml')) return true
  if (ct.includes('yaml') || ct.includes('yml')) return true
  if (ct.includes('csv')) return true
  if (ct.includes('html')) return true
  if (ct.includes('javascript')) return true
  if (ct.includes('x-www-form-urlencoded')) return true
  return false
}

function inferFileExtensionFromContentType(contentType: string): string | null {
  const ct = (contentType || '').trim().toLowerCase()
  if (!ct) return null
  if (ct.includes('pdf')) return '.pdf'
  if (ct.includes('zip')) return '.zip'
  if (ct.includes('gzip')) return '.gz'
  if (ct.includes('json')) return '.json'
  if (ct.includes('csv')) return '.csv'
  if (ct.includes('png')) return '.png'
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg'
  if (ct.includes('gif')) return '.gif'
  if (ct.includes('webp')) return '.webp'
  if (ct.includes('octet-stream')) return '.bin'
  return null
}

function inferFileNameFromUrl(url: string, contentType: string): string {
  try {
    const base = (typeof location !== 'undefined' && location?.href) ? location.href : 'http://localhost/'
    const u = new URL(url, base)
    const parts = u.pathname.split('/').filter(Boolean)
    const last = parts[parts.length - 1] || ''
    const decoded = last ? decodeURIComponent(last) : ''
    if (decoded && decoded !== '/' && decoded !== '.') return decoded
  } catch (error) {
    logWarn('inferFileNameFromUrl', 'Failed to infer file name from URL', { error, url })
  }

  const ext = inferFileExtensionFromContentType(contentType)
  return ext ? `download${ext}` : 'download'
}

function setHeaderEntry(headers: [string, string][], name: string, value: string) {
  const needle = name.toLowerCase()
  for (let i = 0; i < headers.length; i++) {
    if (headers[i][0].toLowerCase() === needle) {
      headers[i] = [headers[i][0], value]
      return
    }
  }
  headers.push([name, value])
}

function deleteHeaderEntries(headers: [string, string][], name: string) {
  const needle = name.toLowerCase()
  for (let i = headers.length - 1; i >= 0; i--) {
    if (headers[i][0].toLowerCase() === needle) headers.splice(i, 1)
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
  headerEntries?: Array<[string, string]>
  bodyText?: string
  file?: File | null
  fileFieldName?: string
  files?: Array<{ fieldName: string, file: File }>
  emptyFileFieldNames?: string[]
  formFields?: Record<string, string>
  signal?: AbortSignal
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

  const headerEntries = args.headerEntries
    ? args.headerEntries.map(([k, v]) => [k, applyVariables(v, vars)] as [string, string])
    : Object.entries(args.headers).map(([k, v]) => [k, applyVariables(v, vars)] as [string, string])

  const init: RequestInit = {
    method: args.request.method,
    headers: headerEntries,
    signal: args.signal,
  }

  const methodAllowsBody = args.request.method !== 'GET' && args.request.method !== 'HEAD'
  const hasExplicitBodyInput = !!(args.bodyText && args.bodyText.trim()) || !!args.file || !!(args.formFields && Object.keys(args.formFields).length)
  const wantsBody = !!args.request.body || hasExplicitBodyInput

  if (methodAllowsBody && wantsBody) {
    const desiredCt = (getHeaderFromEntries(headerEntries, 'Content-Type') || args.request.body?.contentType || '').trim()
    const ct = desiredCt.toLowerCase()
    const file = args.file ?? null
    const files = (args.files ?? []).filter(x => x?.file instanceof File)
    const emptyFileFieldNames = (args.emptyFileFieldNames ?? []).map(x => x.trim()).filter(Boolean)

    const multipartFiles = files.length
      ? files
      : file
        ? [{ fieldName: args.fileFieldName?.trim() || 'file', file }]
        : []

    if (ct.includes('multipart/form-data') && (multipartFiles.length || emptyFileFieldNames.length || (args.formFields && Object.keys(args.formFields).length))) {
      const form = new FormData()
      for (const [k, v] of Object.entries(args.formFields ?? {})) form.set(k, applyVariables(v, vars))
      for (const fieldName of emptyFileFieldNames) form.append(fieldName, '')
      for (const { fieldName, file } of multipartFiles) {
        form.append(fieldName?.trim() || 'file', file)
      }

      deleteHeaderEntries(headerEntries, 'Content-Type')
      init.headers = headerEntries
      init.body = form
    } else if (file) {
      if (desiredCt) setHeaderEntry(headerEntries, 'Content-Type', desiredCt)
      else if (file.type) setHeaderEntry(headerEntries, 'Content-Type', file.type)
      else setHeaderEntry(headerEntries, 'Content-Type', 'application/octet-stream')
      init.headers = headerEntries
      init.body = file
    } else {
      if (desiredCt) setHeaderEntry(headerEntries, 'Content-Type', desiredCt)
      init.headers = headerEntries
      init.body = applyVariables(args.bodyText ?? '', vars)
    }
  }

  if (typeof init.body === 'string') init.body = applyVariables(init.body, vars)

  const caCertsPem = getCaCertsPem()
  const clientTlsIdentity = getClientTlsIdentity()
  const timeoutMs = getRequestTimeoutMs()
  const requestHeadersObj = headersInitToObject(init.headers)
  const requestHeadersBytes = estimateHeadersBytes(init.headers)
  const requestBodyBytes = estimateBodyBytes(init.body)
  const requestBytes = requestHeadersBytes + requestBodyBytes
  let res: Response
  try {
    res = await platformFetch(url, init, {
      insecureTls: !validateCertificates,
      caCertsPem,
      timeoutMs,
      ...clientTlsIdentity,
    })
  } catch (e: any) {
    const timeMs = Math.round(performance.now() - start)
    if (e?.name === 'AbortError') {
      return {
        ok: false,
        status: 0,
        statusText: 'Canceled',
        timeMs,
        requestHeadersBytes,
        requestBodyBytes,
        requestBytes,
        responseHeadersBytes: 0,
        responseBodyBytes: 0,
        responseBytes: 0,
        requestHeaders: requestHeadersObj,
        responseHeaders: {},
        bodyText: 'Request was canceled.',
      }
    }
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

  const responseHeadersBytes = estimateHeadersBytes(headersObj)

  const contentType = getHeader(headersObj, 'Content-Type') || ''
  const contentDisposition = getHeader(headersObj, 'Content-Disposition') || ''
  const fileNameFromDisposition = parseContentDispositionFileName(contentDisposition)
  const isAttachment = /\battachment\b/i.test(contentDisposition) || !!fileNameFromDisposition
  const isTextLike = isTextLikeContentType(contentType)
  const shouldTreatAsFile = isAttachment || (!isTextLike && !!contentType)

  let bodyText = ''
  let file: RunResultFile | undefined
  let responseBodyBytes = 0

  if (shouldTreatAsFile) {
    const inferred = inferFileNameFromUrl(url, contentType)
    const fileName = sanitizeDownloadFileName(fileNameFromDisposition || inferred)

    if (isTextLike) {
      bodyText = await res.text()
      const blob = new Blob([bodyText], { type: contentType || 'text/plain' })
      file = {
        fileName,
        contentType: contentType || blob.type || 'application/octet-stream',
        size: blob.size,
        blob,
        suppressBody: false,
      }
      responseBodyBytes = byteLengthUtf8(bodyText)
    } else {
      const blob = await res.blob()
      file = {
        fileName,
        contentType: blob.type || contentType || 'application/octet-stream',
        size: blob.size,
        blob,
        suppressBody: true,
      }
      bodyText = ''
      responseBodyBytes = blob.size
    }
  } else {
    bodyText = await res.text()
    responseBodyBytes = byteLengthUtf8(bodyText)
  }

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
    file,
  }
}
