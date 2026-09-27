// VOICEVOX ENGINE の配布元(GitHub Releases)の模擬。本物と同じ形の 7z 分割アーカイブを作って配る。
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sevenBin from '7zip-bin'

const here = dirname(fileURLToPath(import.meta.url))

const RUN_SCRIPT = `#!/usr/bin/env node
// 模擬のエンジン。--port で指定されたポートで模擬 VOICEVOX を起動する。
import { startMockVoicevox } from './mock-voicevox.mjs'
const index = process.argv.indexOf('--port')
await startMockVoicevox({ port: index >= 0 ? Number(process.argv[index + 1]) : 50021 })
`

/**
 * 本物と同じ名前・構成のアーカイブを作る:
 *   voicevox_engine-<target>-<version>.7z.001, .002 …(中身は <target>/run と模擬 VOICEVOX)
 */
export function buildEngineArchive({ dir, target, version, volumeKb = 128 }) {
  const source = join(dir, 'source')
  const engineDir = join(source, target)
  mkdirSync(engineDir, { recursive: true })
  writeFileSync(join(engineDir, 'run'), RUN_SCRIPT)
  chmodSync(join(engineDir, 'run'), 0o755)
  copyFileSync(join(here, 'mock-voicevox.mjs'), join(engineDir, 'mock-voicevox.mjs'))
  // 分割されるだけの大きさにする(圧縮の効かない中身)。
  writeFileSync(join(engineDir, 'model.bin'), randomBytes(400 * 1024))
  const out = join(dir, 'release')
  mkdirSync(out, { recursive: true })
  const name = `voicevox_engine-${target}-${version}.7z`
  chmodSync(sevenBin.path7za, 0o755)
  execFileSync(sevenBin.path7za, ['a', '-r', `-v${volumeKb}k`, '-bso0', '-bsp0', join(out, name), `${target}/`], { cwd: source })
  const parts = readdirSync(out).filter((file) => file.startsWith(`${name}.`)).sort()
  writeFileSync(join(out, `${name}.txt`), parts.join('\n') + '\n')
  return { dir: out, parts }
}

/**
 * /latest は GitHub API のリリース情報、/download/<版>/<名前> は配布物を返す。
 * noApi にすると /latest が使えない(API の回数制限などの)状況を再現する。
 */
export async function startMockEngineRelease({ port = 0, version, archiveDir, parts, noApi = false }) {
  const requests = []
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    requests.push(url.pathname)
    if (url.pathname === '/latest') {
      if (noApi) {
        response.writeHead(403, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ message: 'API rate limit exceeded' }))
        return
      }
      const assets = parts.map((name) => ({ name, size: statSync(join(archiveDir, name)).size }))
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ tag_name: version, assets }))
      return
    }
    const match = /^\/download\/([^/]+)\/([^/]+)$/.exec(url.pathname)
    if (match && match[1] === version) {
      try {
        const body = readFileSync(join(archiveDir, decodeURIComponent(match[2])))
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length })
        response.end(body)
        return
      } catch {
        // 下で 404。
      }
    }
    response.writeHead(404)
    response.end('not found')
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    release: { latestUrl: `${base}/latest`, downloadBase: `${base}/download` },
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
