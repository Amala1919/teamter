import { join } from 'node:path'

import { app, BrowserWindow, globalShortcut, Menu, safeStorage, shell, type MenuItemConstructorOptions } from 'electron'

import { createHandlers } from './core/handlers'
import { PLAIN_CIPHER, type SecretCipher } from './core/secret-store'
import { createServices, type Services, type WindowControl } from './core/services'
import {
  bindEvents,
  bindIpc,
  bindMediaProtocol,
  ElectronFilePicker,
  registerMediaScheme
} from './electron/adapter'

const isDevelopment = !app.isPackaged

/** APIキーは OS の鍵保管庫(Windows は DPAPI、macOS はキーチェーン)で暗号化して置く。 */
function osCipher(): SecretCipher {
  if (!safeStorage.isEncryptionAvailable()) return PLAIN_CIPHER
  return {
    secure: true,
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64'))
  }
}

registerMediaScheme()

/**
 * 入力欄の右クリックで、切り取り・コピー・貼り付けのメニューを出す。
 * タイムラインなどアプリ独自のメニューを出す所では、画面側が右クリックを横取りするのでここには来ない。
 */
app.on('web-contents-created', (_event, contents) => {
  contents.on('context-menu', (_menuEvent, params) => {
    const hasSelection = params.selectionText.trim() !== ''
    if (!params.isEditable && !hasSelection) return
    const template: MenuItemConstructorOptions[] = params.isEditable
      ? [
          { role: 'undo', label: '元に戻す', enabled: params.editFlags.canUndo },
          { role: 'redo', label: 'やり直す', enabled: params.editFlags.canRedo },
          { type: 'separator' },
          { role: 'cut', label: '切り取り', enabled: params.editFlags.canCut },
          { role: 'copy', label: 'コピー', enabled: params.editFlags.canCopy },
          { role: 'paste', label: '貼り付け', enabled: params.editFlags.canPaste },
          { type: 'separator' },
          { role: 'selectAll', label: 'すべて選択', enabled: params.editFlags.canSelectAll }
        ]
      : [{ role: 'copy', label: 'コピー' }]
    Menu.buildFromTemplate(template).popup()
  })
})

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
    windows: windowControl,
    cipher: osCipher()
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
