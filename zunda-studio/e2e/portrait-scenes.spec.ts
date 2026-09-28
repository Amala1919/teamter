import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { COLORS, writePortraitPsd } from '../tests/fixtures/portrait-psd'
import { openFresh, queuePick, updateSettings } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

/** canvas の中で、指定した色の画素がある範囲(キャンバス座標)。無ければ null。 */
async function colorBounds(canvas: Locator, color: readonly number[], tolerance = 12): Promise<{ x0: number; y0: number; x1: number; y1: number } | null> {
  return canvas.evaluate(
    (element, [target, limit]) => {
      const canvasElement = element as unknown as {
        width: number
        height: number
        getContext(type: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } | null
      }
      const context = canvasElement.getContext('2d')
      if (!context) return null
      const { width, height } = canvasElement
      const { data } = context.getImageData(0, 0, width, height)
      let box: { x0: number; y0: number; x1: number; y1: number } | null = null
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          const index = (y * width + x) * 4
          if (
            Math.abs(data[index]! - target[0]!) <= limit &&
            Math.abs(data[index + 1]! - target[1]!) <= limit &&
            Math.abs(data[index + 2]! - target[2]!) <= limit
          ) {
            box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) } : { x0: x, y0: y, x1: x, y1: y }
          }
        }
      }
      return box
    },
    [color, tolerance] as const
  )
}

/** キャンバス座標を画面の座標に直す。 */
async function toClient(page: Page, canvas: Locator, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = (await canvas.boundingBox())!
  const size = await canvas.evaluate((element) => ({ width: (element as unknown as { width: number }).width, height: (element as unknown as { height: number }).height }))
  return { x: box.x + (x / size.width) * box.width, y: box.y + (y / size.height) * box.height }
}

test.describe('場面ごとの立ち絵', () => {
  test.beforeEach(async ({ request }) => {
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
  })

  test('プレビューで立ち絵を動かし、場面ごとに位置・出し入れを変え、話し手を強調できる', async ({ page, request }) => {
    const psdPath = await writePortraitPsd(mkdtempSync(join(tmpdir(), 'zunda-psd-scene-')))
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('open-characters').click()
    await queuePick(request, [psdPath])
    await page.getByTestId('portrait-pick').click()
    await expect(page.getByTestId('portrait-section').getByTestId('portrait-open-manager')).toBeVisible()
    await page.keyboard.press('Escape')

    const canvas = page.getByTestId('preview-canvas')
    await expect.poll(() => colorBounds(canvas, COLORS.body)).not.toBeNull()
    const before = (await colorBounds(canvas, COLORS.body))!

    // 立ち絵をクリックすると枠が出て(全体の配置)、ドラッグで動かせる
    const start = await toClient(page, canvas, (before.x0 + before.x1) / 2, (before.y0 + before.y1) / 2)
    await page.mouse.click(start.x, start.y)
    const frame = page.getByTestId('portrait-frame')
    await expect(frame).toContainText('全体の配置')
    const frameBox = (await frame.boundingBox())!
    await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(frameBox.x + frameBox.width / 2 - 40, frameBox.y + frameBox.height / 2, { steps: 3 })
    await page.mouse.move(frameBox.x + frameBox.width / 2 - 80, frameBox.y + frameBox.height / 2, { steps: 3 })
    await page.mouse.up()
    await expect.poll(async () => (await colorBounds(canvas, COLORS.body))!.x0).toBeLessThan(before.x0 - 50)

    // 右下の角で大きくできる
    const moved = (await colorBounds(canvas, COLORS.body))!
    const corner = (await page.getByTestId('portrait-handle-se').boundingBox())!
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2)
    await page.mouse.down()
    await page.mouse.move(corner.x + 30, corner.y + 30, { steps: 4 })
    await page.mouse.up()
    await expect.poll(async () => {
      const box = (await colorBounds(canvas, COLORS.body))!
      return box.y1 - box.y0
    }).toBeGreaterThan(moved.y1 - moved.y0 + 10)

    // 取り消すと大きさが戻る
    await page.keyboard.press('Control+z')
    await expect.poll(async () => {
      const box = (await colorBounds(canvas, COLORS.body))!
      return Math.abs(box.y1 - box.y0 - (moved.y1 - moved.y0))
    }).toBeLessThan(4)

    // 右クリック → この場面だけ動かせるようにする → 枠が「この区間の配置」になる
    const now = (await colorBounds(canvas, COLORS.body))!
    const point = await toClient(page, canvas, (now.x0 + now.x1) / 2, (now.y0 + now.y1) / 2)
    await page.mouse.click(point.x, point.y, { button: 'right' })
    await page.getByTestId('context-menu').getByTestId('menu-portrait-scene').click()
    await expect(page.getByTestId('portrait-scene-inspector')).toBeVisible()
    await expect(page.getByTestId('portrait-scene-kind')).toHaveValue('adjust')
    await expect(page.getByTestId('portrait-frame')).toContainText('この区間の配置')
    await expect(page.locator('[data-item-type="portrait"]')).toContainText('調整')

    // この区間だけ隠す → その間は立ち絵が出ない
    await page.getByTestId('portrait-scene-kind').selectOption('hide')
    await expect.poll(() => colorBounds(canvas, COLORS.body)).toBeNull()
    await page.keyboard.press('Control+z')
    await expect.poll(() => colorBounds(canvas, COLORS.body)).not.toBeNull()

    // レーンの右クリックで「この区間だけ出す(ふわっと)」を置くと、区間の外では出なくなる
    const lane = (await page.getByTestId('lane-lyr_portrait').boundingBox())!
    await page.mouse.click(lane.x + 60 * 10, lane.y + lane.height / 2, { button: 'right' })
    const menu = page.getByTestId('context-menu')
    await menu.getByTestId('menu-portrait-scene-at').hover()
    await menu.locator('[data-testid^="menu-portrait-scene-chr_"]').first().hover()
    await menu.getByTestId('menu-portrait-show-fade').click()
    await expect(page.getByTestId('portrait-scene-transition')).toHaveValue('fade')
    await expect(page.locator('[data-item-type="portrait"]', { hasText: '登場' })).toHaveCount(1)
    // 再生位置 0 秒(出す区間の外)では出ない
    await expect.poll(() => colorBounds(canvas, COLORS.body)).toBeNull()

    // 話し手の強調(動画全体の設定)
    await page.getByTestId('speaker-dim').selectOption('0.45')
    await page.getByTestId('speaker-hop').check()
    await expect(page.getByTestId('speaker-dim')).toHaveValue('0.45')
    await expect(page.getByTestId('speaker-hop')).toBeChecked()
  })
})
