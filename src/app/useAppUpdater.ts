import { useEffect, useRef, useState } from 'react'
import type { DownloadEvent } from '@tauri-apps/plugin-updater'

type PendingUpdate = {
  version: string
  download: (cb?: (event: DownloadEvent) => void) => Promise<void>
  install: () => Promise<void>
}

function safeStringify(value: unknown) {
  try {
    const seen = new WeakSet<object>()
    return JSON.stringify(
      value,
      (_k, v) => {
        if (typeof v === 'bigint') return v.toString()
        if (v instanceof Error) {
          const out: Record<string, unknown> = {
            name: v.name,
            message: v.message,
            stack: v.stack,
          }
          for (const key of Object.keys(v)) out[key] = (v as any)[key]
          const cause = (v as any)?.cause
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
  } catch {
    return null
  }
}

function formatUpdateErrorLog(action: 'check' | 'download' | 'install', e: unknown) {
  const ts = new Date().toISOString()
  const header = `[${ts}] updater.${action} failed`

  if (typeof e === 'string') return `${header}\n${e}`
  if (!e || (typeof e !== 'object' && typeof e !== 'function')) return `${header}\n${String(e)}`

  const err = e as any
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
  const [showUpdateToast, setShowUpdateToast] = useState(false)
  const updateHintTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (updateHintTimeoutRef.current != null) window.clearTimeout(updateHintTimeoutRef.current)
    }
  }, [])

  function setUpdateHintTransient(message: string, ms: number) {
    if (updateHintTimeoutRef.current != null) window.clearTimeout(updateHintTimeoutRef.current)
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
        if (opts?.showNoUpdateMessage) setUpdateHintTransient('You are up to date!', 5000)
        setUpdateErrorLog(null)
        return null
      }

      setPendingUpdate(update as any)
      setUpdateDownloaded(false)
      resetUpdateDownloadProgress()
      if (updateHintTimeoutRef.current != null) window.clearTimeout(updateHintTimeoutRef.current)
      setUpdateHint(`v ${update.version} is available!`)
      setUpdateErrorLog(null)
      if (opts?.showToastIfUpdate) setShowUpdateToast(true)
      return update as any
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : String(e)
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
    if (updateHintTimeoutRef.current != null) window.clearTimeout(updateHintTimeoutRef.current)
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
      if (updateHintTimeoutRef.current != null) window.clearTimeout(updateHintTimeoutRef.current)
      setUpdateHint('Download complete. Restart to install.')
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : String(e)
      setUpdateHintTransient(`Update failed: ${msg}`, 6000)
      setUpdateErrorLog(formatUpdateErrorLog('download', e))
    } finally {
      setUpdateBusy(false)
      setUpdateTask(null)
    }
  }

  async function onRestartToUpdate() {
    if (!pendingUpdate || !updateDownloaded) return

    setUpdateBusy(true)
    setUpdateTask('installing')
    if (updateHintTimeoutRef.current != null) window.clearTimeout(updateHintTimeoutRef.current)
    setUpdateHint('Installing...')
    setUpdateErrorLog(null)
    try {
      const [{ relaunch }] = await Promise.all([import('@tauri-apps/plugin-process')])
      await pendingUpdate.install()
      setUpdateHint('Restarting...')
      await relaunch()
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : String(e)
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
