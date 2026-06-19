import { logError } from '../../../shared/utils/logger'

export function safeLoadNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch (error) {
    logError('SqlTerminal.safeLoadNumber', error, { key })
    return null
  }
}

export function safeLoadString(key: string): string | null {
  try {
    const raw = localStorage.getItem(key)
    return typeof raw === 'string' ? raw : null
  } catch (error) {
    logError('SqlTerminal.safeLoadString', error, { key })
    return null
  }
}

export function safeLoadFraction(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0 || n >= 1) return null
    return n
  } catch (error) {
    logError('SqlTerminal.safeLoadFraction', error, { key })
    return null
  }
}

export function safeSave(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch (error) {
    logError('SqlTerminal.safeSave', error, { key })
  }
}

export function safeRemove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch (error) {
    logError('SqlTerminal.safeRemove', error, { key })
  }
}
