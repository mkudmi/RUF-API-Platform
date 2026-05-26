import type { JiraIntegrationSettings } from '../../../shared/utils/appSettings'

type Props = {
  value: JiraIntegrationSettings
  onChange: (next: JiraIntegrationSettings | ((prev: JiraIntegrationSettings) => JiraIntegrationSettings)) => void
  testMessage: string | null
  testError: string | null
}

export function JiraSettingsTab(props: Props) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="settingsTable">
        <div className="settingsTableRow">
          <div className="settingsTableLabel">Enabled</div>
          <div className="settingsTableValue">
            <label className="checkRow">
              <input
                type="checkbox"
                className="checkInput"
                checked={props.value.enabled}
                onChange={e => props.onChange(prev => ({ ...prev, enabled: e.target.checked }))}
              />
              <span className="checkBox" aria-hidden="true" />
              <span>Enable Jira issue creation from Bug Report</span>
            </label>
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">Base URL</div>
          <div className="settingsTableValue">
            <input
              className="mono"
              value={props.value.baseUrl}
              onChange={e => props.onChange(prev => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://your-domain.atlassian.net"
            />
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">Email</div>
          <div className="settingsTableValue">
            <input
              className="mono"
              value={props.value.email}
              onChange={e => props.onChange(prev => ({ ...prev, email: e.target.value }))}
              placeholder="name@company.com"
            />
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">API Token</div>
          <div className="settingsTableValue">
            <input
              className="mono"
              type="password"
              value={props.value.apiToken}
              onChange={e => props.onChange(prev => ({ ...prev, apiToken: e.target.value }))}
              placeholder="ATATT..."
            />
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">Project Key</div>
          <div className="settingsTableValue">
            <input
              className="mono"
              value={props.value.projectKey}
              onChange={e => props.onChange(prev => ({ ...prev, projectKey: e.target.value.toUpperCase() }))}
              placeholder="QA"
            />
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">Issue Type</div>
          <div className="settingsTableValue">
            <input
              className="mono"
              value={props.value.issueType}
              onChange={e => props.onChange(prev => ({ ...prev, issueType: e.target.value }))}
              placeholder="Bug"
            />
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">Certificates</div>
          <div className="settingsTableValue">
            <label className="checkRow">
              <input
                type="checkbox"
                className="checkInput"
                checked={props.value.useTlsCertificates}
                onChange={e => props.onChange(prev => ({ ...prev, useTlsCertificates: e.target.checked }))}
              />
              <span className="checkBox" aria-hidden="true" />
              <span>Use app TLS certificates for Jira</span>
            </label>
          </div>
        </div>
      </div>

      <div className="small" style={{ opacity: 0.8 }}>
        When enabled, Jira uses the app-level CA certificates and personal P12/PFX identity from General settings. When disabled, Jira connects without them.
      </div>

      {props.testMessage ? <div className="small" style={{ color: '#7ee0a1' }}>{props.testMessage}</div> : null}
      {props.testError ? <div className="small" style={{ color: '#ff9a9a', whiteSpace: 'pre-wrap' }}>{props.testError}</div> : null}
    </div>
  )
}
