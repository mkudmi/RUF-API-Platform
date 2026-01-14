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

export async function runRequest(args: {
  request: RequestItem
  baseUrl: string
  pathParams: Record<string,string>
  queryParams: Record<string,string>
  headers: Record<string,string>
  bodyText?: string
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
    init.headers = { 'Content-Type': args.request.body.contentType, ...init.headers }
    init.body = args.bodyText ?? ''
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
