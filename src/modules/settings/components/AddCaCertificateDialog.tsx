import type { RefObject } from 'react'
import { CloseIcon } from '../../../shared/icons'

type AddCaCertificateDialogProps = {
  dialogRef: RefObject<HTMLDialogElement | null>
  inputValue: string
  onInputChange: (value: string) => void
  error: string | null
  busy: boolean
  onClose: () => void
  onSubmit: () => void
}

export function AddCaCertificateDialog(props: AddCaCertificateDialogProps) {
  return (
    <dialog
      ref={props.dialogRef}
      className="modal modalSmall"
      onClick={event => {
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
      <div className="modalHeader">
        <b>Add CA certificate</b>
        <button className="iconBtn" onClick={props.onClose} aria-label="Close" title="Close"><CloseIcon size={18} /></button>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div className="small" style={{ opacity: 0.8 }}>
          Paste PEM certificate(s)
        </div>
        <textarea
          className="mono"
          value={props.inputValue}
          onChange={event => props.onInputChange(event.target.value)}
          placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
          spellCheck={false}
          style={{
            width: '100%',
            minHeight: 160,
            resize: 'vertical',
            padding: 10,
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,.12)',
            background: 'rgba(255,255,255,.04)',
            color: 'inherit',
          }}
        />
        {props.error ? <div className="small" style={{ color: '#ff9a9a' }}>{props.error}</div> : null}
      </div>

      <div className="modalActions">
        <button onClick={props.onClose} disabled={props.busy}>Cancel</button>
        <button onClick={props.onSubmit} disabled={props.busy || !props.inputValue.trim()}>
          {props.busy ? 'Adding...' : 'Add'}
        </button>
      </div>
    </dialog>
  )
}
