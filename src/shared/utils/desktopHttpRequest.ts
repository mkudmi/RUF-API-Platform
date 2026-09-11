import { tauriInvoke } from './tauri'
import { getSystemClientTlsThumbprint, selectSystemClientTlsIdentity } from './systemClientTls'

export type DesktopHttpRequestArgs = {
  url: string
  method: string
  headers: [string, string][]
  bodyBase64?: string
  timeoutMs?: number
  insecureTls?: boolean
  caCertsPem?: string[]
  clientPkcs12Base64?: string
  clientPkcs12Password?: string
}

export type DesktopHttpResult = {
  status: number
  statusText: string
  headers: [string, string][]
  bodyBase64: string
  manualRedirects?: boolean
}

export async function desktopHttpRequest(initial: DesktopHttpRequestArgs, signal?: AbortSignal | null): Promise<DesktopHttpResult> {
  let args = { ...initial, headers: [...initial.headers] }
  let selectedForHop = false
  let redirects = 0
  const started = Date.now()
  // Time spent choosing a certificate is user interaction, not a network timeout.
  let selectionMs = 0
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const elapsed = Date.now() - started - selectionMs
    const budget = initial.timeoutMs === 0 ? undefined : (initial.timeoutMs ?? 300_000)
    if (budget !== undefined && elapsed >= budget) throw new Error('Request timed out')
    const systemClientCertThumbprint = getSystemClientTlsThumbprint(args.url)
    let result: DesktopHttpResult
    try {
      result = await tauriInvoke<DesktopHttpResult>('http_request', { args: {
        ...args,
        timeoutMs: budget === undefined ? 0 : Math.max(1, budget - elapsed),
        systemClientCertThumbprint,
        clientPkcs12Base64: systemClientCertThumbprint ? undefined : args.clientPkcs12Base64,
        clientPkcs12Password: systemClientCertThumbprint ? undefined : args.clientPkcs12Password,
      } })
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const message = error instanceof Error ? error.message : String(error)
      if (message !== 'RUF_CLIENT_CERT_REQUIRED' || new URL(args.url).protocol !== 'https:') throw error
      if (selectedForHop) throw new Error(`The certificate selected for ${new URL(args.url).origin} could not be used. Check its private key and whether the API accepts its issuer.`)
      const selectionStarted = Date.now()
      const selected = await selectSystemClientTlsIdentity(new URL(args.url).origin)
      selectionMs += Date.now() - selectionStarted
      if (!selected || signal?.aborted) throw new DOMException('Certificate selection canceled', 'AbortError')
      selectedForHop = true
      continue
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const location = result.headers.find(([name]) => name.toLowerCase() === 'location')?.[1]
    if (!result.manualRedirects || ![301, 302, 303, 307, 308].includes(result.status) || !location) return result
    if (++redirects > 10) throw new Error('Too many redirects')
    const previous = new URL(args.url)
    const next = new URL(location, previous)
    if (!['http:', 'https:'].includes(next.protocol) || (previous.protocol === 'https:' && next.protocol === 'http:')) throw new Error('Unsafe redirect protocol')
    const dropBody = (result.status === 303 && args.method !== 'HEAD') || ([301, 302].includes(result.status) && args.method === 'POST')
    let headers = args.headers
    if (previous.origin !== next.origin) {
      headers = headers.filter(([name]) => !['authorization', 'cookie', 'cookie2', 'proxy-authorization'].includes(name.toLowerCase()))
    }
    if (dropBody) headers = headers.filter(([name]) => !['content-type', 'content-length', 'transfer-encoding'].includes(name.toLowerCase()))
    args = { ...args, url: next.href, headers, method: dropBody ? 'GET' : args.method, bodyBase64: dropBody ? undefined : args.bodyBase64 }
    selectedForHop = false
  }
}
