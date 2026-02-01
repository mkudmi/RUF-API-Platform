import { useEffect, useRef, useState } from 'react'
import type { DownloadEvent } from '@tauri-apps/plugin-updater'
import { isTauri } from '../shared/utils/tauri'

type PendingUpdate = {
  version: string
  download: (cb?: (event: DownloadEvent) => void) => Promise<void>
  install: () => Promise<void>
}

export function useAppUpdater() {
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateTask, setUpdateTask] = useState<'checking' | 'downloading' | 'installing' | null>(null)
  const [updateHint, setUpdateHint] = useState<string | null>(null)
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
    if (!isTauri()) {
      if (opts?.showNoUpdateMessage) setUpdateHintTransient('Updates are only available in the desktop app.', 2000)
      return null
    }

    try {
      const [{ check }] = await Promise.all([import('@tauri-apps/plugin-updater')])
      const update = await check()
      if (!update) {
        if (opts?.showNoUpdateMessage) setUpdateHintTransient('You are up to date!', 5000)
        return null
      }

      setPendingUpdate(update as any)
      setUpdateDownloaded(false)
      resetUpdateDownloadProgress()
      if (updateHintTimeoutRef.current != null) window.clearTimeout(updateHintTimeoutRef.current)
      setUpdateHint(`v ${update.version} is available!`)
      if (opts?.showToastIfUpdate) setShowUpdateToast(true)
      return update as any
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : String(e)
      if (opts?.showNoUpdateMessage) setUpdateHintTransient(`Update check failed: ${msg}`, 4000)
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
      await checkForUpdates({ showNoUpdateMessage: true, showToastIfUpdate: false })
    } finally {
      setUpdateBusy(false)
      setUpdateTask(null)
    }
  }

  useEffect(() => {
    if (!isTauri()) return
    const t = window.setTimeout(() => {
      void checkForUpdates({ showToastIfUpdate: true })
    }, 900)
    return () => window.clearTimeout(t)
  }, [])

  async function onUpdateNow() {
    if (!isTauri() || !pendingUpdate) return

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
    } finally {
      setUpdateBusy(false)
      setUpdateTask(null)
    }
  }

  async function onRestartToUpdate() {
    if (!isTauri() || !pendingUpdate || !updateDownloaded) return

    setUpdateBusy(true)
    setUpdateTask('installing')
    if (updateHintTimeoutRef.current != null) window.clearTimeout(updateHintTimeoutRef.current)
    setUpdateHint('Installing...')
    try {
      const [{ relaunch }] = await Promise.all([import('@tauri-apps/plugin-process')])
      await pendingUpdate.install()
      setUpdateHint('Restarting...')
      await relaunch()
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : String(e)
      setUpdateHintTransient(`Update failed: ${msg}`, 6000)
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

