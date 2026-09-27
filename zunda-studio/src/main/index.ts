import { join } from 'node:path'

import { app, BrowserWindow, globalShortcut, shell } from 'electron'

import { createHandlers } from './core/handlers'
import { createServices, type Services, type WindowControl } from './core/services'
import {
  bindEvents,
  bindIpc,
  bindMediaProtocol,
  ElectronFilePicker,
  registerMediaScheme
} from './electron/adapter'

const isDevelopment = !app.isPackaged

registerMediaScheme()

function loadRenderer(window: BrowserWindow, hash = ''): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDevelopment && devServerUrl) {
    void window.loadURL(`${devServerUrl}${hash ? `#${hash}` : ''}`)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'), hash ? { hash } : {})
  }
}

let liveWindow: BrowserWindow | null = null
let alwaysOnTop = true

/** ライブ用の小さなウィンドウ。ゲームの上に重ねて使うので、既定で最前面に出す(ARCHITECTURE.md 2.6)。 */
const windowControl: WindowControl = {
  openLive: () => {
    if (liveWindow && !liveWindow.isDestroyed()) {
      liveWindow.show()
      liveWindow.focus()
      return true
    }
    liveWindow = new BrowserWindow({
      width: 420,
      height: 600,
      minWidth: 320,
      minHeight: 360,
      title: 'ライブ — zunda-studio',
      alwaysOnTop,
      backgroundColor: '#14181d',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    liveWindow.on('closed', () => {
      liveWindow = null
    })
    loadRenderer(liveWindow, 'live')
    return true
  },
  registerHotkey: (accelerator, handler) => {
    try {
      return globalShortcut.register(accelerator, handler)
    } catch {
      return false
    }
  },
  unregisterHotkeys: () => globalShortcut.unregisterAll()
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 720,
    show: false,
    backgroundColor: '#14181d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.on('ready-to-show', () => window.show())

  // 外部リンクは既定のブラウザで開き、アプリ内で任意のページを開かせない。
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(window)
  return window
}

async function start(): Promise<Services> {
  await app.whenReady()
  const services = await createServices({
    userData: app.getPath('userData'),
    runtime: 'electron',
    appVersion: app.getVersion(),
    picker: new ElectronFilePicker(),
    windows: windowControl
  })
  alwaysOnTop = services.settings.get().live.alwaysOnTop
  bindIpc(createHandlers(services))
  bindEvents(services)
  bindMediaProtocol(services)
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
  return services
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

const started = start()

// アプリが起動した音声エンジンを残さないよう、終了前に止める。
let disposed = false
app.on('before-quit', (event) => {
  if (disposed) return
  event.preventDefault()
  void started
    .then((services) => services.dispose())
    .finally(() => {
      disposed = true
      app.quit()
    })
})
