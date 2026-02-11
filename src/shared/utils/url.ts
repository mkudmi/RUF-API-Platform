import { logWarn } from './logger'

export function isAbsoluteUrl(url: string) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) || url.startsWith('//')
}

export function joinUrlParts(a: string, b: string) {
  const left = a.endsWith('/') ? a.slice(0, -1) : a
  const right = b.startsWith('/') ? b : `/${b}`
  return `${left}${right}`
}

export function computeEffectiveBaseUrl(envBaseUrl?: string, collectionBaseUrl?: string) {
  const env = (envBaseUrl || '').trim()
  const col = (collectionBaseUrl || '').trim()

  if (!env) return col
  if (!col) return env

  const envNorm = env.replace(/\/+$/, '')
  const colNorm = col.replace(/\/+$/, '')

  if (isAbsoluteUrl(colNorm)) {
    try {
      const u = new URL(colNorm)
      const p = (u.pathname || '').replace(/\/+$/, '')
      if (!p || p === '/') return envNorm
      if (envNorm.endsWith(p)) return envNorm
      return joinUrlParts(envNorm, p)
    } catch (error) {
      logWarn('computeEffectiveBaseUrl', 'Failed to parse absolute collection base URL', { error, colNorm })
      return envNorm
    }
  }

  if (colNorm.startsWith('/')) {
    if (envNorm.endsWith(colNorm)) return envNorm
    return joinUrlParts(envNorm, colNorm)
  }

  if (!isAbsoluteUrl(colNorm)) {
    if (envNorm.endsWith(`/${colNorm}`) || envNorm.endsWith(colNorm)) return envNorm
    return joinUrlParts(envNorm, colNorm)
  }

  return envNorm
}
