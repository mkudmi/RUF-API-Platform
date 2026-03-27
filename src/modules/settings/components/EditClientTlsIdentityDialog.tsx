import type { RefObject } from 'react'
import { CloseIcon } from '../../../shared/icons'

type EditClientTlsIdentityDialogProps = {
  dialogRef: RefObject<HTMLDialogElement | null>
  certValue: string
  keyValue: string
  onCertChange: (value: string) => void
  onKeyChange: (value: string) => void
  error: string | null
  busy: boolean
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
          Paste the client certificate and private key in PEM format. This is used for mTLS access.
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="small" style={{ opacity: 0.8 }}>Certificate (PEM)</div>
          <textarea
            className="mono"
            value={props.certValue}
            onChange={event => props.onCertChange(event.target.value)}
            placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
            spellCheck={false}
            style={{
              width: '100%',
              minHeight: 140,
              resize: 'vertical',
              padding: 10,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,.12)',
              background: 'rgba(255,255,255,.04)',
              color: 'inherit',
            }}
          />
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="small" style={{ opacity: 0.8 }}>Private key (PEM)</div>
          <textarea
            className="mono"
            value={props.keyValue}
            onChange={event => props.onKeyChange(event.target.value)}
            placeholder={'-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
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
        </div>
        {props.error ? <div className="small" style={{ color: '#ff9a9a' }}>{props.error}</div> : null}
      </div>

      <div className="modalActions">
        <button onClick={props.onClose} disabled={props.busy}>Cancel</button>
        <button onClick={props.onSubmit} disabled={props.busy || !props.certValue.trim() || !props.keyValue.trim()}>
          {props.busy ? 'Saving...' : 'Save'}
        </button>
      </div>
    </dialog>
  )
}
