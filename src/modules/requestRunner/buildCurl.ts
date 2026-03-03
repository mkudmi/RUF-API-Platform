import type { RequestItem } from '../collectionTree'
import { isAbsoluteUrl, joinUrlParts } from '../../shared/utils/url'
import { loadAppSettings } from '../../shared/utils/appSettings'
import { resolveVariableValue } from '../../shared/utils/variables'
import { logWarn } from '../../shared/utils/logger'

function applyVariables(text: string, vars: Record<string, string>) {
  return text.replaceAll(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m: string, name: string) => resolveVariableValue(name, vars) ?? '')
}

function applyPathParams(url: string, values: Record<string, string>) {
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

function bashQuote(value: string): string {
  return `'${value.replaceAll(`'`, `'\\''`)}'`
}

function compareHeaderKeys(a: string, b: string) {
  const al = a.toLowerCase()
  const bl = b.toLowerCase()
  if (al < bl) return -1
  if (al > bl) return 1
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export function buildCurlCommand(args: {
  request: RequestItem
  baseUrl: string
  urlTemplateOverride?: string
  variables?: Record<string, string>
  pathParams: Record<string, string>
  queryParams: Record<string, string>
  headers: Record<string, string>
  bodyText?: string
  file?: File | null
  fileFieldName?: string
  files?: Array<{ fieldName: string, file: File }>
  emptyFileFieldNames?: string[]
  formFields?: Record<string, string>
}): string {
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
  for (const [k, v] of Object.entries(args.queryParams)) {
    const nextV = applyVariables(v, vars)
    if (nextV !== '') usp.set(k, nextV)
  }
  const qs = usp.toString()
  if (qs) url += (url.includes('?') ? '&' : '?') + qs

  const headers: Record<string, string> = Object.fromEntries(
    Object.entries(args.headers).map(([k, v]) => [k, applyVariables(v, vars)]),
  )

  const methodAllowsBody = args.request.method !== 'GET' && args.request.method !== 'HEAD'
  const hasExplicitBodyInput =
    !!(args.bodyText !== undefined && args.bodyText.trim()) ||
    !!args.file ||
    !!(args.formFields && Object.keys(args.formFields).length)
  const wantsBody = !!args.request.body || hasExplicitBodyInput

  const parts: string[] = []
  const curlBase: string[] = ['curl']
  try {
    const validateCertificates = loadAppSettings().validateCertificates
    if (!validateCertificates) curlBase.push('--insecure')
  } catch (error) {
    logWarn('buildCurlCommand', 'Failed to read certificate validation settings', { error })
  }

  curlBase.push('-X', bashQuote(args.request.method))
  parts.push(curlBase.join(' '))
  parts.push(bashQuote(url))

  if (methodAllowsBody && wantsBody) {
    const desiredCt = (getHeader(headers, 'Content-Type') || args.request.body?.contentType || '').trim()
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
      deleteHeader(headers, 'Content-Type')

      for (const [k, v] of Object.entries(args.formFields ?? {})) {
        parts.push(`-F ${bashQuote(`${k}=${applyVariables(v, vars)}`)}`)
      }
      for (const fieldName of emptyFileFieldNames) {
        parts.push(`-F ${bashQuote(`${fieldName}=`)}`)
      }
      for (const { fieldName, file } of multipartFiles) {
        const safeField = (fieldName?.trim() || 'file')
        const name = file?.name ? file.name : 'file'
        parts.push(`-F ${bashQuote(`${safeField}=@/path/to/${name}`)}`)
      }
    } else if (file && ct.includes('application/octet-stream')) {
      if (desiredCt) setHeader(headers, 'Content-Type', desiredCt)
      const name = file?.name ? file.name : 'file'
      parts.push(`--data-binary ${bashQuote(`@/path/to/${name}`)}`)
    } else {
      if (desiredCt) setHeader(headers, 'Content-Type', desiredCt)
      const body = applyVariables(args.bodyText ?? '', vars)
      parts.push(`-d ${bashQuote(body)}`)
    }
  }

  for (const k of Object.keys(headers).sort(compareHeaderKeys)) {
    const v = headers[k]
    if (v === undefined) continue
    parts.push(`-H ${bashQuote(`${k}: ${v}`)}`)
  }

  return parts.join(' \\\n  ')
}
