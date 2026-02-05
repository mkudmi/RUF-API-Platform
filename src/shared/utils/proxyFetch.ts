import { platformFetch } from './platformFetch'

export async function fetchWithProxyFallback(
  targetAbsoluteUrl: string,
  init?: RequestInit,
  opts?: { insecureTls?: boolean; caCertsPem?: string[] },
): Promise<Response> {
  return await platformFetch(targetAbsoluteUrl, init, opts)
}

