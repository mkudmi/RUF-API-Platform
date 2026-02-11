type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogMeta = Record<string, unknown> | undefined

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function readConfiguredLevel(): LogLevel {
  const envLevel = (import.meta.env?.VITE_LOG_LEVEL || '').toLowerCase()
  if (envLevel === 'debug' || envLevel === 'info' || envLevel === 'warn' || envLevel === 'error') return envLevel

  try {
    const raw = window.localStorage.getItem('ruf.log.level')?.toLowerCase() || ''
    if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  } catch {
    // localStorage may be unavailable; keep default
  }

  return import.meta.env?.DEV ? 'debug' : 'info'
}

function normalizeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  }
}

function sanitizeMeta(meta: LogMeta): Record<string, unknown> | undefined {
  if (!meta) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    out[k] = k.toLowerCase().includes('error') ? normalizeError(v) : v
  }
  return out
}

class Logger {
  private readonly namespace: string
  private readonly minLevel: LogLevel

  constructor(namespace: string, minLevel = readConfiguredLevel()) {
    this.namespace = namespace
    this.minLevel = minLevel
  }

  child(scope: string) {
    return new Logger(`${this.namespace}:${scope}`, this.minLevel)
  }

  private shouldLog(level: LogLevel) {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel]
  }

  private emit(level: LogLevel, message: string, meta?: LogMeta) {
    if (!this.shouldLog(level)) return
    const payload = {
      ts: new Date().toISOString(),
      level,
      logger: this.namespace,
      msg: message,
      ...(sanitizeMeta(meta) ? { meta: sanitizeMeta(meta) } : null),
    }
    const method = level === 'error' ? console.error : level === 'warn' ? console.warn : level === 'info' ? console.info : console.debug
    method(payload)
  }

  debug(message: string, meta?: LogMeta) {
    this.emit('debug', message, meta)
  }

  info(message: string, meta?: LogMeta) {
    this.emit('info', message, meta)
  }

  warn(message: string, meta?: LogMeta) {
    this.emit('warn', message, meta)
  }

  error(message: string, meta?: LogMeta) {
    this.emit('error', message, meta)
  }
}

const rootLogger = new Logger('ruf')

export function getLogger(scope: string) {
  return rootLogger.child(scope)
}

export function logError(context: string, error: unknown, meta?: Record<string, unknown>) {
  rootLogger.error(context, { error, ...meta })
}

export function logWarn(context: string, message: string, meta?: Record<string, unknown>) {
  rootLogger.warn(`${context}: ${message}`, meta)
}
