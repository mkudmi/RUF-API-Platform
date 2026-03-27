import type { GlobalSqlConnectionItem, GlobalSqlConnectionSettings } from '../types/environment'
import { DEFAULT_GLOBAL_SQL_CONNECTION_SETTINGS } from '../types/environment'
import { safeParseJson } from './json'

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

export type ClientTlsIdentity = {
  certPem: string
  keyPem: string
}

export type AppSettings = {
  validateCertificates: boolean
  caCertificates: CaCertificate[]
  clientTlsIdentity: ClientTlsIdentity | null
  requestTimeoutSec: number
  disableRequestTimeout: boolean
  globalSql: GlobalSqlConnectionSettings
  globalSqlConnections: GlobalSqlConnectionItem[]
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  validateCertificates: true,
  caCertificates: [],
  clientTlsIdentity: null,
  requestTimeoutSec: 300,
  disableRequestTimeout: false,
  globalSql: { ...DEFAULT_GLOBAL_SQL_CONNECTION_SETTINGS },
  globalSqlConnections: [],
}

const APP_SETTINGS_KEY = 'ruf_app_settings_v1'

export function loadAppSettings(storage: Storage = localStorage): AppSettings {
  const parsed = safeParseJson<unknown>(storage.getItem(APP_SETTINGS_KEY))
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_APP_SETTINGS }

  const rec = parsed as Record<string, unknown>
  const validateCertificates = typeof rec.validateCertificates === 'boolean'
    ? rec.validateCertificates
    : DEFAULT_APP_SETTINGS.validateCertificates
  const requestTimeoutSec = (
    typeof rec.requestTimeoutSec === 'number' && Number.isFinite(rec.requestTimeoutSec)
      ? Math.max(0, Math.min(600, Math.round(rec.requestTimeoutSec)))
      : DEFAULT_APP_SETTINGS.requestTimeoutSec
  )
  const disableRequestTimeout = typeof rec.disableRequestTimeout === 'boolean'
    ? rec.disableRequestTimeout
    : DEFAULT_APP_SETTINGS.disableRequestTimeout

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

  const rawClientTlsIdentity = rec.clientTlsIdentity
  const clientTlsIdentity: ClientTlsIdentity | null = (() => {
    if (!rawClientTlsIdentity || typeof rawClientTlsIdentity !== 'object') return null
    const tlsRec = rawClientTlsIdentity as Record<string, unknown>
    const certPem = typeof tlsRec.certPem === 'string' ? tlsRec.certPem.trim() : ''
    const keyPem = typeof tlsRec.keyPem === 'string' ? tlsRec.keyPem.trim() : ''
    if (!certPem || !keyPem) return null
    return { certPem, keyPem }
  })()

  const rawGlobalSql = rec.globalSql
  const baseSql = DEFAULT_GLOBAL_SQL_CONNECTION_SETTINGS
  const globalSql: GlobalSqlConnectionSettings = (() => {
    if (!rawGlobalSql || typeof rawGlobalSql !== 'object') return { ...baseSql }
    const sqlRec = rawGlobalSql as Record<string, unknown>
    const type = sqlRec.type === 'mysql' ? 'mysql' : 'postgres'
    const sslRaw = typeof sqlRec.sslmode === 'string' ? sqlRec.sslmode : ''
    const sslmode =
      sslRaw === 'disable' || sslRaw === 'allow' || sslRaw === 'prefer' || sslRaw === 'require' || sslRaw === 'verify-ca' || sslRaw === 'verify-full'
        ? sslRaw
        : 'prefer'
    const defaultPort = type === 'mysql' ? '3306' : '5432'
    return {
      type,
      sslmode,
      host: typeof sqlRec.host === 'string' ? sqlRec.host : '',
      port: typeof sqlRec.port === 'string' ? sqlRec.port : defaultPort,
      database: typeof sqlRec.database === 'string' ? sqlRec.database : '',
      username: typeof sqlRec.username === 'string' ? sqlRec.username : '',
      password: typeof sqlRec.password === 'string' ? sqlRec.password : '',
    }
  })()

  const rawGlobalSqlConnections = rec.globalSqlConnections
  const globalSqlConnections: GlobalSqlConnectionItem[] = Array.isArray(rawGlobalSqlConnections)
    ? rawGlobalSqlConnections
      .filter(x => x && typeof x === 'object')
      .map(x => x as Record<string, unknown>)
      .map((x): GlobalSqlConnectionItem | null => {
        const id = typeof x.id === 'string' ? x.id.trim() : ''
        const name = typeof x.name === 'string' ? x.name.trim() : ''
        if (!id || !name) return null
        const type = x.type === 'mysql' ? 'mysql' : 'postgres'
        const sslRaw = typeof x.sslmode === 'string' ? x.sslmode : ''
        const sslmode =
          sslRaw === 'disable' || sslRaw === 'allow' || sslRaw === 'prefer' || sslRaw === 'require' || sslRaw === 'verify-ca' || sslRaw === 'verify-full'
            ? sslRaw
            : 'prefer'
        const defaultPort = type === 'mysql' ? '3306' : '5432'
        return {
          id,
          name,
          type,
          sslmode,
          host: typeof x.host === 'string' ? x.host : '',
          port: typeof x.port === 'string' ? x.port : defaultPort,
          database: typeof x.database === 'string' ? x.database : '',
          username: typeof x.username === 'string' ? x.username : '',
          password: typeof x.password === 'string' ? x.password : '',
        }
      })
      .filter((x): x is GlobalSqlConnectionItem => !!x)
    : []

  return {
    validateCertificates,
    caCertificates,
    clientTlsIdentity,
    requestTimeoutSec,
    disableRequestTimeout,
    globalSql,
    globalSqlConnections,
  }
}

export function saveAppSettings(settings: AppSettings, storage: Storage = localStorage) {
  storage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings))
}
