import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { LiveApp } from './features/live/LiveApp'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root が見つかりません')

createRoot(container).render(
  <StrictMode>
    {/* ライブ用の小さなウィンドウは同じ画面を #live で開く。 */}
    {window.location.hash === '#live' ? <LiveApp /> : <App />}
  </StrictMode>
)
