import { logWarn } from './logger'

export function safeJsonParse(text: string) {
  try {
    return JSON.parse(text)
  } catch (error) {
    logWarn('safeJsonParse', 'Failed to parse HTTP JSON body', { error })
    return null
  }
}
