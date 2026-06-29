import type { AiProviderSettings } from '../../../shared/utils/appSettings'

type Props = {
  value: AiProviderSettings
  onChange: (next: AiProviderSettings | ((prev: AiProviderSettings) => AiProviderSettings)) => void
  testMessage: string | null
  testError: string | null
}

export function AiSettingsTab(props: Props) {
  const localCliArgsText = props.value.localCliArgs.join('\n')
  const isYandex = props.value.provider === 'yandex'

  function applyGigacodePreset() {
    props.onChange(prev => ({
      ...prev,
      localCliCommand: prev.localCliCommand.trim() || '~/.gigacode/bin/gigacode',
      localCliArgs: ['exec', '{{prompt}}'],
      localCliWorkingDir: prev.localCliWorkingDir.trim() || '~/.gigacode',
    }))
  }

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
              <span>Enable AI features across the app</span>
            </label>
          </div>
        </div>

        <div className="settingsTableRow">
          <div className="settingsTableLabel">Provider</div>
          <div className="settingsTableValue">
            <select
              value={props.value.provider}
              onChange={e => props.onChange(prev => ({ ...prev, provider: e.target.value === 'local-cli' ? 'local-cli' : 'yandex' }))}
            >
              <option value="yandex">Yandex AI Studio</option>
              <option value="local-cli">Local CLI</option>
            </select>
          </div>
        </div>

        {isYandex ? (
          <>
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
          </>
        ) : (
          <>
            <div className="settingsTableRow settingsTableRowTop">
              <div className="settingsTableLabel">CLI Command</div>
              <div className="settingsTableValue">
                <input
                  className="mono"
                  value={props.value.localCliCommand}
                  onChange={e => props.onChange(prev => ({ ...prev, localCliCommand: e.target.value }))}
                  placeholder="~/.gigacode/bin/gigacode"
                />
                <div style={{ marginTop: 8 }}>
                  <button type="button" onClick={applyGigacodePreset}>Use Gigacode Preset</button>
                </div>
              </div>
            </div>

            <div className="settingsTableRow settingsTableRowTop">
              <div className="settingsTableLabel">CLI Args</div>
              <div className="settingsTableValue">
                <textarea
                  className="mono"
                  rows={5}
                  value={localCliArgsText}
                  onChange={e => props.onChange(prev => ({
                    ...prev,
                    localCliArgs: e.target.value
                      .split('\n')
                      .map(item => item.trim())
                      .filter(Boolean),
                  }))}
                  placeholder={'One argument per line\nexec\n{{prompt}}'}
                />
                <div className="small" style={{ marginTop: 6, opacity: 0.74 }}>
                  Use one argument per line. {'{{promptFile}}'} inserts a temporary UTF-8 file with the prompt. {'{{prompt}}'} inserts the prompt directly into the argument. If neither placeholder is used, the prompt is sent through stdin.
                </div>
                <div className="small" style={{ marginTop: 6, opacity: 0.74 }}>
                  Gigacode example: command `~/.gigacode/bin/gigacode`, args `exec` and {'{{prompt}}'}.
                </div>
              </div>
            </div>

            <div className="settingsTableRow">
              <div className="settingsTableLabel">Working Dir</div>
              <div className="settingsTableValue">
                <input
                  className="mono"
                  value={props.value.localCliWorkingDir}
                  onChange={e => props.onChange(prev => ({ ...prev, localCliWorkingDir: e.target.value }))}
                  placeholder="~/.gigacode"
                />
              </div>
            </div>
          </>
        )}

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

      {props.testMessage ? <div className="small" style={{ color: '#7ee0a1' }}>{props.testMessage}</div> : null}
      {props.testError ? <div className="small" style={{ color: '#ff9a9a', whiteSpace: 'pre-wrap' }}>{props.testError}</div> : null}
    </div>
  )
}
