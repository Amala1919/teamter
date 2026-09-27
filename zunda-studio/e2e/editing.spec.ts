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
})
