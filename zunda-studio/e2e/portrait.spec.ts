import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Locator } from '@playwright/test'

import { COLORS, writePortraitPsd } from '../tests/fixtures/portrait-psd'
import { openFresh, queuePick, updateSettings } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

/** canvas の中に、指定した色(許容差つき)の画素がいくつあるか。 */
async function countColor(canvas: Locator, color: readonly number[], tolerance = 12): Promise<number> {
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
      for (let index = 0; index < data.length; index += 4) {
        if (
          Math.abs(data[index]! - target[0]!) <= limit &&
          Math.abs(data[index + 1]! - target[1]!) <= limit &&
          Math.abs(data[index + 2]! - target[2]!) <= limit &&
          data[index + 3]! > 200
        ) {
          count++
        }
      }
      return count
    },
    [color, tolerance] as const
  )
}

test.describe('PSD 立ち絵', () => {
  test.beforeEach(async ({ request }) => {
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
  })

  test('PSD を選ぶとパーツが推定され、プレビューに立ち絵が出て、表情を作ってセリフに付けられる', async ({ page, request }) => {
    const psdPath = await writePortraitPsd(mkdtempSync(join(tmpdir(), 'zunda-psd-')))

    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()

    // キャラクター画面で PSD を選ぶ
    await page.getByTestId('open-characters').click()
    await queuePick(request, [psdPath])
    await page.getByTestId('portrait-pick').click()
    const section = page.getByTestId('portrait-section')
    await expect(section.getByTestId('portrait-open-manager')).toBeVisible()
    await expect(section.getByText('portrait.psd')).toBeVisible()
    // 目は開いた目、口は「ん」で描かれている
    const thumb = section.getByTestId('portrait-preview')
    await expect.poll(() => countColor(thumb, COLORS.eyeOpen)).toBeGreaterThan(20)
    await expect.poll(() => countColor(thumb, COLORS.mouth.n)).toBeGreaterThan(5)

    // 素材マネージャーで「怒り」の表情を作る
    await section.getByTestId('portrait-open-manager').click()
    const manager = page.getByRole('dialog', { name: /立ち絵の設定/ })
    await manager.getByTestId('portrait-tab-expressions').click()
    await manager.getByTestId('add-expression').click()
    await manager.getByTestId('expression-name').fill('怒り')
    await manager.getByTestId('expression-name').blur()
    await manager.getByTestId('expression-eyebrow').selectOption({ label: '怒り' })
    // 動きを止めて試し表示を確かめる
    await manager.getByLabel('口パクとまばたきを動かす').uncheck()
    const managerPreview = manager.getByTestId('portrait-preview')
    await expect.poll(() => countColor(managerPreview, COLORS.browAngry)).toBeGreaterThan(20)
    await expect.poll(() => countColor(managerPreview, COLORS.browNormal)).toBe(0)
    // 一度パーツを選んだ後でも「なし」にでき、そのグループは何も表示されない(PSD で表示のパーツも消える)
    await manager.getByTestId('expression-eyebrow').selectOption({ label: '(なし・表示しない)' })
    await expect.poll(() => countColor(managerPreview, COLORS.browAngry)).toBe(0)
    await expect.poll(() => countColor(managerPreview, COLORS.browNormal)).toBe(0)
    // 「PSD の表示のまま」なら PSD で表示になっている眉が出る
    await manager.getByTestId('expression-eyebrow').selectOption({ label: '(PSD の表示のまま)' })
    await expect.poll(() => countColor(managerPreview, COLORS.browNormal)).toBeGreaterThan(20)
    await manager.getByTestId('expression-eyebrow').selectOption({ label: '怒り' })
    await expect.poll(() => countColor(managerPreview, COLORS.browAngry)).toBeGreaterThan(20)

    // Esc は上に重なった素材マネージャーだけを閉じる
    await page.keyboard.press('Escape')
    await expect(manager).toBeHidden()
    await expect(section).toBeVisible()

    // 入手元を書いておく
    await section.getByTestId('portrait-license-source').fill('https://example.com/zunda')
    await section.getByTestId('portrait-license-source').blur()
    await page.keyboard.press('Escape')
    await expect(section).toBeHidden()

    // 動画のプレビューに立ち絵が出ている
    const stage = page.locator('.preview__canvas')
    await expect.poll(() => countColor(stage, COLORS.eyeOpen)).toBeGreaterThan(20)
    await expect.poll(() => countColor(stage, COLORS.browAngry)).toBe(0)

    // セリフに「怒り」の表情を付けると、そのセリフの間は怒り眉になる
    await page.getByTestId('open-bulk').click()
    await page.getByTestId('bulk-text').fill('ずんだもん:怒ったのだ！')
    await page.getByTestId('bulk-submit').click()
    const line = page.getByTestId('script-line').first()
    await expect(line.getByTestId('synthesis-status')).toContainText('合成済み', { timeout: 30_000 })
    await line.getByTestId('line-expression').selectOption({ label: '怒り' })
    await line.locator('.script__index').click()
    await expect.poll(() => countColor(stage, COLORS.browAngry)).toBeGreaterThan(20)

    // 元に戻すと既定の表情に戻る
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(line.getByTestId('line-expression')).toHaveValue('')
    await expect.poll(() => countColor(stage, COLORS.browAngry)).toBe(0)
  })

  test('立ち絵を外すと素材も片付く', async ({ page, request }) => {
    const psdPath = await writePortraitPsd(mkdtempSync(join(tmpdir(), 'zunda-psd-')))
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('open-characters').click()
    await queuePick(request, [psdPath])
    await page.getByTestId('portrait-pick').click()
    const section = page.getByTestId('portrait-section')
    await expect(section.getByTestId('portrait-open-manager')).toBeVisible()

    await section.getByRole('button', { name: '立ち絵を外す' }).click()
    await expect(section.getByTestId('portrait-pick')).toBeVisible()
  })

  test('立ち絵を付けたプロジェクトを保存して開き直すと、立ち絵もそのまま出る', async ({ page, request }) => {
    const directory = mkdtempSync(join(tmpdir(), 'zunda-psd-'))
    const psdPath = await writePortraitPsd(directory)
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('open-characters').click()
    await queuePick(request, [psdPath])
    await page.getByTestId('portrait-pick').click()
    await expect(page.getByTestId('portrait-open-manager')).toBeVisible()
    await page.keyboard.press('Escape')

    const projectPath = join(directory, 'portrait.zsproj')
    await queuePick(request, [projectPath])
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText(projectPath)).toBeVisible()

    // 画面を読み込み直して(読み込み済みの PSD を忘れさせて)から開く
    await page.goto('/')
    await queuePick(request, [projectPath])
    await page.getByRole('button', { name: '開く' }).click()
    await expect(page.getByText(projectPath)).toBeVisible()
    await expect.poll(() => countColor(page.locator('.preview__canvas'), COLORS.eyeOpen)).toBeGreaterThan(20)
  })
})
