import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  // アプリの設定を先に置いて、模擬の音声エンジンにつなぐ。キャッシュは別のドライブ(のつもりのフォルダ)に置く。
  mkdirSync(join(config, 'zunda-studio'), { recursive: true })
  const cacheDir = join(home, 'D-drive', 'zunda-studio-cache')
  writeFileSync(
    join(config, 'zunda-studio', 'settings.json'),
    JSON.stringify({
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: 'http://127.0.0.1:50131', executablePath: null, autoLaunch: false }] },
      storage: { cacheDir }
    })
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

    // API キーは OS の鍵保管庫で暗号化して保存し、値そのものは画面に返さない
    type Bridge = { zunda: { invoke(channel: string, args: unknown[]): Promise<{ ok: boolean; value?: unknown }> } }
    const stored = await page.evaluate(() =>
      (globalThis as unknown as Bridge).zunda.invoke('secrets:set', ['opencode.apiKey', 'sk-electron-secret-1234'])
    )
    expect(stored).toMatchObject({ ok: true, value: { set: true, hint: '…1234' } })
    const secretsFile = readFileSync(join(config, 'zunda-studio', 'secrets.json'), 'utf8')
    if ((stored.value as { secure: boolean }).secure) expect(secretsFile).not.toContain('sk-electron-secret-1234')

    // VOICEVOX の自動インストールに使う 7za が、配布版の asar の外に置かれている
    const info = await page.evaluate(() => (globalThis as unknown as Bridge).zunda.invoke('voice:install:info', []))
    expect(info).toMatchObject({ ok: true, value: { supported: true } })
    const unpacked = join(unpackedExecutable(), '..', 'resources', 'app.asar.unpacked', 'node_modules', '7zip-bin')
    expect(existsSync(unpacked)).toBe(true)

    // preload 経由の呼び出しで合成できる
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('open-bulk').click()
    await page.getByTestId('bulk-text').fill('ずんだもん:本物のElectronなのだ\n四国めたん:そうね')
    await page.getByTestId('bulk-submit').click()
    await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(2, { timeout: 60_000 })
    // 合成した音声は、設定したキャッシュの場所に置かれる
    const cacheInfo = await page.evaluate(() => (globalThis as unknown as Bridge).zunda.invoke('cache:info', []))
    expect(cacheInfo).toMatchObject({ ok: true, value: { path: cacheDir, fallbackFrom: null } })
    expect(readdirSync(join(cacheDir, 'voice'), { recursive: true }).some((name) => String(name).endsWith('.wav'))).toBe(true)
    expect(existsSync(join(config, 'zunda-studio', 'cache', 'voice'))).toBe(false)

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

    // 右クリックメニュー(画面側のメニュー)と、境界のドラッグ
    await page.locator('[data-item-type="video"]').click({ button: 'right' })
    await expect(page.getByTestId('context-menu').first()).toContainText('再生位置で分割')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('context-menu')).toHaveCount(0)
    await expect(page.getByTestId('splitter-timeline')).toBeVisible()

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

    // 今の画面を PNG で保存できる(別オリジンの素材を描いても canvas が汚れない)
    const image = join(home, 'frame.png')
    await stubDialogs(app, [], image)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTestId('preview-canvas').click({ button: 'right' })
    await page.getByTestId('menu-preview-image-parent').hover()
    await page.getByTestId('menu-preview-image-plain').click()
    await expect(page.getByTestId('preview-notice')).toContainText('frame.png')
    expect(readFileSync(image).subarray(1, 4).toString()).toBe('PNG')

    // 保存していない変更があるので、閉じる前に確かめる。キャンセルすると閉じない。
    // (Playwright が beforeunload を自分で閉じようとしないよう、受け取るだけのリスナーを置く。確認は main 側のダイアログが行う)
    page.on('dialog', () => {})
    await app.evaluate(({ dialog }) => {
      const state = globalThis as { unloadAsked?: number }
      state.unloadAsked = 0
      dialog.showMessageBoxSync = (() => {
        state.unloadAsked! += 1
        return 1
      }) as typeof dialog.showMessageBoxSync
    })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.close()))
    await expect.poll(() => app.evaluate(() => (globalThis as { unloadAsked?: number }).unloadAsked)).toBe(1)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await expect(page.getByTestId('open-export')).toBeVisible()
  } finally {
    // 「保存せずに閉じる」を選んだことにして終える。
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    await app.close()
  }
})
