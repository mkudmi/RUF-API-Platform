const DEFAULT_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

export function statusClass(status: number) {
  if (status >= 200 && status < 300) return 'status2xx'
  if (status >= 300 && status < 400) return 'status3xx'
  if (status >= 400 && status < 500) return 'status4xx'
  if (status >= 500 && status < 600) return 'status5xx'
  return 'statusOther'
}

export function displayRunnerMethod(method: string) {
  const normalized = (method ?? '').toUpperCase()
  if (normalized === 'DELETE') return 'DEL'
  if (normalized === 'PATCH') return 'PAT'
  if (normalized === 'OPTIONS') return 'OPT'
  if (!DEFAULT_HTTP_METHODS.has(normalized)) return normalized.slice(0, 3)
  return normalized
}

export function runnerMethodClass(method: string) {
  const normalized = (method ?? '').toUpperCase()
  if (!DEFAULT_HTTP_METHODS.has(normalized)) return 'treeMethodInFlight treeMethodInFlightCustom'
  return `treeMethodInFlight treeMethodInFlight${normalized}`
}

export function formatRunDuration(timeMs: number) {
  if (!Number.isFinite(timeMs) || timeMs <= 0) return '0ms'
  if (timeMs > 999) return `${(timeMs / 1000).toFixed(2)}s`
  return `${Math.round(timeMs)}ms`
}

export function formatRunBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function formatRunResponseBodyPretty(bodyText: string) {
  const raw = typeof bodyText === 'string' ? bodyText : ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return raw
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return raw
  }
}

export function formatRunHistoryTimestamp(time: number) {
  if (!Number.isFinite(time) || time <= 0) return '-'
  try {
    return new Date(time).toLocaleString()
  } catch {
    return '-'
  }
}
