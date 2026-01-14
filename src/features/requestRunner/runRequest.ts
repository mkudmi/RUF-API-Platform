import type { RequestItem } from '../../shared/types/collection'
import { joinUrlParts } from '../../shared/utils/url'

export type RunResult = {
  ok: boolean
  status: number
  statusText: string
  timeMs: number
  headers: Record<string, string>
  bodyText: string
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
  pathParams: Record<string,string>
  queryParams: Record<string,string>
  headers: Record<string,string>
  bodyText?: string
  file?: File | null
  fileFieldName?: string
  formFields?: Record<string, string>
}): Promise<RunResult> {
  const start = performance.now()

  const baseUrl = (args.baseUrl || '').trim()
  let url =
    baseUrl
      ? joinUrlParts(baseUrl, args.request.path)
      : args.request.urlTemplate.replace('{{baseUrl}}', '')
  url = applyPathParams(url, args.pathParams)

  const usp = new URLSearchParams()
  for (const [k,v] of Object.entries(args.queryParams)) {
    if (v !== '') usp.set(k, v)
  }
  const qs = usp.toString()
  if (qs) url += (url.includes('?') ? '&' : '?') + qs

  const init: RequestInit = {
    method: args.request.method,
    headers: { ...args.headers },
  }

  if (args.request.body && args.request.method !== 'GET' && args.request.method !== 'HEAD') {
    const desiredCt = (getHeader(init.headers as any, 'Content-Type') || args.request.body.contentType || '').trim()
    const ct = desiredCt.toLowerCase()
    const file = args.file ?? null

    if (ct.includes('multipart/form-data') && (file || (args.formFields && Object.keys(args.formFields).length))) {
      const form = new FormData()
      for (const [k, v] of Object.entries(args.formFields ?? {})) form.set(k, v)
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
      init.body = args.bodyText ?? ''
    }
  }

  const res = await fetch(url, init)
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
