import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'

import type { AppInfo, OpenedProject, SavedProject } from '@shared/ipc/contract'
import { IPC } from '@shared/ipc/contract'
import type { Project } from '@shared/project/types'

import { PROJECT_FILE_EXTENSION, readProject, writeProject } from './project/store'

const isDevelopment = !app.isPackaged

function createWindow(): BrowserWindow {
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
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDevelopment && devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => {
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      projectFileExtension: PROJECT_FILE_EXTENSION
    }
  })

  ipcMain.handle(IPC.projectOpen, async (event): Promise<OpenedProject | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, openDialogOptions())
      : await dialog.showOpenDialog(openDialogOptions())
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    return { path, project: await readProject(path) }
  })

  ipcMain.handle(
    IPC.projectSave,
    async (event, project: Project, path: string | null): Promise<SavedProject | null> => {
      let target = path
      if (!target) {
        const window = BrowserWindow.fromWebContents(event.sender)
        const options = saveDialogOptions(project.meta.title)
        const result = window
          ? await dialog.showSaveDialog(window, options)
          : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return null
        target = result.filePath
      }
      await writeProject(target, project)
      return { path: target }
    }
  )
}

function openDialogOptions(): Electron.OpenDialogOptions {
  return {
    title: 'プロジェクトを開く',
    properties: ['openFile'],
    filters: [{ name: 'zunda-studio プロジェクト', extensions: [PROJECT_FILE_EXTENSION] }]
  }
}

function saveDialogOptions(title: string): Electron.SaveDialogOptions {
  return {
    title: 'プロジェクトを保存',
    defaultPath: `${sanitizeFileName(title)}.${PROJECT_FILE_EXTENSION}`,
    filters: [{ name: 'zunda-studio プロジェクト', extensions: [PROJECT_FILE_EXTENSION] }]
  }
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned === '' ? 'project' : cleaned
}

void app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
