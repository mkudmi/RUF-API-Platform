import { isTauri } from './tauri'
import { tauriInvoke } from './tauri'

function getUrlString(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  if (input instanceof Request) return input.url
  return null
}

function normalizeHttpUrlLoose(url: string): string | null {
  const raw = url.trim()
  if (!raw) return null

  try {
    const u = new URL(raw)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString()
    return null
  } catch {
    // tolerate common typo: "http:/host/..." or "https:/host/..."
    const fixed = raw.replace(/^https?:\/(?!\/)/i, m => `${m}/`)
    try {
      const u = new URL(fixed)
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString()
      return null
    } catch {
      return null
    }
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

async function bodyToBase64(body: BodyInit): Promise<{ bodyBase64: string; contentType?: string }> {
  if (typeof body === 'string') {
    const bytes = new TextEncoder().encode(body)
    return { bodyBase64: toBase64(bytes) }
  }

  if (body instanceof URLSearchParams) {
    const bytes = new TextEncoder().encode(body.toString())
    return { bodyBase64: toBase64(bytes), contentType: 'application/x-www-form-urlencoded;charset=UTF-8' }
  }

  if (body instanceof Blob) {
    const buf = await body.arrayBuffer()
    return { bodyBase64: toBase64(new Uint8Array(buf)), contentType: body.type || undefined }
  }

  if (body instanceof ArrayBuffer) {
    return { bodyBase64: toBase64(new Uint8Array(body)) }
  }

  if (ArrayBuffer.isView(body)) {
    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
    return { bodyBase64: toBase64(bytes) }
  }

  if (body instanceof FormData) {
    const boundary = `ruf-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`
    const encoder = new TextEncoder()
    const chunks: Uint8Array[] = []

    for (const [key, value] of body.entries()) {
      chunks.push(encoder.encode(`--${boundary}\r\n`))
      if (typeof value === 'string') {
        chunks.push(encoder.encode(`Content-Disposition: form-data; name="${key}"\r\n\r\n`))
        chunks.push(encoder.encode(value))
        chunks.push(encoder.encode('\r\n'))
      } else {
        const fileName = (value as File).name || 'blob'
        const contentType = value.type || 'application/octet-stream'
        chunks.push(
          encoder.encode(
            `Content-Disposition: form-data; name="${key}"; filename="${fileName}"\r\n` +
              `Content-Type: ${contentType}\r\n\r\n`,
          ),
        )
        const buf = await value.arrayBuffer()
        chunks.push(new Uint8Array(buf))
        chunks.push(encoder.encode('\r\n'))
      }
    }

    chunks.push(encoder.encode(`--${boundary}--\r\n`))

    let total = 0
    for (const c of chunks) total += c.byteLength
    const out = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) {
      out.set(c, offset)
      offset += c.byteLength
    }

    return { bodyBase64: toBase64(out), contentType: `multipart/form-data; boundary=${boundary}` }
  }

  throw new Error('Unsupported request body type in desktop backend transport')
}

export async function platformFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: { insecureTls?: boolean },
): Promise<Response> {
  if (isTauri()) {
    const urlString = getUrlString(input)
    const normalizedNetworkUrl = urlString ? normalizeHttpUrlLoose(urlString) : null
    const isNetworkUrl = !!normalizedNetworkUrl

    try {
      if (normalizedNetworkUrl) {
        const url = normalizedNetworkUrl
        const method = (init?.method || 'GET').toUpperCase()

        const headers: [string, string][] = []
        const h = init?.headers
        if (h instanceof Headers) {
          h.forEach((v, k) => headers.push([k, v]))
        } else if (Array.isArray(h)) {
          for (const [k, v] of h) headers.push([k, String(v)])
        } else if (h && typeof h === 'object') {
          for (const [k, v] of Object.entries(h)) headers.push([k, String(v)])
        }

        const body = init?.body ?? null
        let bodyBase64: string | undefined
        let inferredContentType: string | undefined
        if (body !== null) {
          const encoded = await bodyToBase64(body)
          bodyBase64 = encoded.bodyBase64
          inferredContentType = encoded.contentType
        }

        if (inferredContentType) {
          const hasContentType = headers.some(([k]) => k.toLowerCase() === 'content-type')
          if (!hasContentType) headers.push(['Content-Type', inferredContentType])
        }

        const result = await tauriInvoke<{
          ok: boolean
          status: number
          statusText: string
          headers: [string, string][]
          bodyBase64: string
        }>('http_request', {
          args: {
            url,
            method,
            headers,
            bodyBase64,
            insecureTls: !!opts?.insecureTls,
          },
        })

        const binary = atob(result.bodyBase64 || '')
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

        return new Response(bytes, {
          status: result.status,
          statusText: result.statusText || '',
          headers: new Headers(result.headers || []),
        })
      }
    } catch (e: any) {
      if (isNetworkUrl) {
        const msg = e?.message ? String(e.message) : String(e)
        throw new Error(`Backend http_request failed: ${msg}`)
      }
    }
  }

  return await globalThis.fetch(input, init)
}
