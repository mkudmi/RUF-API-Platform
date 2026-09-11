import { safeParseJson } from './json'
import { tauriInvoke } from './tauri'

const STORAGE_KEY = 'ruf_system_client_tls_hosts_v1'
export const SYSTEM_CLIENT_TLS_CHANGED = 'ruf-system-client-tls-changed'
export type SystemClientTlsBinding = { origin: string; thumbprint: string }
const pendingSelections = new Map<string, Promise<string | null>>()

export function getSystemClientTlsBindings(storage: Storage = localStorage): SystemClientTlsBinding[] {
  const parsed = safeParseJson<unknown>(storage.getItem(STORAGE_KEY))
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const { origin, thumbprint } = value as Record<string, unknown>
    if (typeof origin !== 'string' || typeof thumbprint !== 'string' || !/^[A-F0-9]{40}$/.test(thumbprint)) return []
    try {
      const url = new URL(origin)
      return url.protocol === 'https:' && url.origin === origin ? [{ origin, thumbprint }] : []
    } catch { return [] }
  })
}

function saveBinding(origin: string, thumbprint: string | null) {
  const bindings = getSystemClientTlsBindings().filter(binding => binding.origin !== origin)
  if (thumbprint) bindings.push({ origin, thumbprint })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
  window.dispatchEvent(new Event(SYSTEM_CLIENT_TLS_CHANGED))
}

export function forgetSystemClientTlsBinding(origin: string) { saveBinding(origin, null) }

export function getSystemClientTlsThumbprint(url: string): string | undefined {
  const origin = new URL(url).origin
  return getSystemClientTlsBindings().find(binding => binding.origin === origin)?.thumbprint
}

export async function selectSystemClientTlsIdentity(origin: string): Promise<string | null> {
  const pending = pendingSelections.get(origin)
  if (pending) return pending
  const selection = tauriInvoke<string | null>('cert_select_system_client_identity', { origin })
    .then(thumbprint => {
      if (thumbprint && !/^[A-F0-9]{40}$/.test(thumbprint)) throw new Error('Invalid certificate thumbprint returned by Windows')
      if (thumbprint) saveBinding(origin, thumbprint)
      return thumbprint
    })
    .finally(() => pendingSelections.delete(origin))
  pendingSelections.set(origin, selection)
  return selection
}
