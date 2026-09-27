import { Readable } from 'node:stream'

import { BrowserWindow, dialog, ipcMain, protocol, type OpenDialogOptions } from 'electron'

import type { PickRequest } from '@shared/ipc/contract'

import { PICK_FILTERS, type FilePicker } from '../core/dialog'
import { toErrorShape } from '../core/errors'
import { dispatch, type HandlerTable } from '../core/handlers'
import { serveMedia } from '../core/media-access'
import type { Services } from '../core/services'

export const INVOKE_CHANNEL = 'zs:invoke'
export const EVENT_CHANNEL = 'zs:event'
export const MEDIA_SCHEME = 'zs-media'

/** app の ready より前に呼ぶ必要がある。<video> のシークにはストリーミングと Range が要る。 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
    }
  ])
}

export function bindIpc(handlers: HandlerTable): void {
  ipcMain.handle(INVOKE_CHANNEL, (_event, channel: unknown, args: unknown) =>
    dispatch(handlers, String(channel), args)
  )
}

export function bindEvents(services: Services): void {
  services.events.listen((envelope) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(EVENT_CHANNEL, envelope)
    }
  })
}

export function bindMediaProtocol(services: Services): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const path = decodeURIComponent(url.pathname.replace(/^\//, ''))
    try {
      const response = await serveMedia(services.media, path, request.headers.get('range'))
      const body = response.body ? (Readable.toWeb(response.body) as ReadableStream) : null
      return new Response(body, { status: response.status, headers: response.headers })
    } catch (error) {
      const shape = toErrorShape(error)
      return new Response(shape.message, { status: shape.code === 'ACCESS_DENIED' ? 403 : 404 })
    }
  })
}

export class ElectronFilePicker implements FilePicker {
  async pick(request: PickRequest): Promise<string[] | null> {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const filters = PICK_FILTERS[request.kind]
    if (request.kind === 'saveProject' || request.kind === 'exportVideo' || request.kind === 'exportText') {
      const options = {
        filters,
        ...(request.defaultName ? { defaultPath: request.defaultName } : {})
      }
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
      return result.canceled || !result.filePath ? null : [result.filePath]
    }
    const properties: OpenDialogOptions['properties'] = request.multiple
      ? ['openFile', 'multiSelections']
      : ['openFile']
    const options: OpenDialogOptions = { filters, properties }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths
  }
}
