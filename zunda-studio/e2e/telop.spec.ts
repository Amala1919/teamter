import { expect, test, type Locator, type Page } from '@playwright/test'

import { openFresh, updateSettings } from './helpers'

/** プレビューのうち、色が近い画素の数(4画素に1つ調べる)。 */
async function countColor(canvas: Locator, color: readonly number[], tolerance = 40): Promise<number> {
  return canvas.evaluate(
    (element, [target, limit]) => {
      // e2e は DOM の型を読み込まないので、使う分だけ形を書く。
      const canvasElement = element as unknown as {
        width: number
        height: number
        getContext(type: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } | null
      }
      const context = canvasElement.getContext('2d')
      if (!context) return 0
      const { data } = context.getImageData(0, 0, canvasElement.width, canvasElement.height)
      let count = 0
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

/** 色の欄を変える(色の窓を閉じたときと同じく、change まで起こす)。 */
async function pickColor(page: Page, testId: string, color: string): Promise<void> {
  await page.getByTestId(testId).fill(color)
}

async function commitNumber(page: Page, testId: string, value: string): Promise<void> {
  const input = page.getByTestId(testId)
  await input.fill(value)
  await input.press('Enter')
}

test.describe('テロップの編集', () => {
  test('色・帯・ひな形・文字送り・配置をインスペクタで変えられ、プレビューに出る', async ({ page }) => {
    await openFresh(page)
    await page.getByTestId('add-caption').click()
    await expect(page.getByTestId('text-inspector')).toBeVisible()
    const canvas = page.getByTestId('preview-canvas')

    // 文字の色(縁取りも付いたまま)
    await pickColor(page, 'telop-color', '#00ff00')
    await expect.poll(() => countColor(canvas, [0, 255, 0])).toBeGreaterThan(50)

    // ひな形「黒帯」で帯が付き、帯の色を変えられる
    await page.getByTestId('telop-preset-darkBand').click()
    await expect(page.getByTestId('telop-band')).toBeChecked()
    await pickColor(page, 'telop-band-color', '#ff0000')
    await commitNumber(page, 'telop-band-opacity', '100')
    await expect.poll(() => countColor(canvas, [255, 0, 0])).toBeGreaterThan(1000)
    // 黒帯のひな形は文字を白にする(先に変えた緑は消える)
    await expect.poll(() => countColor(canvas, [0, 255, 0])).toBe(0)

    // 「スタイルのまま」で上書きが消える
    await page.getByTestId('telop-preset-plain').click()
    await expect(page.getByTestId('telop-band')).not.toBeChecked()
    await expect.poll(() => countColor(canvas, [255, 0, 0])).toBe(0)
    await expect(page.getByTestId('telop-reset-look')).toBeDisabled()

    // 文字送り・大きさ・揃え
    await commitNumber(page, 'telop-typewriter', '1.5')
    await expect(page.getByTestId('telop-typewriter')).toHaveValue('1.5')
    await commitNumber(page, 'telop-size', '120')
    await expect(page.getByTestId('telop-size')).toHaveValue('120')
    await page.getByTestId('telop-align').selectOption('left')
    await expect(page.getByTestId('telop-align')).toHaveValue('left')

    // 配置のボタン: 上・右へ
    await page.getByTestId('telop-place-top').click()
    await expect.poll(async () => Number(await page.getByTestId('transform-y').inputValue())).toBeLessThan(200)
    await page.getByTestId('telop-place-right').click()
    await expect.poll(async () => Number(await page.getByTestId('transform-x').inputValue())).toBeGreaterThan(1500)

    // 取り消せる
    await page.keyboard.press('Control+z')
    await expect.poll(async () => Number(await page.getByTestId('transform-x').inputValue())).toBe(960)
  })

  test('プレビューでテロップをクリックして選び、枠をドラッグして動かし、四隅で大きさを変えられる(設定で切れる)', async ({ page, request }) => {
    try {
      await openFresh(page)
      await page.getByTestId('add-caption').click()
      const frame = page.getByTestId('item-frame')
      await expect(frame).toBeVisible()
      const box = (await frame.boundingBox())!
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      const canvas = page.getByTestId('preview-canvas')
      const canvasBox = (await canvas.boundingBox())!
      const ratio = 1920 / canvasBox.width

      // 内側をドラッグして右へ動かす
      await page.mouse.move(center.x, center.y)
      await page.mouse.down()
      await page.mouse.move(center.x + 100, center.y, { steps: 5 })
      await page.mouse.up()
      await expect
        .poll(async () => Number(await page.getByTestId('transform-x').inputValue()))
        .toBeCloseTo(960 + 100 * ratio, -1)

      // 右下の角を外へ引くと大きくなる
      const handle = (await page.getByTestId('item-handle-se').boundingBox())!
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x + 40, handle.y + 30, { steps: 5 })
      await page.mouse.up()
      await expect.poll(async () => Number(await page.getByTestId('transform-scale').inputValue())).toBeGreaterThan(100)

      // 1回ずつ取り消せる
      await page.keyboard.press('Control+z')
      await expect(page.getByTestId('transform-scale')).toHaveValue('100')

      // 何も無い所をクリックすると選ぶのをやめ、テロップをクリックするとまた選ぶ
      const moved = (await frame.boundingBox())!
      const telopPoint = { x: moved.x + moved.width / 2 - canvasBox.x, y: moved.y + moved.height / 2 - canvasBox.y }
      await canvas.click({ position: { x: 10, y: 10 } })
      await expect(frame).toHaveCount(0)
      await canvas.click({ position: telopPoint })
      await expect(frame).toBeVisible()
      await expect(page.getByTestId('inspector-type')).toHaveText('テロップ')

      // 設定で切ると、クリックしても選ばない
      await page.getByTestId('open-settings').click()
      await page.getByTestId('settings-tab-editing').click()
      await page.getByTestId('editing-previewClickSelect').uncheck()
      await page.keyboard.press('Escape')
      await canvas.click({ position: { x: 10, y: 10 } })
      await expect(frame).toHaveCount(0)
      await canvas.click({ position: telopPoint })
      await expect(frame).toHaveCount(0)
    } finally {
      await updateSettings(request, { ui: { previewClickSelect: true } })
    }
  })

  test('見た目をコピーしてほかのテロップに貼れ、複数選んでまとめて変えられる', async ({ page }) => {
    await openFresh(page)
    const texts = page.locator('[data-item-type="text"]')
    await page.getByTestId('add-caption').click()
    await page.getByTestId('telop-preset-yellow').click()
    // 10秒の所にもう1つ
    const ruler = page.getByTestId('timeline-ruler')
    await ruler.click({ position: { x: 600, y: 5 } })
    await page.getByTestId('add-caption').click()
    await expect(texts).toHaveCount(2)
    await expect(page.getByTestId('telop-color')).not.toHaveValue('#ffe14d')

    // 1つめの見た目をコピーして、2つめに貼る
    await texts.first().click({ button: 'right' })
    await page.getByTestId('context-menu').getByTestId('menu-copy-look').click()
    await texts.last().click({ button: 'right' })
    await page.getByTestId('context-menu').getByTestId('menu-paste-look').click()
    await texts.last().click()
    await expect(page.getByTestId('telop-color')).toHaveValue('#ffe14d')
    await expect(page.getByTestId('telop-weight')).toHaveValue('900')

    // 2つ選ぶと、見た目はまとめて変わる
    await texts.first().click()
    await texts.last().click({ modifiers: ['Shift'] })
    await expect(page.getByTestId('text-targets')).toContainText('2個')
    await pickColor(page, 'telop-color', '#3366ff')
    for (const index of [0, 1]) {
      await texts.nth(index).click()
      await expect(page.getByTestId('telop-color')).toHaveValue('#3366ff')
    }
  })
})
