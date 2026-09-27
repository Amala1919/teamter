import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

import { makeTestVideo } from '../tests/fixtures/media'

function unpackedExecutable(): string {
  const dist = resolve('dist')
  const folder = existsSync(dist) ? readdirSync(dist).find((name) => name.endsWith('-unpacked')) : undefined
  if (!folder) throw new Error('dist/*-unpacked がありません。先に npm run dist -- --dir を実行してください')
  const candidates = ['zunda-studio', 'zunda-studio.exe'].map((name) => join(dist, folder, name))
  const found = candidates.find((path) => existsSync(path))
  if (!found) throw new Error(`実行ファイルが見つかりません: ${candidates.join(', ')}`)
  return found
}

/** 次のファイル選択の答えを、main 側のダイアログを差し替えて決める。 */
async function stubDialogs(app: ElectronApplication, openPaths: string[], savePath: string | null): Promise<void> {
  await app.evaluate(
    ({ dialog }, [open, save]) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: open })) as typeof dialog.showOpenDialog
      dialog.showSaveDialog = (async () => ({ canceled: save === null, filePath: save ?? undefined })) as typeof dialog.showSaveDialog
    },
    [openPaths, savePath] as const
  )
}

test('実物の Electron で、合成・動画のプレビュー・ライブのウィンドウ・書き出しが動く', async () => {
  const home = mkdtempSync(join(tmpdir(), 'zs-electron-'))
  const config = join(home, '.config')
  // アプリの設定を先に置いて、模擬の音声エンジンにつなぐ。
  mkdirSync(join(config, 'zunda-studio'), { recursive: true })
  writeFileSync(
    join(config, 'zunda-studio', 'settings.json'),
    JSON.stringify({ voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: 'http://127.0.0.1:50131', executablePath: null, autoLaunch: false }] } })
  )
  const video = makeTestVideo(home, { name: 'gameplay.mp4', seconds: 4, width: 640, height: 360 })

  const app = await electron.launch({
    executablePath: unpackedExecutable(),
    args: ['--no-sandbox'],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: config, APPDATA: config }
  })
  try {
    const page = await app.firstWindow()
    expect(await page.evaluate(() => (globalThis as unknown as { zunda?: { runtime: string } }).zunda?.runtime)).toBe('electron')

    // preload 経由の呼び出しで合成できる
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('open-bulk').click()
    await page.getByTestId('bulk-text').fill('ずんだもん:本物のElectronなのだ\n四国めたん:そうね')
    await page.getByTestId('bulk-submit').click()
    await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(2, { timeout: 60_000 })

    // H.264 はプロキシ無しで直接再生し、zs-media: から配信した動画がプレビューに描かれる
    await page.getByTestId('timeline-ruler').click({ position: { x: 1, y: 5 } })
    await stubDialogs(app, [video], null)
    await page.getByTestId('add-media').click()
    await expect(page.locator('[data-item-type="video"]')).toHaveCount(1)
    await expect
      .poll(
        () =>
          page.getByTestId('preview-canvas').evaluate((element) => {
            // このファイルは DOM の型を読み込まないので、使う分だけ形を書く。
            const canvas = element as unknown as {
              width: number
              height: number
              getContext(type: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } }
            }
            const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
            let red = 0
            for (let index = 0; index < data.length; index += 400) if (data[index]! > 200 && data[index + 1]! < 60) red++
            return red
          }),
        { timeout: 20_000 }
      )
      .toBeGreaterThan(1000)
    await expect(page.getByTestId('proxy-status')).toHaveCount(0)

    // ライブのウィンドウは最前面の別ウィンドウで開く
    await page.getByTestId('side-tab-live').click()
    const [live] = await Promise.all([app.waitForEvent('window'), page.getByTestId('open-live').click()])
    await expect(live.getByTestId('live-window')).toBeVisible()
    const onTop = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isAlwaysOnTop()))
    expect(onTop).toBe(true)
    await live.close()

    // 書き出し
    const output = join(home, 'out.mp4')
    await stubDialogs(app, [], output)
    await page.getByTestId('open-export').click()
    await page.getByTestId('export-height').selectOption('720')
    await page.getByTestId('export-start').click()
    await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 180_000 })
    expect(existsSync(output)).toBe(true)
  } finally {
    await app.close()
  }
})
