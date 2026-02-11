import { useRef, useState, type ChangeEvent } from 'react'
import type { Collection } from '../../collectionTree'
import { importCollectionFromFile, importCollectionFromText, loadImportSourceFromUrl } from './importHelpers'
import { logWarn } from '../../../shared/utils/logger'

export function ImportSpec(props: { onImported: (c: Collection) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('Imported API')

  const pasteDialogRef = useRef<HTMLDialogElement | null>(null)
  const pasteTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const canReadClipboard = !!(globalThis.isSecureContext && navigator.clipboard?.readText)
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceOrigin, setSourceOrigin] = useState<string | undefined>(undefined)
  const [loadingUrl, setLoadingUrl] = useState(false)

  async function importFromText(text: string, origin?: string, importedFromUrl?: string) {
    const col = await importCollectionFromText({ text, name: name || undefined, sourceOrigin: origin, sourceUrl: importedFromUrl })
    props.onImported(col)
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const col = await importCollectionFromFile(file, { name: name || undefined })
      props.onImported(col)
    } catch (err: any) {
      setError(err?.message || 'Failed to import spec.')
    } finally {
      e.target.value = ''
    }
  }

  function openPasteDialog() {
    setPasteError(null)
    setPasteText('')
    setSourceUrl('')
    setSourceOrigin(undefined)
    pasteDialogRef.current?.showModal()
    setTimeout(() => pasteTextareaRef.current?.focus(), 0)
  }

  async function pasteFromClipboard() {
    setPasteError(null)
    try {
      if (!canReadClipboard) {
        setPasteError("Clipboard access isn't available in this context. Paste manually into the field (Ctrl+V).")
        return
      }
      const t = await navigator.clipboard.readText()
      setPasteText(t)
      if (!t.trim()) setPasteError('Clipboard is empty.')
    } catch (e: any) {
      setPasteError(e?.message || 'Failed to read from clipboard.')
    }
  }

  async function submitPasted() {
    setError(null)
    setPasteError(null)

    try {
      if (!pasteText.trim()) {
        setPasteError('Paste OpenAPI JSON/YAML first.')
        return
      }
      const rawUrl = sourceUrl.trim()
      let normalizedUrl: string | undefined
      if (rawUrl) {
        try {
          normalizedUrl = new URL(rawUrl).toString()
        } catch (error) {
          logWarn('ImportSpec.submitPasted', 'Invalid source URL provided, continuing without sourceUrl', { error, rawUrl })
        }
      }
      await importFromText(pasteText, sourceOrigin, normalizedUrl)
      pasteDialogRef.current?.close()
    } catch (e: any) {
      setPasteError(e?.message || 'Failed to import spec.')
    }
  }

  async function loadFromUrl() {
    setPasteError(null)
    setLoadingUrl(true)
    try {
      const url = sourceUrl.trim()
      if (!url) {
        setPasteError('Enter a URL first.')
        return
      }

      const loaded = await loadImportSourceFromUrl(url)
      const text = loaded.text
      setPasteText(text)
      setSourceOrigin(loaded.origin)
      if (!text.trim()) setPasteError('Response is empty.')
      setTimeout(() => pasteTextareaRef.current?.focus(), 0)
    } catch (e: any) {
      setPasteError(e?.message || 'Failed to load from URL.')
      setSourceOrigin(undefined)
    } finally {
      setLoadingUrl(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Collection name"
      />
      <input type="file" accept=".json,.yaml,.yml,.wsdl,.xml" onChange={onFile} />
      <button onClick={openPasteDialog}>Paste</button>
      {error && (
        <span className="small" style={{ color: '#ff9a9a' }}>
          {error}
        </span>
      )}

      <dialog ref={pasteDialogRef} className="modal">
        <div className="modalHeader">
          <b>Import from text</b>
          <button onClick={() => pasteDialogRef.current?.close()}>Close</button>
        </div>

        <div className="small" style={{ marginBottom: 8 }}>
          Paste OpenAPI/Swagger JSON or YAML. Local refs like{' '}
          <span className="mono">#/components/...</span> are supported.
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:10, marginBottom: 10}}>
          <input
            className="mono"
            value={sourceUrl}
            onChange={e => setSourceUrl(e.target.value)}
            placeholder="https://example.com/openapi.json"
          />
          <button onClick={loadFromUrl} disabled={loadingUrl}>
            {loadingUrl ? 'Loading...' : 'Load URL'}
          </button>
        </div>

        <textarea
          className="mono modalTextarea"
          ref={pasteTextareaRef}
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitPasted()
          }}
          placeholder="Paste JSON/YAML here..."
        />

        {pasteError && (
          <div className="small" style={{ color: '#ff9a9a', marginTop: 8 }}>
            {pasteError}
          </div>
        )}

        <div className="modalActions">
          <button onClick={pasteFromClipboard} disabled={!canReadClipboard} title={!canReadClipboard ? 'Unavailable without a secure context (https/localhost) and permissions' : undefined}>
            Paste from clipboard
          </button>
          <button onClick={submitPasted}>Import</button>
        </div>
      </dialog>
    </div>
  )
}
