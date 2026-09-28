import { expect, test, type Page } from '@playwright/test'

import { openFresh, updateSettings } from './helpers'

/** 字幕の数値の欄に入れて確定する。 */
async function commit(page: Page, testId: string, value: string): Promise<void> {
  const input = page.getByTestId(testId)
  await input.fill(value)
  await input.press('Enter')
}

async function openCharacter(page: Page, name: string): Promise<void> {
  await page.getByTestId('open-characters').click()
  await page.locator('.character-dialog__item', { hasText: name }).click()
  await expect(page.getByTestId('subtitle-editor')).toBeVisible()
}

test.describe('字幕(ボイステロップ)の編集', () => {
  test.beforeEach(async ({ request }) => {
    await updateSettings(request, { subtitle: { defaults: null, characterOutlineColors: true } })
  })

  test('位置・フォント・大きさを変え、アプリの既定にすると新しいプロジェクトのキャラクターにも使われる', async ({ page }) => {
    // 「新規」で出る「保存していない変更を破棄しますか」は受け入れる
    page.on('dialog', (dialog) => void dialog.accept())
    await openFresh(page)
    await page.getByRole('button', { name: 'ずんだもん(あなた)と四国めたん(AI)を追加' }).click()
    await openCharacter(page, 'ずんだもん')

    // 定番の置き場所: 上・中央
    await page.getByTestId('subtitle-preset-top-center').click()
    await expect(page.getByTestId('subtitle-y')).toHaveValue('151')
    await expect(page.getByTestId('subtitle-x')).toHaveValue('960')

    // 見本をクリック(ドラッグ)した場所が字幕の位置になる
    const sample = page.getByTestId('subtitle-sample')
    const box = (await sample.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.8, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => Number(await page.getByTestId('subtitle-x').inputValue())).toBeGreaterThan(1400)
    await expect.poll(async () => Number(await page.getByTestId('subtitle-y').inputValue())).toBeGreaterThan(800)

    // フォント・大きさ・太さ・揃え方・行の文字数
    await commit(page, 'subtitle-font', 'BIZ UDPゴシック')
    await commit(page, 'subtitle-size', '80')
    await page.getByTestId('subtitle-weight').selectOption('900')
    await page.getByTestId('subtitle-anchor').selectOption('bottom-left')
    await commit(page, 'subtitle-chars', '18')
    await expect(page.getByTestId('subtitle-font')).toHaveValue('BIZ UDPゴシック')
    await expect(page.getByTestId('subtitle-size')).toHaveValue('80')

    // 範囲外の大きさは受け付けず、元の値に戻す
    await commit(page, 'subtitle-size', '9999')
    await expect(page.getByTestId('subtitle-size')).toHaveValue('80')

    // 取り消し(Ctrl+Z)で戻せる
    await page.getByTestId('subtitle-outline').uncheck()
    await expect(page.getByTestId('subtitle-outline-color')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+z')
    await openCharacter(page, 'ずんだもん')
    await expect(page.getByTestId('subtitle-outline-color')).toBeVisible()

    // アプリの既定にする
    await page.getByTestId('subtitle-save-default').click()
    await expect(page.getByTestId('subtitle-notice')).toContainText('アプリの既定にしました')
    await expect(page.getByTestId('subtitle-default-summary')).toContainText('BIZ UDPゴシック / 80px')

    // ほかのキャラクター(めたん)にも同じ見た目を使う。縁取りの色はめたんのまま
    const zundaOutline = await page.getByTestId('subtitle-outline-color').inputValue()
    await page.getByTestId('subtitle-apply-others').click()
    await page.locator('.character-dialog__item', { hasText: '四国めたん' }).click()
    await expect(page.getByTestId('subtitle-size')).toHaveValue('80')
    await expect(page.getByTestId('subtitle-font')).toHaveValue('BIZ UDPゴシック')
    await expect(page.getByTestId('subtitle-outline-color')).not.toHaveValue(zundaOutline)
    await page.keyboard.press('Escape')

    // 新しいプロジェクトで作ったキャラクターにも既定が使われる
    await page.getByRole('button', { name: '新規' }).click()
    await page.getByRole('button', { name: 'ずんだもん(あなた)と四国めたん(AI)を追加' }).click()
    await openCharacter(page, '四国めたん')
    await expect(page.getByTestId('subtitle-size')).toHaveValue('80')
    await expect(page.getByTestId('subtitle-font')).toHaveValue('BIZ UDPゴシック')
    await expect(page.getByTestId('subtitle-weight')).toHaveValue('900')
    await expect(page.getByTestId('subtitle-anchor')).toHaveValue('bottom-left')
    await expect(page.getByTestId('subtitle-chars')).toHaveValue('18')

    // 既定をはじめの設定に戻すと、次からは組み込みの見た目
    await page.getByTestId('subtitle-clear-default').click()
    await expect(page.getByTestId('subtitle-default-summary')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '新規' }).click()
    await page.getByRole('button', { name: 'ずんだもん(あなた)と四国めたん(AI)を追加' }).click()
    await openCharacter(page, 'ずんだもん')
    await expect(page.getByTestId('subtitle-size')).toHaveValue('64')
  })
})
