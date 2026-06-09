import { useEffect, useRef } from 'react'
import { CloseIcon, StarIcon } from '../../../../shared/icons'
import { FileTextCodeEditor } from '../editors/FileTextCodeEditor'
import type { BeautifyBodyFormat } from '../../utils/bodyBeautify'

type Props = {
  open: boolean
  fileName: string
  value: string
  format: BeautifyBodyFormat | null
  errorMessage?: string
  saveScopeLabel?: string
  busy?: boolean
  canBeautify?: boolean
  onChange: (next: string) => void
  onBeautify?: () => void
  onSave: () => void
  onClose: () => void
}

export function RequestEditorFileEditDialog(props: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (props.open) {
      if (!dialog.open) dialog.showModal()
      return
    }

    if (dialog.open) dialog.close()
  }, [props.open])

  useEffect(() => {
    if (!props.open) return

    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        props.onSave()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        props.onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [props.onClose, props.onSave, props.open])

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      onClose={props.onClose}
      onClick={event => {
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
      <div className="modalHeader">
        <div style={{ minWidth: 0 }}>
          <b>Edit File</b>
          <div className="small mono" style={{ marginTop: 4, opacity: 0.78, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {props.fileName || 'Untitled file'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {props.canBeautify ? (
            <button
              className="iconBtn"
              type="button"
              onClick={props.onBeautify}
              aria-label="Beautify file"
              title="Beautify file"
            >
              <StarIcon size={16} />
            </button>
          ) : null}
          <button className="iconBtn" type="button" onClick={props.onClose} aria-label="Close" title="Close">
            <CloseIcon size={18} />
          </button>
        </div>
      </div>

      <div className="small" style={{ marginBottom: 10, opacity: 0.82 }}>
        Save updates {props.saveScopeLabel ?? 'the file used for this request'}.
      </div>

      <FileTextCodeEditor
        value={props.value}
        format={props.format}
        minHeight={360}
        onChangeValue={props.onChange}
      />

      {props.errorMessage ? (
        <div className="small" style={{ marginTop: 10, color: '#ff9f9f' }}>
          {props.errorMessage}
        </div>
      ) : null}

      <div className="modalActions">
        <button type="button" onClick={props.onClose}>Close</button>
        <button type="button" onClick={props.onSave} disabled={!!props.busy}>
          {props.busy ? 'Saving...' : 'Save'}
        </button>
      </div>
    </dialog>
  )
}
