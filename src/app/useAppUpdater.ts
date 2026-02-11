import { useEffect, useRef, useState } from 'react'
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater'
import { logError } from '../shared/utils/logger'

type PendingUpdate = Pick<Update, 'version' | 'download' | 'install'>

const UPDATE_TOAST_SUPPRESS_KEY = 'ruf.update.toastSuppress'
const UPDATE_TOAST_SUPPRESS_TTL_MS = 30 * 60 * 1000

function readSuppressedUpdateVersion() {
  try {
    const raw = window.localStorage.getItem(UPDATE_TOAST_SUPPRESS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { version?: unknown, ts?: unknown }
    const version = typeof parsed?.version === 'string' ? parsed.version : null
    const ts = typeof parsed?.ts === 'number' ? parsed.ts : null
    if (!version || !ts) return null
    if (Date.now() - ts > UPDATE_TOAST_SUPPRESS_TTL_MS) return null
    return version
  } catch (error) {
    logError('readSuppressedUpdateVersion', error)
    return null
  }
}

function writeSuppressedUpdateVersion(version: string) {
  try {
    window.localStorage.setItem(UPDATE_TOAST_SUPPRESS_KEY, JSON.stringify({ version, ts: Date.now() }))
  } catch (error) {
    logError('writeSuppressedUpdateVersion', error, { version })
  }
}

function clearSuppressedUpdateVersion() {
  try {
    window.localStorage.removeItem(UPDATE_TOAST_SUPPRESS_KEY)
  } catch (error) {
    logError('clearSuppressedUpdateVersion', error)
  }
}

function safeStringify(value: unknown) {
  try {
    const seen = new WeakSet<object>()
    return JSON.stringify(
      value,
      (_k, v) => {
        if (typeof v === 'bigint') return v.toString()
        if (v instanceof Error) {
          const errLike = v as Error & Record<string, unknown> & { cause?: unknown }
          const out: Record<string, unknown> = {
            name: v.name,
            message: v.message,
            stack: v.stack,
          }
          for (const key of Object.keys(errLike)) out[key] = errLike[key]
          const cause = errLike.cause
          if (cause !== undefined) out.cause = cause
          return out
        }
        if (v && typeof v === 'object') {
          if (seen.has(v)) return '[Circular]'
          seen.add(v)
        }
        return v
      },
      2,
    )
  } catch (error) {
    logError('safeStringify', error)
    return null
  }
}

function formatUpdateErrorLog(action: 'check' | 'download' | 'install', e: unknown) {
  const ts = new Date().toISOString()
  const header = `[${ts}] updater.${action} failed`

  if (typeof e === 'string') return `${header}\n${e}`
  if (!e || (typeof e !== 'object' && typeof e !== 'function')) return `${header}\n${String(e)}`

  const err = e as Partial<Error>
  const message = typeof err?.message === 'string' ? err.message : String(err)
  const name = typeof err?.name === 'string' ? err.name : null
  const stack = typeof err?.stack === 'string' ? err.stack : null
  const json = safeStringify(e)

  const lines: string[] = [header, name ? `${name}: ${message}` : message]
  if (stack) lines.push('', 'Stack:', stack)
  if (json) lines.push('', 'Details:', json)
  return lines.join('\n')
}

export function useAppUpdater() {
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateTask, setUpdateTask] = useState<'checking' | 'downloading' | 'installing' | null>(null)
  const [updateHint, setUpdateHint] = useState<string | null>(null)
  const [updateErrorLog, setUpdateErrorLog] = useState<string | null>(null)
  const [pendingUpdate, setPendingUpdate] = useState<PendingUpdate | null>(null)
  const [updateDownloaded, setUpdateDownloaded] = useState(false)
  const [updateDownloadPct, setUpdateDownloadPct] = useState<number | null>(null)
  const updateDownloadTotalBytesRef = useRef<number | null>(null)
  const updateDownloadedBytesRef = useRef(0)
  const lastUpdateDownloadPctRef = useRef<number | null>(null)
  const suppressUpdateToastRef = useRef(false)
  const [showUpdateToast, setShowUpdateToast] = useState(false)
  const updateHintTimeoutRef = useRef<number | null>(null)

  function clearUpdateHintTimer() {
    if (updateHintTimeoutRef.current != null) {
      window.clearTimeout(updateHintTimeoutRef.current)
      updateHintTimeoutRef.current = null
    }
  }

  function getErrorMessage(e: unknown) {
    if (typeof e === 'string') return e
    if (e && typeof e === 'object' && 'message' in e) {
      const msg = (e as { message?: unknown }).message
      if (typeof msg === 'string') return msg
    }
    return String(e)
  }

  useEffect(() => {
    return clearUpdateHintTimer
  }, [])

  function setUpdateHintTransient(message: string, ms: number) {
    clearUpdateHintTimer()
    setUpdateHint(message)
    updateHintTimeoutRef.current = window.setTimeout(() => {
      setUpdateHint(null)
      updateHintTimeoutRef.current = null
    }, ms)
  }

  function resetUpdateDownloadProgress() {
    updateDownloadTotalBytesRef.current = null
    updateDownloadedBytesRef.current = 0
    lastUpdateDownloadPctRef.current = null
    setUpdateDownloadPct(null)
  }

  async function checkForUpdates(opts?: { showNoUpdateMessage?: boolean, showToastIfUpdate?: boolean }) {
    try {
      const [{ check }] = await Promise.all([import('@tauri-apps/plugin-updater')])
      const update = await check()
      if (!update) {
        clearSuppressedUpdateVersion()
        if (opts?.showNoUpdateMessage) setUpdateHintTransient('You are up to date!', 5000)
        setUpdateErrorLog(null)
        return null
      }

      const suppressedVersion = readSuppressedUpdateVersion()
      const shouldSuppressToast =
        suppressUpdateToastRef.current ||
        (suppressedVersion != null && suppressedVersion === update.version)

      setPendingUpdate(update)
      setUpdateDownloaded(false)
      resetUpdateDownloadProgress()
      clearUpdateHintTimer()
      setUpdateHint(`v ${update.version} is available!`)
      setUpdateErrorLog(null)
      if (opts?.showToastIfUpdate && !shouldSuppressToast) setShowUpdateToast(true)
      return update
    } catch (e: unknown) {
      const msg = getErrorMessage(e)
      if (opts?.showNoUpdateMessage) setUpdateHintTransient(`Update check failed: ${msg}`, 4000)
      setUpdateErrorLog(formatUpdateErrorLog('check', e))
      return null
    }
  }

  async function onCheckUpdates() {
    setUpdateBusy(true)
    setUpdateTask('checking')
    try {
      setPendingUpdate(null)
      setUpdateDownloaded(false)
      resetUpdateDownloadProgress()
      setShowUpdateToast(false)
      setUpdateHint(null)
      setUpdateErrorLog(null)
      await checkForUpdates({ showNoUpdateMessage: true, showToastIfUpdate: false })
    } finally {
      setUpdateBusy(false)
      setUpdateTask(null)
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => {
      void checkForUpdates({ showToastIfUpdate: true })
    }, 900)
    return () => window.clearTimeout(t)
  }, [])

  async function onUpdateNow() {
    if (!pendingUpdate) return

    setShowUpdateToast(true)
    if (updateDownloaded) {
      if (updateHintTimeoutRef.current != null) window.clearTimeout(updateHintTimeoutRef.current)
      setUpdateHint('Download complete. Restart to install.')
      return
    }

    setUpdateBusy(true)
    setUpdateTask('downloading')
    setUpdateDownloaded(false)
    resetUpdateDownloadProgress()
    clearUpdateHintTimer()
    setUpdateHint(`Downloading v ${pendingUpdate.version}...`)
    setUpdateErrorLog(null)
    try {
      await pendingUpdate.download((event: DownloadEvent) => {
        if (!event || typeof event !== 'object') return

        if (event.event === 'Started') {
          const total = event?.data?.contentLength
          if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
            updateDownloadTotalBytesRef.current = total
            updateDownloadedBytesRef.current = 0
            lastUpdateDownloadPctRef.current = 0
            setUpdateDownloadPct(0)
          }
          return
        }

        if (event.event === 'Progress') {
          const chunk = event?.data?.chunkLength
          if (typeof chunk === 'number' && Number.isFinite(chunk) && chunk > 0) {
            updateDownloadedBytesRef.current += chunk
          }

          const total = updateDownloadTotalBytesRef.current
          if (typeof total === 'number' && total > 0) {
            const pct = Math.max(0, Math.min(100, Math.floor((updateDownloadedBytesRef.current / total) * 100)))
            if (pct !== lastUpdateDownloadPctRef.current) {
              lastUpdateDownloadPctRef.current = pct
              setUpdateDownloadPct(pct)
              setUpdateHint(`Downloading v ${pendingUpdate.version}... ${pct}%`)
            }
          }
          return
        }

        if (event.event === 'Finished') {
          if (updateDownloadTotalBytesRef.current != null) setUpdateDownloadPct(100)
        }
      })

      setUpdateDownloaded(true)
      clearUpdateHintTimer()
      setUpdateHint('Download complete. Restart to install.')
    } catch (e: unknown) {
      const msg = getErrorMessage(e)
      setUpdateHintTransient(`Update failed: ${msg}`, 6000)
      setUpdateErrorLog(formatUpdateErrorLog('download', e))
    } finally {
      setUpdateBusy(false)
      setUpdateTask(null)
    }
  }

  async function onRestartToUpdate() {
    if (!pendingUpdate || !updateDownloaded) return

    const installingUpdate = pendingUpdate
    suppressUpdateToastRef.current = true
    writeSuppressedUpdateVersion(installingUpdate.version)
    setShowUpdateToast(false)
    setPendingUpdate(null)

    setUpdateBusy(true)
    setUpdateTask('installing')
    clearUpdateHintTimer()
    setUpdateHint('Installing...')
    setUpdateErrorLog(null)
    try {
      const [{ relaunch }] = await Promise.all([import('@tauri-apps/plugin-process')])
      await installingUpdate.install()
      setUpdateHint('Restarting...')
      await relaunch()
    } catch (e: unknown) {
      suppressUpdateToastRef.current = false
      clearSuppressedUpdateVersion()
      const msg = getErrorMessage(e)
      setUpdateHintTransient(`Update failed: ${msg}`, 6000)
      setUpdateErrorLog(formatUpdateErrorLog('install', e))
    } finally {
      setUpdateBusy(false)
      setUpdateTask(null)
    }
  }

  function onUpdateLater() {
    setShowUpdateToast(false)
  }

  return {
    updateBusy,
    updateTask,
    updateHint,
    updateErrorLog,
    hasPendingUpdate: pendingUpdate != null,
    pendingUpdateVersion: pendingUpdate?.version ?? null,
    updateDownloaded,
    updateDownloadPct,
    showUpdateToast,
    onCheckUpdates,
    onUpdateNow,
    onRestartToUpdate,
    onUpdateLater,
  }
}
