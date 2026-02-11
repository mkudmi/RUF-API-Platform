import { logWarn } from './logger'

export function safeParseJson<T>(raw: string | null): T | null {
  try {
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch (error) {
    logWarn('safeParseJson', 'Failed to parse JSON payload', { error })
    return null
  }
}
