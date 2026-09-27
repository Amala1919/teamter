import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { buildEngineArchive, startMockEngineRelease } from '../tests/fixtures/mock-engine-release.mjs'
import { updateSettings } from './helpers'
import { ENGINE_RELEASE_PORT, INSTALLED_ENGINE_PORT } from './ports'

function currentTarget(): string {
  if (process.platform === 'darwin') return `macos-${process.arch}`
  if (process.platform === 'win32') return 'windows-cpu'
  return `linux-cpu-${process.arch}`
}

test('VOICEVOX が無ければ案内が出て、ボタン1つで入れて起動できる', async ({ page, request }) => {
  const version = '0.99.2'
  const archive = buildEngineArchive({ dir: mkdtempSync(join(tmpdir(), 'zs-e2e-engine-')), target: currentTarget(), version })
  const release = await startMockEngineRelease({ port: ENGINE_RELEASE_PORT, version, archiveDir: archive.dir, parts: archive.parts })
  try {
    await updateSettings(request, {
      voice: {
        engines: [{ id: 'voicevox', label: 'VOICEVOX', url: `http://127.0.0.1:${INSTALLED_ENGINE_PORT}`, executablePath: null, autoLaunch: true }]
      }
    })
    await page.goto('/')
    const banner = page.getByTestId('engine-install-banner')
    await expect(banner).toContainText('VOICEVOX(音声エンジン)が見つかりません')
    await page.getByTestId('engine-install-start').click()
    await expect(page.getByTestId('engine-install-done')).toContainText('VOICEVOX を入れて起動しました(0.99.2)', { timeout: 30_000 })
    expect(release.requests).toContain('/latest')

    // 設定画面でも、入れた版と状態が分かる
    await page.getByTestId('open-settings').click()
    await page.getByRole('tab', { name: '音声エンジン' }).click()
    await expect(page.getByTestId('engine-voicevox-status')).toContainText('接続中')
    await expect(page.getByTestId('engine-install-status')).toContainText('0.99.2')
    await expect(page.getByTestId('engine-voicevox-path')).toHaveValue(/voicevox[\\/]run/)
  } finally {
    await release.close()
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: 'http://127.0.0.1:50021', executablePath: null, autoLaunch: false }] }
    })
  }
})
