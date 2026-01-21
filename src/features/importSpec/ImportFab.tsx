import { useRef, useState } from 'react'
import type { Collection } from '../../shared/types/collection'
import { buildImportedCollectionFromText } from './buildImportedCollection'
import { fetchWithProxyFallback } from '../../shared/utils/proxyFetch'
import { loadAppSettings } from '../../shared/utils/appSettings'

export function ImportFab(props: {
  onImported: (c: Collection) => void
  variant?: 'fab' | 'button'
  label?: string
}) {
  const menuRef = useRef<HTMLDialogElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const variant = props.variant ?? 'fab'
  const label = props.label ?? 'Импорт'

  const [view, setView] = useState<'menu' | 'json' | 'url'>('menu')
  const [menuError, setMenuError] = useState<string | null>(null)

  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const [specUrl, setSpecUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [loadingUrl, setLoadingUrl] = useState(false)

  async function importFromText(text: string, origin?: string) {
    const col = await buildImportedCollectionFromText({ text, sourceOrigin: origin })
    props.onImported(col)
  }

  function openMenu() {
    setView('menu')
    setMenuError(null)
    menuRef.current?.showModal()
  }

  function closeMenu() {
    menuRef.current?.close()
    setView('menu')
    setMenuError(null)
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
      await importFromText(text)
      closeMenu()
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
      await importFromText(jsonText)
      closeMenu()
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
      const col = await buildImportedCollectionFromText({ text, sourceOrigin: u.origin })
      props.onImported({ ...col, sourceUrl: u.toString() })
      closeMenu()
    } catch (e: any) {
      setUrlError(e?.message || 'Не удалось загрузить по URL (проверь CORS).')
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

      {variant === 'button' ? (
        <button onClick={openMenu}>{label}</button>
      ) : (
        <button className="fab" onClick={openMenu} aria-label="Import">
          <span className="fabIcon">+</span>
        </button>
      )}

      <dialog ref={menuRef} className={variant === 'button' ? 'modal modalSmall' : 'modal fabMenu'}>
        <div className="modalHeader">
          <b>Импорт</b>
          <button className="iconBtn" onClick={closeMenu} aria-label="Close">✕</button>
        </div>

        {view === 'menu' && (
          <>
            <div style={{ display: 'grid', gap: 10 }}>
              <button onClick={chooseFile}>Выбрать файл</button>
              <button onClick={openJson}>Импорт из json</button>
              <button onClick={openUrl}>Импорт из url</button>
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
            <div className="small" style={{ marginBottom: 8 }}>
              Вставь OpenAPI JSON/YAML и нажми импорт.
            </div>
            <textarea
              className="mono modalTextarea"
              value={jsonText}
              onChange={e => setJsonText(e.target.value)}
              placeholder="Вставь OpenAPI JSON/YAML..."
            />
            {jsonError && <div className="small" style={{ color: '#ff9a9a', marginTop: 8 }}>{jsonError}</div>}
            <div className="modalActions">
              <button onClick={() => setView('menu')}>Назад</button>
              <button onClick={importJson}>Импорт</button>
            </div>
          </>
        )}

        {view === 'url' && (
          <>
            <div className="small" style={{ marginBottom: 8 }}>
              Введи URL спеки. Импорт сработает только если сервер отдаёт файл с CORS.
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
              <button onClick={() => setView('menu')}>Назад</button>
              <button onClick={importUrl} disabled={loadingUrl}>
                {loadingUrl ? 'Загрузка...' : 'Импорт'}
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  )
}
