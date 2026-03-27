import type { ChangeEvent, RefObject } from 'react'
import { CloseIcon } from '../../../shared/icons'

type EditClientTlsIdentityDialogProps = {
  dialogRef: RefObject<HTMLDialogElement | null>
  fileName: string
  password: string
  error: string | null
  busy: boolean
  onPasswordChange: (value: string) => void
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onClose: () => void
  onSubmit: () => void
}

export function EditClientTlsIdentityDialog(props: EditClientTlsIdentityDialogProps) {
  return (
    <dialog
      ref={props.dialogRef}
      className="modal modalSmall"
      onClick={event => {
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
      <div className="modalHeader">
        <b>Client TLS identity</b>
        <button className="iconBtn" onClick={props.onClose} aria-label="Close" title="Close"><CloseIcon size={18} /></button>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div className="small" style={{ opacity: 0.8 }}>
          Upload a client certificate container in PFX or P12 format. This is used for mTLS access.
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div className="small" style={{ opacity: 0.8 }}>Certificate file (.pfx / .p12)</div>
          <input
            type="file"
            accept=".pfx,.p12,application/x-pkcs12"
            onChange={props.onFileChange}
          />
          <div className="small mono" style={{ opacity: props.fileName ? 0.9 : 0.55 }}>
            {props.fileName || 'No file selected'}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div className="small" style={{ opacity: 0.8 }}>Password</div>
          <input
            className="mono"
            type="password"
            value={props.password}
            onChange={event => props.onPasswordChange(event.target.value)}
            placeholder="PFX password"
            autoComplete="off"
            style={{
              width: '100%',
              padding: 10,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,.12)',
              background: 'rgba(255,255,255,.04)',
              color: 'inherit',
            }}
          />
        </div>

        {props.error ? <div className="small" style={{ color: '#ff9a9a' }}>{props.error}</div> : null}
      </div>

      <div className="modalActions">
        <button onClick={props.onClose} disabled={props.busy}>Cancel</button>
        <button onClick={props.onSubmit} disabled={props.busy || !props.fileName}>
          {props.busy ? 'Saving...' : 'Save'}
        </button>
      </div>
    </dialog>
  )
}
