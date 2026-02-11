import { safeParseJson } from './json'

export function loadLocalStorageJson<T>(key: string, fallback: T): T {
  const parsed = safeParseJson<unknown>(localStorage.getItem(key))
  return (parsed as T) ?? fallback
}

export function saveLocalStorageJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}
