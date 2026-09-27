import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { makeTestImage, makeTestVideo } from '../tests/fixtures/media'
import { openFresh, queuePick, updateSettings } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

/** タイムラインは既定で 60px = 1秒。 */
const PX_PER_SECOND = 60

async function rightClickAt(page: Page, testId: string, seconds: number): Promise<void> {
  const box = (await page.getByTestId(testId).boundingBox())!
  await page.mouse.click(box.x + seconds * PX_PER_SECOND, box.y + box.height / 2, { button: 'right' })
}

async function choose(page: Page, testId: string): Promise<void> {
  await page.getByTestId('context-menu').getByTestId(testId).click()
  await expect(page.getByTestId('context-menu')).toHaveCount(0)
}

test.describe('右クリックとショートカットでの編集', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zunda-e2e-editing-'))
  let image: string
  let video: string

  test.beforeAll(async () => {
    image = await makeTestImage(directory)
    video = makeTestVideo(directory, { seconds: 4 })
  })

  test.beforeEach(async ({ request }) => {
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
  })

  test('分割・コピー・貼り付け・空白を詰める・削除して詰める・複製', async ({ page, request }) => {
    await openFresh(page)
    await queuePick(request, [image])
    await page.getByTestId('add-media').click()
    const images = page.locator('[data-item-type="image"]')
    await expect(images).toHaveCount(1)

    // 目盛りの右クリックで再生位置を 2 秒へ
    await rightClickAt(page, 'timeline-ruler', 2)
    await page.getByTestId('context-menu').getByText('再生位置をここへ').click()
    await expect(page.getByTestId('playhead')).toContainText('0:02.000')

    // アイテムの右クリック → 再生位置で分割
    await images.first().click({ button: 'right' })
    await choose(page, 'menu-split')
    await expect(images).toHaveCount(2)
    await expect(page.getByTestId('inspector-duration')).toHaveValue('2')

    // 取り消して、今度は S キーで分割
    await page.keyboard.press('Control+z')
    await expect(images).toHaveCount(1)
    await page.keyboard.press('s')
    await expect(images).toHaveCount(2)

    // 後半をコピーして、8秒の位置のレーンに貼り付け(貼ったものが選ばれる)
    await images.nth(1).click({ button: 'right' })
    await choose(page, 'menu-copy')
    await rightClickAt(page, 'lane-lyr_bg', 8)
    await choose(page, 'menu-paste-here')
    await expect(images).toHaveCount(3)
    await expect(page.getByTestId('inspector-start')).toHaveValue('8')

    // 5〜8秒の空白を詰めると、貼ったものが 5 秒に寄る
    await rightClickAt(page, 'lane-lyr_bg', 6.5)
    await choose(page, 'menu-close-gap')
    await expect(page.getByTestId('inspector-start')).toHaveValue('5')

    // 先頭(0〜2秒)を削除して詰めると、残りが前へ寄る
    await images.first().click({ button: 'right' })
    await choose(page, 'menu-ripple-delete')
    await expect(images).toHaveCount(2)
    await images.last().click()
    await expect(page.getByTestId('inspector-start')).toHaveValue('3')

    // Ctrl+D ですぐ後ろに複製
    await page.keyboard.press('Control+d')
    await expect(images).toHaveCount(3)
    await expect(page.getByTestId('inspector-start')).toHaveValue('6')

    // フェードは右クリックから付けられる
    await images.first().click({ button: 'right' })
    await page.getByTestId('context-menu').getByTestId('menu-fade').hover()
    await choose(page, 'menu-fade-both')
    await expect(page.getByTestId('effect-row')).toHaveCount(1)
    await expect(page.getByTestId('effect-row')).toContainText('フェード')
  })

  test('メニューはキーで操作でき、動画の速度を変えられ、プレビューからズーム枠を置ける', async ({ page, request }) => {
    await openFresh(page)
    await queuePick(request, [video])
    await page.getByTestId('add-media').click()
    const clip = page.locator('[data-item-type="video"]')
    await expect(clip).toHaveCount(1)
    await expect(page.getByTestId('inspector-duration')).toHaveValue('4')

    // Esc で閉じる
    await clip.click({ button: 'right' })
    await expect(page.getByTestId('context-menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('context-menu')).toHaveCount(0)

    // 速度 → 2倍 で長さが半分になる
    await clip.click({ button: 'right' })
    await page.getByTestId('context-menu').getByTestId('menu-speed').hover()
    await choose(page, 'menu-speed-2')
    await expect(page.getByTestId('inspector-duration')).toHaveValue('2')
    await expect(page.getByTestId('inspector-speed')).toHaveValue('2')

    // キーボードだけで: 下へ移ってサブメニューを開き、選ぶ(速度 → 0.25 倍は一番上)
    await clip.click({ button: 'right' })
    const speed = page.getByTestId('context-menu').getByTestId('menu-speed')
    await speed.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('inspector-speed')).toHaveValue('0.25')

    // プレビューの右クリックで、その場所を中心にズーム枠を置く
    const canvas = page.getByTestId('preview-canvas')
    const box = (await canvas.boundingBox())!
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.25, { button: 'right' })
    await choose(page, 'menu-preview-zoom')
    await expect(page.getByTestId('inspector-type')).toHaveText('ズーム')
    await expect(page.locator('[data-item-type="zoom"]')).toHaveCount(1)
  })

  test('再生位置で止めて静止画を挟み、F キーでも止められる', async ({ page, request }) => {
    await openFresh(page)
    await queuePick(request, [video])
    await page.getByTestId('add-media').click()
    const clips = page.locator('[data-item-type="video"]')
    await expect(clips).toHaveCount(1)

    // 再生位置を 2 秒へ → 右クリックで 3 秒の静止画を挟む
    await rightClickAt(page, 'timeline-ruler', 2)
    await page.getByTestId('context-menu').getByText('再生位置をここへ').click()
    await clips.first().click({ button: 'right' })
    await page.getByTestId('context-menu').getByTestId('menu-freeze-insert').hover()
    await choose(page, 'menu-freeze-insert-3000')
    await expect(clips).toHaveCount(3)
    await expect(page.locator('.timeline__item--freeze')).toHaveCount(1)
    await expect(page.locator('.timeline__item--freeze')).toContainText('静止画')
    await expect(page.getByTestId('inspector-freeze')).toContainText('0:01.967')
    await expect(page.getByTestId('inspector-start')).toHaveValue('2')
    await expect(page.getByTestId('inspector-duration')).toHaveValue('3')

    // 後半は静止画の後ろ(5秒)から続く
    await clips.nth(2).click()
    await expect(page.getByTestId('inspector-start')).toHaveValue('5')

    // 取り消して、F キーで(再生位置の動画を)2 秒止める
    await page.keyboard.press('Control+z')
    await expect(clips).toHaveCount(1)
    await page.getByTestId('lane-lyr_bg').click({ position: { x: 900, y: 10 } })
    // (後半をクリックしたときに再生位置が 5 秒へ動いているので、2 秒へ戻す)
    await rightClickAt(page, 'timeline-ruler', 2)
    await page.getByTestId('context-menu').getByText('再生位置をここへ').click()
    await page.keyboard.press('f')
    await expect(clips).toHaveCount(3)
    await expect(page.getByTestId('inspector-duration')).toHaveValue('2')
  })

  test('プレビューでも、止めている間は止めたコマが映り続ける(止めているときも再生中も)', async ({ page, request }) => {
    // 0〜1.5秒は赤、1.5〜3秒は緑の動画
    const changing = join(directory, 'change.mp4')
    execFileSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=1.5',
      '-f', 'lavfi', '-i', 'color=c=lime:s=320x180:r=30:d=1.5',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', changing
    ])
    await openFresh(page)
    await queuePick(request, [changing])
    await page.getByTestId('add-media').click()
    await expect(page.locator('[data-item-type="video"]')).toHaveCount(1)
    await expect(page.getByTestId('proxy-status')).toBeHidden({ timeout: 30_000 })

    await rightClickAt(page, 'timeline-ruler', 1)
    await page.getByTestId('context-menu').getByText('再生位置をここへ').click()
    await page.keyboard.press('f')
    await expect(page.locator('.timeline__item--freeze')).toHaveCount(1)

    const center = (): Promise<number[]> =>
      page.getByTestId('preview-canvas').evaluate((element) => {
        const canvas = element as unknown as {
          width: number
          height: number
          getContext(type: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } }
        }
        const data = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data
        return [data[0]!, data[1]!, data[2]!]
      })
    const isRed = ([r, g]: number[]): boolean => r! > 180 && g! < 90
    const isGreen = ([r, g]: number[]): boolean => g! > 180 && r! < 90

    // 止めている 1〜3 秒の間(元の動画なら 2.5 秒は緑)は赤のまま
    await rightClickAt(page, 'timeline-ruler', 2.5)
    await page.getByTestId('context-menu').getByText('再生位置をここへ').click()
    await expect.poll(async () => isRed(await center()), { timeout: 10_000 }).toBe(true)
    // 止め終わってから 1.2 秒進んだ所(素材の 2.2 秒)は緑
    await rightClickAt(page, 'timeline-ruler', 4.2)
    await page.getByTestId('context-menu').getByText('再生位置をここへ').click()
    await expect.poll(async () => isGreen(await center()), { timeout: 10_000 }).toBe(true)

    // 再生中も、止めている間は赤
    await rightClickAt(page, 'timeline-ruler', 1.2)
    await page.getByTestId('context-menu').getByText('再生位置をここへ').click()
    await page.getByTestId('play-toggle').click()
    await expect.poll(async () => (await page.getByTestId('playhead').textContent()) ?? '').toMatch(/^0:0[12]\./)
    await page.waitForTimeout(600)
    const during = await center()
    await page.getByTestId('play-toggle').click()
    expect(isRed(during)).toBe(true)
  })
})
