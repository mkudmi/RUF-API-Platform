import { logWarn } from '../../../shared/utils/logger'

export function safeParseJson<T>(raw: string | null): T | null {
  try {
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch (error) {
    logWarn('requestEditor.safeParseJson', 'Failed to parse JSON', { error })
    return null
  }
}
