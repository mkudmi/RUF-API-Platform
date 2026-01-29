export function isTauri(): boolean {
  try {
    type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown }
    return typeof window !== 'undefined' && !!(window as TauriWindow).__TAURI_INTERNALS__
  } catch {
    return false
  }
}

export async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<T>(command, args)
}
