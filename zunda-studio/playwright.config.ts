import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineConfig } from '@playwright/test'

/**
 * E2E テスト。ビルド済みのレンダラをテスト用ホスト(src/devhost)で配信し、Chromium で操作する。
 * 外部ツールは tests/fixtures の模擬CLI・模擬サーバーに差し替える。
 */
const PORT = 5317
const userData = mkdtempSync(join(tmpdir(), 'zunda-e2e-'))
const preinstalledChromium = '/opt/pw-browsers/chromium'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    ...(existsSync(preinstalledChromium) ? { launchOptions: { executablePath: preinstalledChromium } } : {})
  },
  webServer: {
    command: `node out/devhost/main.js --port ${PORT} --user-data ${userData}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    stdout: 'pipe',
    env: {
      FAKE_MODE: 'text',
      FAKE_REPLY: '接続できたのだ',
      E2E_USER_DATA: userData
    }
  }
})
