import { getClientTlsFetchOptions, loadAppSettings } from '../../shared/utils/appSettings'
import { platformFetch } from '../../shared/utils/platformFetch'

export async function loadSpecFromUrl(rawUrl: string): Promise<{ text: string; url: string; origin: string }> {
  const url = new URL(rawUrl.trim())
  const { validateCertificates, caCertificates, clientTlsIdentity } = loadAppSettings()
  const res = await platformFetch(url.toString(), undefined, {
    insecureTls: !validateCertificates,
    caCertsPem: (caCertificates || []).map(c => c.pem),
    ...getClientTlsFetchOptions({ clientTlsIdentity }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const text = await res.text()
  return { text, url: url.toString(), origin: url.origin }
}
