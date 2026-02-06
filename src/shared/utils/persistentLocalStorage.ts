import { tauriInvoke } from './tauri'

const KEY_PREFIXES = ['ruf_']
const SAVE_DEBOUNCE_MS = 350

type StorageLoadResult = {
  entries?: Record<string, string>
}

function shouldPersistKey(key: string) {
  return KEY_PREFIXES.some(prefix => key.startsWith(prefix))
}

function collectPersistedEntries(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (!key || !shouldPersistKey(key)) continue
    const value = storage.getItem(key)
    if (typeof value === 'string') out[key] = value
  }
  return out
}

export async function initPersistentLocalStorageBridge() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return

  const storage = window.localStorage
  let loaded: StorageLoadResult | null = null
  try {
    loaded = await tauriInvoke<StorageLoadResult>('storage_load')
  } catch {
    return
  }

  const entries = loaded?.entries ?? {}
  for (const [key, value] of Object.entries(entries)) {
    if (!shouldPersistKey(key)) continue
    storage.setItem(key, value)
  }

  const proto = Storage.prototype as Storage['constructor']['prototype'] & {
    __rufPersistentBridgeInstalled?: boolean
  }
  if (proto.__rufPersistentBridgeInstalled) return
  proto.__rufPersistentBridgeInstalled = true

  const originalSetItem = proto.setItem
  const originalRemoveItem = proto.removeItem
  const originalClear = proto.clear

  let timer: number | null = null
  let saveInFlight = false
  let saveQueued = false

  const flush = async () => {
    if (saveInFlight) {
      saveQueued = true
      return
    }

    saveInFlight = true
    try {
      const snapshot = collectPersistedEntries(storage)
      await tauriInvoke('storage_save', { args: { entries: snapshot } })
    } catch {
      // best-effort persistence; keep app behavior unchanged on failure
    } finally {
      saveInFlight = false
      if (saveQueued) {
        saveQueued = false
        queueSave()
      }
    }
  }

  const queueSave = () => {
    if (timer !== null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      void flush()
    }, SAVE_DEBOUNCE_MS)
  }

  proto.setItem = function (this: Storage, key: string, value: string) {
    originalSetItem.call(this, key, value)
    if (this === storage && shouldPersistKey(key)) queueSave()
  }

  proto.removeItem = function (this: Storage, key: string) {
    originalRemoveItem.call(this, key)
    if (this === storage && shouldPersistKey(key)) queueSave()
  }

  proto.clear = function (this: Storage) {
    const hadPersistedKeys = this === storage && Object.keys(collectPersistedEntries(storage)).length > 0
    originalClear.call(this)
    if (hadPersistedKeys) queueSave()
  }

  window.addEventListener('pagehide', () => {
    void flush()
  })
  window.addEventListener('beforeunload', () => {
    void flush()
  })

  queueSave()
}
