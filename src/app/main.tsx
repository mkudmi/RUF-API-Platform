import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { initPersistentLocalStorageBridge } from '../shared/utils/persistentLocalStorage'

function applyPlatformClass() {
  const ua = navigator.userAgent.toLowerCase()
  const platform = (navigator.platform || '').toLowerCase()
  const isMac = platform.includes('mac') || ua.includes('mac os')
  if (isMac) document.documentElement.classList.add('platform-macos')
}

async function bootstrap() {
  applyPlatformClass()
  await initPersistentLocalStorageBridge()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void bootstrap()
