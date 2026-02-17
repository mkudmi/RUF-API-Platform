import { useEffect } from 'react'
import { CloseIcon } from '../../../shared/icons'

type Props = {
  open: boolean
  value: string
  onChange: (next: string) => void
  onSave: () => void
  onCloseAndSave: () => void
}

export function DataDrivenInputEditorSheet(props: Props) {
  const { open, value, onChange, onSave, onCloseAndSave } = props

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onCloseAndSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCloseAndSave, open])

  if (!open) return null

  return (
    <>
      <button
        type="button"
        className="dataRunInputEditorBackdrop"
        onClick={onCloseAndSave}
        aria-label="Close data input editor"
      />
      <div className="dataRunInputEditorPanel">
        <div className="modalHeader" style={{ marginBottom: 8 }}>
          <b>Data Input Editor</b>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onSave}
              style={{
                height: 32,
                minHeight: 32,
                boxSizing: 'border-box',
                padding: '0 10px',
                lineHeight: '32px',
              }}
            >
              Save
            </button>
            <button type="button" className="iconBtn" onClick={onCloseAndSave} aria-label="Close" title="Close">
              <CloseIcon size={18} />
            </button>
          </div>
        </div>

        <textarea
          className="mono"
          spellCheck={false}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={'[{"userId":"1","token":"abc"},{"userId":"2","token":"def"}]\n\nuserId,token\n1,abc\n2,def'}
          style={{
            width: '100%',
            height: '100%',
            minHeight: 0,
            resize: 'none',
            borderRadius: 'var(--radius)',
            border: '1px solid rgba(255,255,255,.12)',
            background: 'rgba(255,255,255,.04)',
            padding: '10px 12px',
          }}
        />
      </div>
    </>
  )
}
