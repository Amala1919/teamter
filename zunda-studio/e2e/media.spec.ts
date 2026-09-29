import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { makeTestAudio, makeTestImage, makeTestVideo } from '../tests/fixtures/media'
import { openFresh, queuePick, updateSettings } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

/** canvas の中に、指定した色(許容差つき)の画素がいくつあるか。 */
async function countColor(canvas: Locator, color: readonly number[], tolerance = 40): Promise<number> {
  return canvas.evaluate(
    (element, [target, limit]) => {
      const canvasElement = element as unknown as {
        width: number
        height: number
        getContext(type: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } | null
      }
      const context = canvasElement.getContext('2d')
      if (!context) return 0
      const { data } = context.getImageData(0, 0, canvasElement.width, canvasElement.height)
      let count = 0
      // 全画素を見ると重いので4画素に1つ調べる。
      for (let index = 0; index < data.length; index += 16) {
        if (
          Math.abs(data[index]! - target[0]!) <= limit &&
          Math.abs(data[index + 1]! - target[1]!) <= limit &&
          Math.abs(data[index + 2]! - target[2]!) <= limit
        ) {
          count++
        }
      }
      return count
    },
    [color, tolerance] as const
  )
}

const RED = [255, 0, 0]
const BLUE = [0, 0, 255]
/** 1920×1080 の 1/4 を4画素おきに数えたときのおおよその数。 */
const QUARTER = (1920 * 1080) / 4 / 4

async function importFile(page: Page, request: Parameters<typeof queuePick>[0], path: string): Promise<void> {
  await queuePick(request, [path])
  await page.getByTestId('add-media').click()
}

test.describe('素材・タイムライン・ズーム', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zunda-e2e-media-'))
  let video: string
  let audio: string
  let image: string

  test.beforeAll(async () => {
    video = makeTestVideo(directory, { seconds: 4 })
    audio = makeTestAudio(directory, { seconds: 2 })
    image = await makeTestImage(directory)
  })

  test.beforeEach(async ({ request }) => {
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
  })

  test('ゲーム録画を取り込むと、再生できない形式ならプロキシを作ってプレビューに映す', async ({ page, request }) => {
    await openFresh(page)
    await importFile(page, request, video)

    const item = page.getByTestId('timeline-item').and(page.locator('[data-item-type="video"]'))
    await expect(item).toHaveCount(1)
    await expect(item).toContainText('game.mp4')
    await expect(page.getByTestId('layer-lyr_bg').getByTestId('timeline-item')).toHaveCount(1)
    await expect(page.getByTestId('inspector-type')).toHaveText('動画')
    await expect(page.getByTestId('license-source')).toHaveValue('自分で録画')

    // 左半分が赤・右半分が青の映像が画面いっぱいに映る
    const stage = page.getByTestId('preview-canvas')
    await expect.poll(() => countColor(stage, RED), { timeout: 30_000 }).toBeGreaterThan(QUARTER * 1.6)
    await expect.poll(() => countColor(stage, BLUE)).toBeGreaterThan(QUARTER * 1.6)
    await expect(page.getByTestId('proxy-status')).toBeHidden()

    // 再生すると再生位置が進む
    await page.getByTestId('play-toggle').click()
    await expect.poll(async () => (await page.getByTestId('playhead').textContent()) ?? '').not.toMatch(/^0:00\.000/)
    await page.getByTestId('play-toggle').click()
  })

  test('読み込む前にプレビュー画質を選べ、読み込んだ後も動画ごとに変えられる(書き出しには関係しない)', async ({ page, request }) => {
    await openFresh(page)
    const header = page.getByTestId('import-preview-quality')
    await header.selectOption('360')
    await importFile(page, request, video)
    const stage = page.getByTestId('preview-canvas')
    await expect.poll(() => countColor(stage, RED), { timeout: 30_000 }).toBeGreaterThan(QUARTER * 1.6)
    // 読み込んだ動画には選んだ画質が付く
    const quality = page.getByTestId('inspector-preview-quality')
    await expect(quality).toHaveValue('360')

    // インスペクタで元の画質に変えると、プレビュー用の動画を作り直して映す
    await quality.selectOption('original')
    await expect(quality).toHaveValue('original')
    await expect.poll(() => countColor(stage, RED), { timeout: 30_000 }).toBeGreaterThan(QUARTER * 1.6)
    await expect(page.getByTestId('proxy-status')).toBeHidden({ timeout: 30_000 })
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(quality).toHaveValue('360')

    // 選んだ既定の画質は、開き直しても残る
    await page.goto('/')
    await expect(page.getByTestId('import-preview-quality')).toHaveValue('360')
    await page.getByTestId('import-preview-quality').selectOption('auto')
  })

  test('ズーム枠を置くと、その時点のコマを静止画にしてズームとグループにする(切り替えもできる)', async ({ page, request }) => {
    await openFresh(page)
    await importFile(page, request, video)
    const stage = page.getByTestId('preview-canvas')
    await expect.poll(() => countColor(stage, RED), { timeout: 30_000 }).toBeGreaterThan(QUARTER * 1.6)
    await page.getByTestId('timeline-ruler').click({ position: { x: 60, y: 5 } })

    await expect(page.getByTestId('zoom-on-still')).toBeChecked()
    await page.getByTestId('add-zoom').click()
    const zoom = page.locator('[data-item-type="zoom"]')
    await expect(zoom).toHaveCount(1)
    const still = page.locator('[data-item-type="video"]', { hasText: '静止画' })
    await expect(still).toHaveCount(1)
    const group = await zoom.getAttribute('data-group-id')
    expect(group).toBeTruthy()
    await expect(still).toHaveAttribute('data-group-id', group!)
    // 1回の取り消しで両方戻る
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(zoom).toHaveCount(0)
    await expect(still).toHaveCount(0)

    // 切るとズームだけ
    await page.getByTestId('zoom-on-still').uncheck()
    await page.getByTestId('add-zoom').click()
    await expect(zoom).toHaveCount(1)
    await expect(still).toHaveCount(0)
    await page.getByTestId('zoom-on-still').check()
  })

  test('倍速にした区間の前から再生しても、プレビューが点滅しない', async ({ page, request }) => {
    // 切った所のフェード(わざと暗くなる)は、点滅と見分けがつかないので切っておく
    await openFresh(page)
    await page.getByTestId('open-settings').click()
    await page.getByTestId('settings-tab-editing').click()
    for (const id of ['editing-cutFadeInMs', 'editing-cutFadeOutMs']) {
      await page.getByTestId(id).fill('0')
      await page.getByTestId(id).press('Enter')
      await expect(page.getByTestId(id)).toHaveValue('0')
    }
    await page.keyboard.press('Escape')
    // アプリの既定は元に戻しておく(ほかのテストの新しいプロジェクトに効かないように)
    await updateSettings(request, { editing: { cutFadeInMs: 300, cutFadeOutMs: 300 } })
    await importFile(page, request, video)
    const stage = page.getByTestId('preview-canvas')
    await expect.poll(() => countColor(stage, RED), { timeout: 30_000 }).toBeGreaterThan(QUARTER * 1.6)

    // 1秒で分割し、後ろ側を2倍速にする
    const ruler = page.getByTestId('timeline-ruler')
    await ruler.click({ position: { x: 60, y: 5 } })
    await page.keyboard.press('s')
    const videos = page.locator('[data-item-type="video"]')
    await expect(videos).toHaveCount(2)
    await videos.nth(1).click({ button: 'right' })
    await page.getByTestId('context-menu').getByTestId('menu-speed').hover()
    await page.getByTestId('menu-speed-2').click()

    // 頭から再生し、描いたコマごとに映像が映っているか調べる(映像が消えたコマ = 点滅)
    await ruler.click({ position: { x: 1, y: 5 } })
    await expect.poll(() => countColor(stage, RED)).toBeGreaterThan(QUARTER * 1.6)
    await page.getByTestId('play-toggle').click()
    const blank = await stage.evaluate(async (element) => {
      // このファイルは DOM の型を読み込まないので、使う分だけ形を書く。
      const canvas = element as unknown as {
        width: number
        height: number
        getContext(type: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } }
      }
      const nextFrame = (globalThis as unknown as { requestAnimationFrame(callback: () => void): number }).requestAnimationFrame
      const context = canvas.getContext('2d')
      let missing = 0
      let frames = 0
      const started = performance.now()
      while (performance.now() - started < 2200) {
        await new Promise<void>((resolve) => nextFrame(() => resolve()))
        frames++
        // 左の1/4あたりは、映像があれば赤
        const [r, g, b] = context.getImageData(Math.floor(canvas.width / 4), Math.floor(canvas.height / 2), 1, 1).data
        if (!(r! > 200 && g! < 60 && b! < 60)) missing++
      }
      return { missing, frames }
    })
    await page.getByTestId('play-toggle').click()
    expect(blank.frames).toBeGreaterThan(20)
    expect(blank.missing).toBe(0)
  })

  test('タイムラインでドラッグして動かし、端をつまんで縮め、元に戻せる', async ({ page, request }) => {
    await openFresh(page)
    await importFile(page, request, image)
    const item = page.locator('[data-item-type="image"]')
    await expect(item).toHaveCount(1)
    await expect(page.getByTestId('inspector-duration')).toHaveValue('5')

    // 60px = 1秒。右へ 120px ドラッグすると 2秒後ろへ
    const box = (await item.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 4 })
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 4 })
    await page.mouse.up()
    await expect(page.getByTestId('inspector-start')).toHaveValue('2')

    // 右端を左へ 60px で 1秒短く
    const end = item.getByTestId('trim-end')
    const endBox = (await end.boundingBox())!
    await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(endBox.x - 30, endBox.y + endBox.height / 2, { steps: 3 })
    await page.mouse.move(endBox.x - 60 + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 3 })
    await page.mouse.up()
    await expect(page.getByTestId('inspector-duration')).toHaveValue('4')

    // 下のレイヤーへドラッグして移す(背景 → 1段下は無いので、上のズームレイヤーへ)
    const moved = (await item.boundingBox())!
    await page.mouse.move(moved.x + 20, moved.y + moved.height / 2)
    await page.mouse.down()
    await page.mouse.move(moved.x + 20, moved.y + moved.height / 2 - 20, { steps: 3 })
    await page.mouse.move(moved.x + 20, moved.y + moved.height / 2 - 36, { steps: 3 })
    await page.mouse.up()
    await expect(page.getByTestId('inspector-layer')).toHaveValue('lyr_zoom')

    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(page.getByTestId('inspector-layer')).toHaveValue('lyr_bg')
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(page.getByTestId('inspector-duration')).toHaveValue('5')
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(page.getByTestId('inspector-start')).toHaveValue('0')

    // Delete キーで消せる
    await item.click()
    await page.keyboard.press('Delete')
    await expect(item).toHaveCount(0)
  })

  test('ズーム枠を置き、枠を動かして大きさを変え、拡大した結果を確かめられる', async ({ page, request }) => {
    await openFresh(page)
    await importFile(page, request, video)
    const stage = page.getByTestId('preview-canvas')
    await expect.poll(() => countColor(stage, BLUE), { timeout: 30_000 }).toBeGreaterThan(QUARTER * 1.6)

    await page.getByTestId('add-zoom').click()
    await expect(page.locator('[data-item-type="zoom"]')).toHaveCount(1)
    await expect(page.getByTestId('layer-lyr_zoom').getByTestId('timeline-item')).toHaveCount(1)
    const frame = page.getByTestId('zoom-frame')
    await expect(frame).toBeVisible()
    // 既定は画面中央の半分の大きさ
    await expect(frame).toHaveAttribute('data-region', '480,270,960')

    // 枠を左端へ動かす(画面の外へは出ない)
    const frameBox = (await frame.boundingBox())!
    await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(frameBox.x - 400, frameBox.y + frameBox.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect(frame).toHaveAttribute('data-region', '0,270,960')

    // 右下の角を内側へ引くと、縦横比を保ったまま小さくなる
    const corner = page.getByTestId('zoom-handle-se')
    const cornerBox = (await corner.boundingBox())!
    await page.mouse.move(cornerBox.x + 6, cornerBox.y + 6)
    await page.mouse.down()
    await page.mouse.move(cornerBox.x - frameBox.width / 4, cornerBox.y + 6, { steps: 5 })
    await page.mouse.up()
    const region = (await frame.getAttribute('data-region'))!.split(',').map(Number)
    expect(region[0]).toBe(0)
    expect(region[1]).toBe(270)
    expect(region[2]).toBeGreaterThan(500)
    expect(region[2]).toBeLessThan(900)
    await expect(page.getByTestId('zoom-width')).toHaveValue(String(region[2]))

    // 編集中は拡大前の画面(青も見える)。「拡大して確認」で左側(赤)に寄った画面になる
    expect(await countColor(stage, BLUE)).toBeGreaterThan(QUARTER)
    await page.getByTestId('zoom-check').check()
    await expect(frame).toBeHidden()
    await expect.poll(() => countColor(stage, BLUE)).toBe(0)
    await expect.poll(() => countColor(stage, RED)).toBeGreaterThan(QUARTER * 3.5)

    // 寄り方を変えられる
    await page.getByTestId('zoom-method').selectOption('punch')
    await expect(page.locator('[data-item-type="zoom"]')).toContainText('パンチイン')

    // 取り消すと枠の変更も戻る
    await page.getByTestId('zoom-check').uncheck()
    await page.getByRole('button', { name: '元に戻す' }).click()
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(frame).toHaveAttribute('data-region', '0,270,960')
  })

  test('BGM を置くと BGM レイヤーに入り、波形が出て、ループさせて伸ばせる', async ({ page, request }) => {
    await openFresh(page)
    await importFile(page, request, audio)
    const item = page.locator('[data-item-type="audio"]')
    await expect(page.getByTestId('layer-lyr_bgm').getByTestId('timeline-item')).toHaveCount(1)
    await expect(item.locator('canvas')).toBeVisible()
    await expect(page.getByTestId('inspector-duration')).toHaveValue('2')
    await expect(page.getByTestId('license-credit-required')).toBeChecked()

    // ループしないと素材より長くはできない
    await page.getByTestId('inspector-duration').fill('6')
    await page.getByTestId('inspector-duration').blur()
    await expect(page.getByRole('alert')).toContainText('素材の末尾より後には伸ばせません')
    await page.getByRole('alert').getByRole('button', { name: '閉じる' }).click()

    await page.getByTestId('inspector-loop').check()
    await page.getByTestId('inspector-duration').fill('6')
    await page.getByTestId('inspector-duration').blur()
    await expect(page.getByTestId('inspector-duration')).toHaveValue('6')

    // 再生しても止まらずに進む(音はブラウザの中で鳴る)
    await page.getByTestId('play-toggle').click()
    await expect.poll(async () => (await page.getByTestId('playhead').textContent()) ?? '').not.toMatch(/^0:00\.000/)
    await page.getByTestId('play-toggle').click()
  })

  test('素材を付けたプロジェクトを保存して開き直せる', async ({ page, request }) => {
    await openFresh(page)
    await importFile(page, request, image)
    await page.getByTestId('add-zoom').click()
    const path = join(directory, 'media.zsproj')
    await queuePick(request, [path])
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText(path)).toBeVisible()

    await page.goto('/')
    await queuePick(request, [path])
    await page.getByRole('button', { name: '開く' }).click()
    await expect(page.locator('[data-item-type="image"]')).toHaveCount(1)
    await expect(page.locator('[data-item-type="zoom"]')).toHaveCount(1)
    // 黄色の画像がプレビューに出る
    await expect.poll(() => countColor(page.getByTestId('preview-canvas'), [255, 204, 0], 20)).toBeGreaterThan(50)
  })
})
