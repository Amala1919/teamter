import { defineConfig } from '@playwright/test'

/**
 * 実物の Electron で動かす確認(npm run test:electron)。
 * 先に `npm run dist -- --dir` で dist/*-unpacked を作っておく。画面が無い環境では xvfb-run の下で動かす。
 * 画面の細かい動きは e2e/(テスト用ホスト)で確かめ、ここでは Electron でしか起きないこと
 * (preload の橋渡し、zs-media: の配信、H.264 の直接再生、最前面のウィンドウ、ネイティブのダイアログ)を確かめる。
 */
export default defineConfig({
  testDir: 'e2e-electron',
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'node tests/fixtures/mock-voicevox.mjs --port 50131',
    url: 'http://127.0.0.1:50131/version',
    reuseExistingServer: false
  }
})
