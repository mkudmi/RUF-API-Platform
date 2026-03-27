import { BroomIcon, CloseIcon } from '../../../shared/icons'
import type { CaCertificate, ClientTlsIdentity } from '../../../shared/utils/appSettings'

type GeneralSettingsPanelProps = {
  requestTimeoutSec: number | null
  disableRequestTimeout: boolean
  onRequestTimeoutChange: (value: number | null) => void
  onDisableRequestTimeoutChange: (value: boolean) => void
  validateCertificates: boolean
  onValidateCertificatesChange: (value: boolean) => void
  caCertificates: CaCertificate[]
  clientTlsIdentity: ClientTlsIdentity | null
  onOpenCaCertDialog: () => void
  onOpenClientTlsDialog: () => void
  onClearClientTlsIdentity: () => void
  onDeleteCaCertificate: (id: string) => void
  cacheSizeLabel: string
  onClearAppCache: () => void
  canClearAppCache: boolean
}

export function GeneralSettingsPanel(props: GeneralSettingsPanelProps) {
  return (
    <div className="settingsTable">
      <div className="settingsTableRow">
        <div className="settingsTableLabel">Request timeout</div>
        <div className="settingsTableValue settingsTimeoutCell">
          <div className={`settingsTimeoutFieldWrap${props.disableRequestTimeout ? ' settingsTimeoutFieldWrapDisabled' : ''}`}>
            <input
              className="mono settingsTimeoutInput settingsTimeoutField"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={3}
              placeholder="30s"
              disabled={props.disableRequestTimeout}
              value={props.requestTimeoutSec === null ? '' : String(props.requestTimeoutSec)}
              onChange={event => {
                const raw = event.target.value
                const digits = raw.replaceAll(/\D+/g, '').slice(0, 3)
                if (!digits) {
                  props.onRequestTimeoutChange(null)
                  return
                }
                const nextValue = Number(digits)
                props.onRequestTimeoutChange(Math.max(1, Math.min(600, Math.round(nextValue))))
              }}
            />
          </div>
          <label className="checkRow settingsTimeoutToggle">
            <input
              type="checkbox"
              className="checkInput"
              checked={props.disableRequestTimeout}
              onChange={event => props.onDisableRequestTimeoutChange(event.target.checked)}
            />
            <span className="checkBox" aria-hidden="true" />
            <span>No timeout</span>
          </label>
        </div>
      </div>

      <div className="settingsTableRow">
        <div className="settingsTableLabel">TLS validation</div>
        <div className="settingsTableValue">
          <label className="checkRow">
            <input
              type="checkbox"
              className="checkInput"
              checked={props.validateCertificates}
              onChange={event => props.onValidateCertificatesChange(event.target.checked)}
            />
            <span className="checkBox" aria-hidden="true" />
            <span className="checkText">Validate certificates</span>
          </label>
        </div>
      </div>

      <div className="settingsTableRow settingsCertsRow">
        <div className="settingsTableLabel">CA certificates</div>
        <div className="settingsTableValue settingsCertsCell">
          <div className="settingsCertsInlineRow">
            {!props.caCertificates.length ? (
              <div className="settingsCertsEmpty">No custom CA certificates.</div>
            ) : (
              <div className="settingsCertsScroller">
                {props.caCertificates.map(cert => {
                  const title = cert.subject || 'Certificate'
                  return (
                    <div key={cert.id} className="settingsCertChip" title={title}>
                      <span className="settingsCertChipText">{title}</span>
                      <button
                        type="button"
                        className="settingsCertChipDelete"
                        onClick={() => props.onDeleteCaCertificate(cert.id)}
                        aria-label="Delete certificate"
                        title="Delete"
                      >
                        <CloseIcon size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <button
              type="button"
              className="terminalAddBtn"
              onClick={props.onOpenCaCertDialog}
              aria-label="Add CA certificate"
              title="Add CA certificate"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="settingsTableRow settingsCertsRow">
        <div className="settingsTableLabel">Client TLS</div>
        <div className="settingsTableValue settingsCertsCell">
          <div className="settingsSplitRow" style={{ alignItems: 'center' }}>
            <span className="small" style={{ opacity: 0.85 }}>
              {props.clientTlsIdentity ? 'Client PFX/P12 identity configured.' : 'No client TLS identity configured.'}
              {props.clientTlsIdentity?.fileName ? ` File: ${props.clientTlsIdentity.fileName}` : ''}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {props.clientTlsIdentity ? (
                <button
                  type="button"
                  className="iconBtn"
                  onClick={props.onClearClientTlsIdentity}
                  aria-label="Clear client TLS identity"
                  title="Clear client TLS identity"
                >
                  <CloseIcon size={14} />
                </button>
              ) : null}
              <button
                type="button"
                className="terminalAddBtn"
                onClick={props.onOpenClientTlsDialog}
                aria-label={props.clientTlsIdentity ? 'Edit client TLS identity' : 'Add client TLS identity'}
                title={props.clientTlsIdentity ? 'Edit client TLS identity' : 'Add client TLS identity'}
              >
                {props.clientTlsIdentity ? 'Edit' : '+'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="settingsTableRow">
        <div className="settingsTableLabel">Application cache</div>
        <div className="settingsTableValue">
          <div className="settingsSplitRow">
            <span className="small mono">{props.cacheSizeLabel}</span>
            <button
              type="button"
              className="iconBtn"
              onClick={props.onClearAppCache}
              disabled={!props.canClearAppCache}
              aria-label="Clear cache"
              title="Clear cache"
            >
              <BroomIcon size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
