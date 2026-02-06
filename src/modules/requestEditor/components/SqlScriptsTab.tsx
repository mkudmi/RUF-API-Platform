import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CloseIcon, CopyIcon } from '../../../shared/icons'
import { copyText } from '../../../shared/utils/clipboard'

type SqlConnectionOption = {
  id: string
  label: string
  connectionPreview: string
}

function ConfirmIconButton(props: {
  className: string
  onConfirm: () => void
  disabled?: boolean
  ariaLabel: string
  confirmAriaLabel?: string
  title?: string
  confirmTitle?: string
  icon: ReactNode
  timeoutMs?: number
  style?: React.CSSProperties
}) {
  const timeoutMs = props.timeoutMs ?? 5500
  const [armed, setArmed] = useState(false)
  const timerRef = useRef<number | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!armed) return
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setArmed(false), timeoutMs)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [armed, timeoutMs])

  useEffect(() => {
    if (!armed) return

    function onGlobalPointerDown(e: PointerEvent) {
      const el = btnRef.current
      if (!el) return
      const target = e.target as Node | null
      if (target && el.contains(target)) return
      setArmed(false)
    }

    window.addEventListener('pointerdown', onGlobalPointerDown, true)
    return () => window.removeEventListener('pointerdown', onGlobalPointerDown, true)
  }, [armed])

  return (
    <button
      type="button"
      className={`${props.className} ${armed ? 'confirmActionArmed' : ''}`.trim()}
      disabled={props.disabled}
      aria-disabled={props.disabled}
      aria-label={armed ? (props.confirmAriaLabel ?? props.ariaLabel) : props.ariaLabel}
      title={armed ? (props.confirmTitle ?? props.title) : props.title}
      ref={btnRef}
      style={props.style}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        if (props.disabled) return
        if (!armed) {
          setArmed(true)
          return
        }
        setArmed(false)
        props.onConfirm()
      }}
    >
      {armed ? <span className="confirmActionGlyph">!</span> : props.icon}
    </button>
  )
}

export function SqlScriptsTab(props: {
  sqlConnections: SqlConnectionOption[]
  selectedSqlConnectionId: string | null
  onChangeSqlConnectionId: (next: string | null) => void
  preSqlScript: string
  postSqlScript: string
  onChangePreSqlScript: (next: string) => void
  onChangePostSqlScript: (next: string) => void
}) {
  const [preSqlCopied, setPreSqlCopied] = useState(false)
  const [postSqlCopied, setPostSqlCopied] = useState(false)
  const [connMenuOpen, setConnMenuOpen] = useState(false)
  const connMenuWrapRef = useRef<HTMLDivElement | null>(null)

  const canCopyPre = !!props.preSqlScript.trim()
  const canCopyPost = !!props.postSqlScript.trim()
  const selectedConn = props.sqlConnections.find(x => x.id === props.selectedSqlConnectionId) ?? null
  const selectedConnLabel = selectedConn
    ? `${selectedConn.label}: ${selectedConn.connectionPreview}`
    : (props.sqlConnections.length ? 'Select DB…' : 'No DB connections')

  useEffect(() => {
    if (!connMenuOpen) return

    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null
      const wrap = connMenuWrapRef.current
      if (t && wrap && wrap.contains(t)) return
      setConnMenuOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setConnMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [connMenuOpen])

  return (
    <div className="accordion">
      <div className="section">
        <div ref={connMenuOpen ? connMenuWrapRef : null} className="selectMenuWrap" style={{ maxWidth: '100%' }}>
          <button
            type="button"
            className="selectMenuBtn mono"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              if (!props.sqlConnections.length) return
              setConnMenuOpen(v => !v)
            }}
            aria-haspopup="menu"
            aria-expanded={connMenuOpen}
            aria-label="Database connection"
            title={selectedConn?.connectionPreview ?? 'Database connection'}
          >
            {selectedConnLabel}
          </button>

          {connMenuOpen ? (
            <div
              className="selectMenuPanel"
              role="menu"
              onPointerDown={e => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              {props.sqlConnections.map(o => (
                <button
                  key={o.id}
                  type="button"
                  className={`selectMenuItem ${props.selectedSqlConnectionId === o.id ? 'selectMenuItemActive' : ''}`}
                  role="menuitem"
                  title={o.connectionPreview}
                  onClick={() => {
                    setConnMenuOpen(false)
                    props.onChangeSqlConnectionId(o.id)
                  }}
                >
                  <span className="mono">{o.label}</span>
                  <span style={{ opacity: 0.75 }}>{` — ${o.connectionPreview}`}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="formLabel mono" style={{ marginBottom: 0 }}>Pre Script</div>
            <button
              type="button"
              className="iconBtn"
              onClick={async () => {
                await copyText(props.preSqlScript)
                setPreSqlCopied(true)
                setTimeout(() => setPreSqlCopied(false), 900)
              }}
              disabled={!canCopyPre}
              aria-disabled={!canCopyPre}
              aria-label="Copy pre script"
              title="Copy"
              style={{ width: 28, height: 28, marginLeft: 'auto' }}
            >
              {preSqlCopied ? 'OK' : <CopyIcon />}
            </button>
            <ConfirmIconButton
              className="iconBtn"
              onConfirm={() => props.onChangePreSqlScript('')}
              ariaLabel="Clear pre script"
              confirmAriaLabel="Confirm clear pre script"
              title={canCopyPre ? 'Clear' : 'Clear (empty)'}
              confirmTitle="Confirm clear"
              style={{ width: 28, height: 28 }}
              icon={<CloseIcon size={18} />}
            />
          </div>
          <textarea
            className="mono"
            rows={5}
            value={props.preSqlScript}
            onChange={e => props.onChangePreSqlScript(e.target.value)}
            placeholder="SQL to run before Send"
            style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="formLabel mono" style={{ marginBottom: 0 }}>Post Script</div>
            <button
              type="button"
              className="iconBtn"
              onClick={async () => {
                await copyText(props.postSqlScript)
                setPostSqlCopied(true)
                setTimeout(() => setPostSqlCopied(false), 900)
              }}
              disabled={!canCopyPost}
              aria-disabled={!canCopyPost}
              aria-label="Copy post script"
              title="Copy"
              style={{ width: 28, height: 28, marginLeft: 'auto' }}
            >
              {postSqlCopied ? 'OK' : <CopyIcon />}
            </button>
            <ConfirmIconButton
              className="iconBtn"
              onConfirm={() => props.onChangePostSqlScript('')}
              ariaLabel="Clear post script"
              confirmAriaLabel="Confirm clear post script"
              title={canCopyPost ? 'Clear' : 'Clear (empty)'}
              confirmTitle="Confirm clear"
              style={{ width: 28, height: 28 }}
              icon={<CloseIcon size={18} />}
            />
          </div>
          <textarea
            className="mono"
            rows={5}
            value={props.postSqlScript}
            onChange={e => props.onChangePostSqlScript(e.target.value)}
            placeholder="SQL to run after Send"
            style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>
      </div>
    </div>
  )
}
