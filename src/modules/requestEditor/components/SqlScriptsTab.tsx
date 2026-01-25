import { useState } from 'react'
import type { Environment } from '../../../shared/types/environment'
import { CloseIcon, CopyIcon } from '../../../shared/icons'
import { copyText } from '../../../shared/utils/clipboard'
import { hasDbConfigInEnv } from '../../environment'

export function SqlScriptsTab(props: {
  environment?: Environment
  preSqlScript: string
  postSqlScript: string
  onChangePreSqlScript: (next: string) => void
  onChangePostSqlScript: (next: string) => void
}) {
  const [preSqlCopied, setPreSqlCopied] = useState(false)
  const [postSqlCopied, setPostSqlCopied] = useState(false)

  const canCopyPre = !!props.preSqlScript.trim()
  const canCopyPost = !!props.postSqlScript.trim()

  return (
    <div className="accordion">
      <div className="section">
        {!props.environment || !hasDbConfigInEnv(props.environment) ? (
          <div className="small" style={{ opacity: 0.85, marginBottom: 10 }}>
            Configure database connection in Environment settings to run SQL scripts.
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="formLabel mono" style={{ marginBottom: 0 }}>Pre Script</div>
            <button
              type="button"
              className="iconBtn"
              onClick={async () => {
                await copyText(props.preSqlScript)
                setPreSqlCopied(true)
                setTimeout(() => setPreSqlCopied(false), 900)
              }}
              disabled={!canCopyPre}
              aria-disabled={!canCopyPre}
              aria-label="Copy pre script"
              title="Copy"
              style={{ width: 28, height: 28, marginLeft: 'auto' }}
            >
              {preSqlCopied ? 'OK' : <CopyIcon />}
            </button>
            <button
              type="button"
              className="iconBtn"
              onClick={() => props.onChangePreSqlScript('')}
              disabled={!canCopyPre}
              aria-disabled={!canCopyPre}
              aria-label="Clear pre script"
              title="Clear"
              style={{ width: 28, height: 28 }}
            >
              <CloseIcon size={18} />
            </button>
          </div>
          <textarea
            className="mono"
            rows={5}
            value={props.preSqlScript}
            onChange={e => props.onChangePreSqlScript(e.target.value)}
            placeholder="SQL to run before Send"
            style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="formLabel mono" style={{ marginBottom: 0 }}>Post Script</div>
            <button
              type="button"
              className="iconBtn"
              onClick={async () => {
                await copyText(props.postSqlScript)
                setPostSqlCopied(true)
                setTimeout(() => setPostSqlCopied(false), 900)
              }}
              disabled={!canCopyPost}
              aria-disabled={!canCopyPost}
              aria-label="Copy post script"
              title="Copy"
              style={{ width: 28, height: 28, marginLeft: 'auto' }}
            >
              {postSqlCopied ? 'OK' : <CopyIcon />}
            </button>
            <button
              type="button"
              className="iconBtn"
              onClick={() => props.onChangePostSqlScript('')}
              disabled={!canCopyPost}
              aria-disabled={!canCopyPost}
              aria-label="Clear post script"
              title="Clear"
              style={{ width: 28, height: 28 }}
            >
              <CloseIcon size={18} />
            </button>
          </div>
          <textarea
            className="mono"
            rows={5}
            value={props.postSqlScript}
            onChange={e => props.onChangePostSqlScript(e.target.value)}
            placeholder="SQL to run after Send"
            style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>
      </div>
    </div>
  )
}
