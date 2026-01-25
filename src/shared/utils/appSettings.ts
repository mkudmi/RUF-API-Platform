type AppSettings = {
  validateCertificates: boolean
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  validateCertificates: true,
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

  return { validateCertificates }
}

export function saveAppSettings(settings: AppSettings, storage: Storage = localStorage) {
  storage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings))
}
