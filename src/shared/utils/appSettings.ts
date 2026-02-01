export type CaCertificate = {
  id: string
  pem: string
  addedAt: number
  sha256?: string
  subject?: string
  issuer?: string
  notBefore?: string
  notAfter?: string
}

export type AppSettings = {
  validateCertificates: boolean
  caCertificates: CaCertificate[]
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  validateCertificates: true,
  caCertificates: [],
}

const APP_SETTINGS_KEY = 'ruf_app_settings_v1'

function safeParse(raw: string | null): unknown {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function loadAppSettings(storage: Storage = localStorage): AppSettings {
  const parsed = safeParse(storage.getItem(APP_SETTINGS_KEY))
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_APP_SETTINGS }

  const rec = parsed as Record<string, unknown>
  const validateCertificates = typeof rec.validateCertificates === 'boolean'
    ? rec.validateCertificates
    : DEFAULT_APP_SETTINGS.validateCertificates

  const rawCa = rec.caCertificates
  const caCertificates: CaCertificate[] = Array.isArray(rawCa)
    ? rawCa
      .filter(x => x && typeof x === 'object')
      .map(x => x as Record<string, unknown>)
      .map((x): CaCertificate | null => {
        const id = typeof x.id === 'string' ? x.id : ''
        const pem = typeof x.pem === 'string' ? x.pem : ''
        const addedAt = typeof x.addedAt === 'number' ? x.addedAt : 0
        if (!id || !pem || !Number.isFinite(addedAt) || addedAt <= 0) return null
        const out: CaCertificate = { id, pem, addedAt }
        if (typeof x.sha256 === 'string') out.sha256 = x.sha256
        if (typeof x.subject === 'string') out.subject = x.subject
        if (typeof x.issuer === 'string') out.issuer = x.issuer
        if (typeof x.notBefore === 'string') out.notBefore = x.notBefore
        if (typeof x.notAfter === 'string') out.notAfter = x.notAfter
        return out
      })
      .filter((x): x is CaCertificate => !!x)
    : DEFAULT_APP_SETTINGS.caCertificates

  return { validateCertificates, caCertificates }
}

export function saveAppSettings(settings: AppSettings, storage: Storage = localStorage) {
  storage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings))
}
