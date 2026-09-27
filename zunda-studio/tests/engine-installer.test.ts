import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EventBus } from '@main/core/events'
import { sevenZipPath } from '@main/core/seven-zip'
import { discoverEngineExecutable } from '@main/services/voice/engine-discovery'
import { archiveParts, EngineInstaller, engineTarget, FALLBACK_ENGINE_VERSION } from '@main/services/voice/engine-installer'
import { EngineManager } from '@main/services/voice/engine-manager'
import type { EngineInstallState } from '@shared/voice/types'

import { buildEngineArchive, startMockEngineRelease } from './fixtures/mock-engine-release.mjs'
import { settingsWith, tempDir } from './helpers/env'

const target = engineTarget(process.platform, process.arch)!

async function setup(options: { version?: string; noApi?: boolean } = {}) {
  const version = options.version ?? '0.99.1'
  const archive = buildEngineArchive({ dir: await tempDir('zs-engine-archive-'), target, version })
  const server = await startMockEngineRelease({ version, archiveDir: archive.dir, parts: archive.parts, noApi: options.noApi ?? false })
  const events = new EventBus()
  const progress: EngineInstallState[] = []
  events.listen((envelope) => {
    if (envelope.type === 'voice:install-progress') progress.push(envelope.payload as EngineInstallState)
  })
  const root = await tempDir('zs-engines-')
  const installer = new EngineInstaller({ root, sevenZipPath: await sevenZipPath(), events, release: server.release })
  return { version, archive, server, events, progress, installer, root }
}

describe('VOICEVOX ENGINE の自動インストール', () => {
  it('OS と CPU に合う公式配布を選ぶ', () => {
    expect(engineTarget('win32', 'x64')).toBe('windows-cpu')
    expect(engineTarget('darwin', 'arm64')).toBe('macos-arm64')
    expect(engineTarget('linux', 'x64')).toBe('linux-cpu-x64')
    expect(engineTarget('win32', 'ia32')).toBeNull()
    const parts = archiveParts(
      [
        { name: 'voicevox_engine-windows-cpu-0.25.2.7z.002', size: 1 },
        { name: 'voicevox_engine-windows-cpu-0.25.2.7z.001', size: 1 },
        { name: 'voicevox_engine-windows-cpu-0.25.2.7z.txt', size: 1 },
        { name: 'voicevox_engine-windows-directml-0.25.2.7z.001', size: 1 },
        { name: 'voicevox_engine-windows-cpu-0.25.2.vvpp', size: 1 }
      ],
      'windows-cpu',
      '0.25.2'
    )
    expect(parts.map((part) => part.name)).toEqual(['voicevox_engine-windows-cpu-0.25.2.7z.001', 'voicevox_engine-windows-cpu-0.25.2.7z.002'])
  })

  it('最新版の分割アーカイブを落として展開し、そのまま起動して使える', async () => {
    const { version, archive, server, progress, installer, root, events } = await setup()
    try {
      expect(archive.parts.length).toBeGreaterThan(1)
      expect((await installer.info()).installed).toBeNull()
      const executable = await installer.install()
      expect(executable).toBe(join(root, 'voicevox', process.platform === 'win32' ? 'run.exe' : 'run'))
      await access(executable)
      expect(await readFile(join(root, 'voicevox', 'zunda-version.txt'), 'utf8')).toBe(version)
      expect((await installer.info()).installed).toEqual({ version, executablePath: executable })
      // 落とした分割ファイルは片付ける
      await expect(access(join(root, 'downloads'))).rejects.toThrow()

      const phases = progress.map((state) => state.phase)
      expect(phases).toEqual(expect.arrayContaining(['checking', 'downloading', 'extracting', 'starting']))
      const downloaded = progress.filter((state) => state.phase === 'downloading').at(-1)!
      expect(downloaded.totalBytes).toBeGreaterThan(0)
      expect(downloaded.receivedBytes).toBe(downloaded.totalBytes)

      // 場所を設定していなくても、入れたエンジンを見つけて起動する
      const port = 50_700 + Math.floor(Math.random() * 200)
      const settings = settingsWith({ voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: `http://127.0.0.1:${port}`, executablePath: null, autoLaunch: true }] } })
      const engines = new EngineManager(() => settings, events, (engine) =>
        discoverEngineExecutable(engine, { platform: process.platform, env: {}, home: '/nonexistent', resourcesPath: null, installedEngine: installer.executablePath })
      )
      try {
        expect(await engines.ensure('voicevox')).toMatchObject({ state: 'ready', managed: true })
      } finally {
        await engines.shutdown()
      }
    } finally {
      await server.close()
    }
  })

  it('GitHub の API が使えなくても、決まった版を部品の一覧から落とせる', async () => {
    const { server, installer } = await setup({ version: FALLBACK_ENGINE_VERSION, noApi: true })
    try {
      await installer.install()
      expect((await installer.info()).installed?.version).toBe(FALLBACK_ENGINE_VERSION)
      expect(server.requests).toContain(`/download/${FALLBACK_ENGINE_VERSION}/voicevox_engine-${target}-${FALLBACK_ENGINE_VERSION}.7z.txt`)
    } finally {
      await server.close()
    }
  })

  it('見つからないエンジンは「見つからない」と分かる状態にし、自動インストールを勧められるようにする', async () => {
    const settings = settingsWith({ voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: 'http://127.0.0.1:1', executablePath: null, autoLaunch: true }] } })
    const engines = new EngineManager(() => settings, new EventBus(), () => Promise.resolve(null))
    expect(await engines.ensure('voicevox')).toMatchObject({ state: 'unavailable', reason: 'not-found' })
  })

  it('配布元に無い版・途中の中止は、分かるエラーにして状態に残す', async () => {
    const { server, installer, progress } = await setup()
    try {
      const failing = new EngineInstaller({
        root: await tempDir('zs-engines-'),
        sevenZipPath: await sevenZipPath(),
        events: new EventBus(),
        release: { latestUrl: `${server.release.downloadBase}/none`, downloadBase: `${server.release.downloadBase}` }
      })
      // API も部品の一覧も無い → 配布が見つからない
      await expect(failing.install()).rejects.toMatchObject({ code: 'ENGINE_FAILED' })
      expect((await failing.info()).state.phase).toBe('error')

      const task = installer.install()
      installer.cancel()
      await expect(task).rejects.toMatchObject({ code: 'CANCELLED' })
      expect(progress.at(-1)?.phase).toBe('cancelled')
    } finally {
      await server.close()
    }
  })
})
