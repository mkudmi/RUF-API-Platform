import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { initPersistentLocalStorageBridge } from '../shared/utils/persistentLocalStorage'

async function bootstrap() {
  await initPersistentLocalStorageBridge()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void bootstrap()
