import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { startDevHost } from './server'

/**
 * テスト用ホストを単体で起動する。
 *   node out/devhost/main.js [--port 5317] [--user-data <dir>] [--renderer <dir>]
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const option = (name: string): string | undefined => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const userData = option('--user-data') ?? (await mkdtemp(join(tmpdir(), 'zunda-studio-devhost-')))
  const rendererDir = resolve(option('--renderer') ?? 'out/renderer')
  const port = Number(option('--port') ?? '5317')

  const host = await startDevHost({ userData, rendererDir, port })
  console.log(`zunda-studio devhost: ${host.url}  (userData: ${userData})`)

  const shutdown = (): void => {
    void host.close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void main()
