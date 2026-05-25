import { useState } from 'react'
import type { AiProviderSettings } from '../../../shared/utils/appSettings'
import { testYandexAiStudioConnection } from '../provider'

type Props = {
  value: AiProviderSettings
  onChange: (next: AiProviderSettings | ((prev: AiProviderSettings) => AiProviderSettings)) => void
}

export function AiSettingsTab(props: Props) {
  const [testBusy, setTestBusy] = useState(false)
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  async function runTest() {
    setTestBusy(true)
    setTestMessage(null)
    setTestError(null)
    try {
      const message = await testYandexAiStudioConnection(props.value)
      setTestMessage(message)
    } catch (error) {
      setTestError(error instanceof Error ? error.message : String(error))
    } finally {
      setTestBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="small">
        Yandex AI Studio uses the OpenAI-compatible API.
        Paste your API key into the <span className="mono">API Key</span> field below.
        <br />
        <span className="mono">Folder ID</span> is the Yandex Cloud catalog identifier used in the <span className="mono">OpenAI-Project</span> header.
        It usually looks like <span className="mono">b1g...</span>.
        <br />
        The key is currently stored in local app settings.
      </div>

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
              <span>Allow AI assistant in response search</span>
            </label>
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">Provider</div>
          <div className="settingsTableValue">
            <input value="Yandex AI Studio" readOnly />
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">Base URL</div>
          <div className="settingsTableValue">
            <input
              className="mono"
              value={props.value.baseUrl}
              onChange={e => props.onChange(prev => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://ai.api.cloud.yandex.net/v1"
            />
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">Folder ID</div>
          <div className="settingsTableValue">
            <input
              className="mono"
              value={props.value.folderId}
              onChange={e => props.onChange(prev => ({ ...prev, folderId: e.target.value }))}
              placeholder="b1g..."
            />
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">API Key</div>
          <div className="settingsTableValue">
            <input
              className="mono"
              type="password"
              value={props.value.apiKey}
              onChange={e => props.onChange(prev => ({ ...prev, apiKey: e.target.value }))}
              placeholder="AQVN..."
            />
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">Model</div>
          <div className="settingsTableValue">
            <input
              className="mono"
              value={props.value.model}
              onChange={e => props.onChange(prev => ({ ...prev, model: e.target.value }))}
              placeholder="qwen3.6-35b-a3b"
            />
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">Temperature</div>
          <div className="settingsTableValue">
            <input
              className="mono"
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={props.value.temperature}
              onChange={e => props.onChange(prev => ({ ...prev, temperature: Number(e.target.value || 0) }))}
            />
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">Max Output Tokens</div>
          <div className="settingsTableValue">
            <input
              className="mono"
              type="number"
              min="64"
              max="16384"
              step="1"
              value={props.value.maxCompletionTokens}
              onChange={e => props.onChange(prev => ({ ...prev, maxCompletionTokens: Number(e.target.value || 0) }))}
            />
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">Timeout (ms)</div>
          <div className="settingsTableValue">
            <input
              className="mono"
              type="number"
              min="1000"
              max="300000"
              step="1000"
              value={props.value.timeoutMs}
              onChange={e => props.onChange(prev => ({ ...prev, timeoutMs: Number(e.target.value || 0) }))}
            />
          </div>
        </div>
      </div>

      <div className="settingsActionRow" style={{ justifyContent: 'space-between' }}>
        <div className="small" style={{ opacity: 0.7 }}>
          Example model URI: <span className="mono">gpt://&lt;folderId&gt;/qwen3.6-35b-a3b</span>
          <br />
          You can find the folder ID in Yandex Cloud console on the folder page, in folder info, or in the URL.
        </div>
        <button onClick={() => void runTest()} disabled={testBusy}>
          {testBusy ? 'Testing...' : 'Test connection'}
        </button>
      </div>

      {testMessage ? <div className="small" style={{ color: '#7ee0a1' }}>{testMessage}</div> : null}
      {testError ? <div className="small" style={{ color: '#ff9a9a', whiteSpace: 'pre-wrap' }}>{testError}</div> : null}
    </div>
  )
}
