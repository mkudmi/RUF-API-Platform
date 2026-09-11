import { useEffect, useState } from 'react'
import { forgetSystemClientTlsBinding, getSystemClientTlsBindings, SYSTEM_CLIENT_TLS_CHANGED } from '../../../shared/utils/systemClientTls'

export function SystemClientTlsSettings() {
  const [bindings, setBindings] = useState(getSystemClientTlsBindings)
  useEffect(() => {
    const refresh = () => setBindings(getSystemClientTlsBindings())
    window.addEventListener(SYSTEM_CLIENT_TLS_CHANGED, refresh)
    return () => window.removeEventListener(SYSTEM_CLIENT_TLS_CHANGED, refresh)
  }, [])

  return (
    <div className="settingsTableRow settingsCertsRow">
      <div className="settingsTableLabel">System Client TLS</div>
      <div className="settingsTableValue settingsCertsCell">
        <div style={{ display: 'grid', gap: 8 }}>
          <span className="small">
            On Windows, Ruf asks you to choose a certificate when an API requests one.
            Your choice is remembered for that HTTPS host and port. Private keys stay in Windows.
          </span>
          {bindings.length === 0 ? <span className="small">No saved choices.</span> : bindings.map(binding => (
            <div key={binding.origin} className="settingsSplitRow" style={{ alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ overflowWrap: 'anywhere' }}>{binding.origin}</div>
                <span className="small" title={binding.thumbprint}>{binding.thumbprint.slice(0, 16)}…</span>
              </div>
              <button type="button" className="terminalAddBtn" onClick={() => forgetSystemClientTlsBinding(binding.origin)} aria-label={`Forget certificate for ${binding.origin}`}>
                Forget
              </button>
            </div>
          ))}
          <span className="small" style={{ opacity: 0.75 }}>
            Forget a choice to select again on the next request. System TLS uses Windows trusted CAs; generated cURL requires Schannel.
          </span>
          <span className="small" style={{ opacity: 0.75 }}>
            Automatic selection applies when no PFX/P12 identity or app CA override is configured. For system TLS, trust the API's CA in Windows.
          </span>
        </div>
      </div>
    </div>
  )
}
