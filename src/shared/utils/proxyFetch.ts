import { isTauri } from './tauri'
import { platformFetch } from './platformFetch'

function isCrossOrigin(absoluteUrl: string): boolean {
  try {
    if (typeof location === 'undefined') return false
    const u = new URL(absoluteUrl, location.origin)
    return u.origin !== location.origin
  } catch {
    return false
  }
}

function buildProxyUrl(targetAbsoluteUrl: string, opts?: { insecureTls?: boolean }): string {
  const qs = new URLSearchParams()
  qs.set('url', targetAbsoluteUrl)
  if (opts?.insecureTls) qs.set('insecure', '1')
  return `/__ruf_proxy?${qs.toString()}`
}

export async function fetchWithProxyFallback(
  targetAbsoluteUrl: string,
  init?: RequestInit,
  opts?: { insecureTls?: boolean },
): Promise<Response> {
  if (isTauri()) {
    return await platformFetch(targetAbsoluteUrl, init, opts)
  }

  try {
    return await platformFetch(targetAbsoluteUrl, init, opts)
  } catch (e) {
    if (!isCrossOrigin(targetAbsoluteUrl)) throw e
    return await platformFetch(buildProxyUrl(targetAbsoluteUrl, opts), init, opts)
  }
}

