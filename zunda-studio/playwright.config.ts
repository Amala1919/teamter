import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineConfig } from '@playwright/test'

import { AI_RESPONSE_DIR, DEVHOST_PORT, ENGINE_RELEASE_PORT, MOCK_COMMONS_PORT, MOCK_VOICEVOX_PORT } from './e2e/ports'

/**
 * E2E テスト。ビルド済みのレンダラをテスト用ホスト(src/devhost)で配信し、Chromium で操作する。
 * 外部ツールは tests/fixtures の模擬CLI・模擬サーバーに差し替える。
 */
const userData = mkdtempSync(join(tmpdir(), 'zunda-e2e-'))
const preinstalledChromium = '/opt/pw-browsers/chromium'
mkdirSync(AI_RESPONSE_DIR, { recursive: true })

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${DEVHOST_PORT}`,
    trace: 'retain-on-failure',
    launchOptions: {
      ...(existsSync(preinstalledChromium) ? { executablePath: preinstalledChromium } : {}),
      args: [
        '--autoplay-policy=no-user-gesture-required',
        // 押しながら話すを試すため、マイクは偽物(ビープ音)を使い、許可を自動で与える。
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream'
      ]
    }
  },
  webServer: [
    {
      command: `node tests/fixtures/mock-voicevox.mjs --port ${MOCK_VOICEVOX_PORT}`,
      url: `http://127.0.0.1:${MOCK_VOICEVOX_PORT}/version`,
      reuseExistingServer: false
    },
    {
      command: `node tests/fixtures/mock-commons.mjs --port ${MOCK_COMMONS_PORT}`,
      url: `http://127.0.0.1:${MOCK_COMMONS_PORT}/health`,
      reuseExistingServer: false
    },
    {
      command: `node out/devhost/main.js --port ${DEVHOST_PORT} --user-data ${userData}`,
      url: `http://127.0.0.1:${DEVHOST_PORT}`,
      reuseExistingServer: false,
      stdout: 'pipe',
      env: {
        FAKE_MODE: 'text',
        FAKE_REPLY: '接続できたのだ',
        FAKE_RESPONSE_DIR: AI_RESPONSE_DIR,
        ZS_ENGINE_RELEASE_BASE: `http://127.0.0.1:${ENGINE_RELEASE_PORT}`,
        ZS_COMMONS_API: `http://127.0.0.1:${MOCK_COMMONS_PORT}/w/api.php`,
        // 解説の参考画像の「公式サイト」も模擬のサーバーで配る。
        ZS_WEB_IMAGES_ALLOW_LOCAL: '1'
      }
    }
  ]
})
