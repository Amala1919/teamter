import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve, sep } from 'node:path'

import { QueuedFilePicker } from '../main/core/dialog'
import { toErrorShape } from '../main/core/errors'
import { createHandlers, dispatch } from '../main/core/handlers'
import { serveMedia } from '../main/core/media-access'
import { createServices, type Services } from '../main/core/services'

/**
 * テスト用ホスト。main のハンドラ表をそのまま HTTP で公開し、ビルド済みのレンダラを配信する。
 * Electron を起動できない環境でも、本物のサービスを本物の画面から動かすために使う。
 * docs/ARCHITECTURE.md の 2.9 を参照。
 */

export interface DevHostOptions {
  userData: string
  rendererDir: string
  port?: number
  env?: NodeJS.ProcessEnv
}

export interface DevHost {
  url: string
  services: Services
  picker: QueuedFilePicker
  close: () => Promise<void>
}

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
}

export async function startDevHost(options: DevHostOptions): Promise<DevHost> {
  const picker = new QueuedFilePicker()
  const services = await createServices({
    userData: options.userData,
    runtime: 'devhost',
    appVersion: '0.0.0-devhost',
    picker,
    ...(options.env ? { env: options.env } : {})
  })
  const handlers = createHandlers(services)
  const eventClients = new Set<ServerResponse>()

  services.events.listen((envelope) => {
    const data = `data: ${JSON.stringify(envelope)}\n\n`
    for (const client of eventClients) client.write(data)
  })

  const server: Server = createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok: false, error: toErrorShape(error) }))
    })
  })

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost')

    if (request.method === 'POST' && url.pathname.startsWith('/ipc/')) {
      const channel = decodeURIComponent(url.pathname.slice('/ipc/'.length))
      const body = (await readJson(request)) as { args?: unknown }
      const result = await dispatch(handlers, channel, body.args ?? [])
      sendJson(response, 200, result)
      return
    }

    if (request.method === 'GET' && url.pathname === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      response.write(': connected\n\n')
      eventClients.add(response)
      request.on('close', () => eventClients.delete(response))
      return
    }

    if (request.method === 'GET' && url.pathname === '/media') {
      const path = url.searchParams.get('path') ?? ''
      try {
        const media = await serveMedia(services.media, path, request.headers.range ?? null)
        response.writeHead(media.status, media.headers)
        if (media.body) media.body.pipe(response)
        else response.end()
      } catch (error) {
        const shape = toErrorShape(error)
        sendJson(response, shape.code === 'ACCESS_DENIED' ? 403 : 404, { ok: false, error: shape })
      }
      return
    }

    // テストがファイル選択ダイアログの応答を積むための口。
    if (request.method === 'POST' && url.pathname === '/__test/pick') {
      const body = (await readJson(request)) as { response?: string[] | null }
      picker.enqueue(body.response ?? null)
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET') {
      await serveStatic(options.rendererDir, url.pathname, response)
      return
    }

    sendJson(response, 404, { ok: false })
  }

  await new Promise<void>((resolvePromise) => server.listen(options.port ?? 0, '127.0.0.1', resolvePromise))
  const address = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${address.port}`,
    services,
    picker,
    close: () =>
      new Promise<void>((resolvePromise) => {
        for (const client of eventClients) client.end()
        void services.dispose().finally(() => server.close(() => resolvePromise()))
      })
  }
}

async function serveStatic(root: string, pathname: string, response: ServerResponse): Promise<void> {
  const base = resolve(root)
  const requested = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
  let file = resolve(base, requested === '' ? 'index.html' : requested)
  if (file !== base && !file.startsWith(base + sep)) {
    sendJson(response, 403, { ok: false })
    return
  }
  try {
    if (!(await stat(file)).isFile()) file = join(base, 'index.html')
  } catch {
    file = join(base, 'index.html')
  }
  response.writeHead(200, { 'Content-Type': STATIC_TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(response)
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? {} : (JSON.parse(text) as unknown)
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}
