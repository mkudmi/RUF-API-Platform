import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { initPersistentLocalStorageBridge } from '../shared/utils/persistentLocalStorage'
import { logError } from '../shared/utils/logger'

type BoundaryState = {
  error: Error | null
}

class StartupErrorBoundary extends React.Component<React.PropsWithChildren, BoundaryState> {
  state: BoundaryState = {
    error: null,
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logError('StartupErrorBoundary', error, {
      componentStack: errorInfo.componentStack,
    })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div
        style={{
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: '#0b0c10',
          color: '#ffffff',
        }}
      >
        <div
          style={{
            width: 'min(720px, 100%)',
            border: '1px solid rgba(255,255,255,.12)',
            borderRadius: 12,
            background: 'rgba(255,255,255,.04)',
            padding: 18,
            boxShadow: '0 18px 44px rgba(0,0,0,.32)',
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>Ruf failed to start</div>
          <div style={{ opacity: 0.82, marginBottom: 12 }}>
            The app hit an early frontend error instead of rendering the workspace.
          </div>
          <pre
            style={{
              margin: 0,
              padding: 14,
              borderRadius: 10,
              background: '#11141c',
              border: '1px solid rgba(255,255,255,.08)',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            {this.state.error.stack || this.state.error.message}
          </pre>
        </div>
      </div>
    )
  }
}

function applyPlatformClass() {
  const ua = navigator.userAgent.toLowerCase()
  const platform = (navigator.platform || '').toLowerCase()
  const isMac = platform.includes('mac') || ua.includes('mac os')
  if (isMac) document.documentElement.classList.add('platform-macos')
}

function renderBootstrapFailure(rootEl: HTMLElement, error: unknown) {
  const message = error instanceof Error ? (error.stack || error.message) : String(error)
  rootEl.innerHTML = `
    <div style="height:100%;display:grid;place-items:center;padding:24px;background:#0b0c10;color:#ffffff;">
      <div style="width:min(720px,100%);border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.04);padding:18px;box-shadow:0 18px 44px rgba(0,0,0,.32);">
        <div style="font-size:20px;font-weight:700;margin-bottom:10px;">Ruf failed to bootstrap</div>
        <div style="opacity:.82;margin-bottom:12px;">The app did not reach the initial React render.</div>
        <pre style="margin:0;padding:14px;border-radius:10px;background:#11141c;border:1px solid rgba(255,255,255,.08);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.45;">${message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>
      </div>
    </div>
  `
}

function bootstrap() {
  applyPlatformClass()
  const rootEl = document.getElementById('root')
  if (!rootEl) throw new Error('Missing #root element.')

  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <StartupErrorBoundary>
        <App />
      </StartupErrorBoundary>
    </React.StrictMode>,
  )

  void initPersistentLocalStorageBridge().catch(error => {
    logError('bootstrap.initPersistentLocalStorageBridge', error)
  })
}

try {
  bootstrap()
} catch (error) {
  logError('bootstrap', error)
  const rootEl = document.getElementById('root')
  if (rootEl) {
    renderBootstrapFailure(rootEl, error)
  } else {
    throw error
  }
}
