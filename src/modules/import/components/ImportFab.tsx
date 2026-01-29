import { useEffect, useRef, useState } from 'react'
import type { Collection } from '../../collectionTree'
import { buildImportedCollectionFromText } from '../buildImportedCollection'
import { fetchWithProxyFallback } from '../../../shared/utils/proxyFetch'
import { loadAppSettings } from '../../../shared/utils/appSettings'
import { isTauri } from '../../../shared/utils/tauri'

export function ImportFab(props: {
  onImported: (c: Collection) => void
  variant?: 'fab' | 'button'
  label?: string
  showTrigger?: boolean
  openRef?: React.MutableRefObject<(() => void) | null>
}) {
  const menuRef = useRef<HTMLDialogElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const variant = props.variant ?? 'fab'
  const label = props.label ?? 'Импорт'
  const showTrigger = props.showTrigger ?? true

  const [view, setView] = useState<'menu' | 'json' | 'url' | 'name'>('menu')
  const [menuError, setMenuError] = useState<string | null>(null)

  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const [specUrl, setSpecUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [loadingUrl, setLoadingUrl] = useState(false)

  const [pendingCollection, setPendingCollection] = useState<Collection | null>(null)
  const [pendingName, setPendingName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)

  async function importFromText(text: string, origin?: string) {
    return buildImportedCollectionFromText({ text, sourceOrigin: origin })
  }

  function openNameStep(col: Collection) {
    setPendingCollection(col)
    setPendingName(col.name ?? '')
    setNameError(null)
    setView('name')
  }

  function confirmAddCollection() {
    const col = pendingCollection
    if (!col) return

    const name = pendingName.trim()
    if (!name) {
      setNameError('Введите имя коллекции.')
      return
    }

    props.onImported({ ...col, name })
    closeMenu()
  }

  function openMenu() {
    setView('menu')
    setMenuError(null)
    menuRef.current?.showModal()
  }

  useEffect(() => {
    if (!props.openRef) return
    props.openRef.current = openMenu
    return () => {
      props.openRef!.current = null
    }
  }, [props.openRef])

  function closeMenu() {
    menuRef.current?.close()
    setView('menu')
    setMenuError(null)
    setPendingCollection(null)
    setPendingName('')
    setNameError(null)
  }

  function chooseFile() {
    setMenuError(null)
    fileInputRef.current?.click()
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const col = await importFromText(text)
      openNameStep({ ...col, sourceType: 'file', sourceFileName: file.name })
    } catch (err: any) {
      setMenuError(err?.message || 'Не удалось импортировать файл.')
    } finally {
      e.target.value = ''
    }
  }

  function openJson() {
    setMenuError(null)
    setJsonError(null)
    setJsonText('')
    setView('json')
  }

  async function importJson() {
    setJsonError(null)
    try {
      if (!jsonText.trim()) {
        setJsonError('Вставь JSON/YAML спеки.')
        return
      }
      const col = await importFromText(jsonText)
      openNameStep(col)
    } catch (e: any) {
      setJsonError(e?.message || 'Не удалось импортировать.')
    }
  }

  function openUrl() {
    setMenuError(null)
    setUrlError(null)
    setSpecUrl('')
    setView('url')
  }

  async function importUrl() {
    setUrlError(null)
    setLoadingUrl(true)
    try {
      const raw = specUrl.trim()
      if (!raw) {
        setUrlError('Введи URL.')
        return
      }
      const u = new URL(raw)
      const { validateCertificates } = loadAppSettings()
      const res = await fetchWithProxyFallback(u.toString(), undefined, { insecureTls: !validateCertificates })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const text = await res.text()
      if (!text.trim()) {
        setUrlError('Пустой ответ.')
        return
      }
      const col = await importFromText(text, u.origin)
      openNameStep({ ...col, sourceUrl: u.toString(), sourceType: 'url' })
    } catch (e: any) {
      setUrlError(e?.message || (isTauri() ? 'Не удалось загрузить по URL.' : 'Не удалось загрузить по URL (проверь CORS).'))
    } finally {
      setLoadingUrl(false)
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.yaml,.yml"
        style={{ display: 'none' }}
        onChange={onFileSelected}
      />

      {showTrigger ? (
        variant === 'button' ? (
          <button onClick={openMenu}>{label}</button>
        ) : (
          <button className="fab" onClick={openMenu} aria-label="Import">
            <span className="fabIcon">+</span>
          </button>
        )
      ) : null}

      <dialog ref={menuRef} className={variant === 'button' ? 'modal modalSmall' : 'modal fabMenu'}>
        <div className="modalHeader">
          <b>{view === 'name' ? 'Добавить коллекцию' : 'Import'}</b>
          <button className="iconBtn" onClick={closeMenu} aria-label="Close">✕</button>
        </div>

        {view === 'menu' && (
          <>
            <div style={{ display: 'grid', gap: 10 }}>
              <button onClick={chooseFile}>Choose File</button>
              <button onClick={openJson}>Import from JSON</button>
              <button onClick={openUrl}>Import from URL</button>
            </div>
            {menuError && (
              <div className="small" style={{ color: '#ff9a9a', marginTop: 8 }}>
                {menuError}
              </div>
            )}
          </>
        )}

        {view === 'json' && (
          <>
            <textarea
              className="mono modalTextarea"
              value={jsonText}
              onChange={e => setJsonText(e.target.value)}
              placeholder="Paste OpenAPI JSON/YAML..."
            />
            {jsonError && <div className="small" style={{ color: '#ff9a9a', marginTop: 8 }}>{jsonError}</div>}
            <div className="modalActions">
              <button onClick={() => setView('menu')}>Back</button>
              <button onClick={importJson}>Import</button>
            </div>
          </>
        )}

        {view === 'url' && (
          <>
            <div className="small" style={{ marginBottom: 8 }}>
              Enter the spec URL
            </div>
            <input
              className="mono"
              style={{ width: '100%' }}
              value={specUrl}
              onChange={e => setSpecUrl(e.target.value)}
              placeholder="https://example.com/openapi.json"
            />
            {urlError && <div className="small" style={{ color: '#ff9a9a', marginTop: 8 }}>{urlError}</div>}
            <div className="modalActions">
              <button onClick={() => setView('menu')}>Back</button>
              <button onClick={importUrl} disabled={loadingUrl}>
                {loadingUrl ? 'Loading...' : 'Import'}
              </button>
            </div>
          </>
        )}

        {view === 'name' && (
          <form
            onSubmit={e => {
              e.preventDefault()
              confirmAddCollection()
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <div className="small">Collection Name</div>
              <input
                style={{ width: '100%' }}
                value={pendingName}
                onChange={e => setPendingName(e.target.value)}
                onFocus={e => e.currentTarget.select()}
                autoFocus
                placeholder="My API"
              />
            </div>

            {nameError && <div className="small" style={{ color: '#ff9a9a', marginTop: 8 }}>{nameError}</div>}

            <div className="modalActions">
              <button type="submit">Add Collection</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  )
}
