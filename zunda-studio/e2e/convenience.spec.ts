import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { openFresh, queuePick, updateSettings } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

async function addLines(page: Page, text: string, count: number): Promise<void> {
  await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
  await page.getByTestId('open-bulk').click()
  await page.getByTestId('bulk-text').fill(text)
  await page.getByTestId('bulk-submit').click()
  await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(count, { timeout: 30_000 })
}

test.describe('使い勝手の機能', () => {
  test.beforeEach(async ({ request }) => {
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
  })

  test('台本を検索して移動し、話者で絞ってまとめて置換でき、1回で取り消せる', async ({ page }) => {
    await openFresh(page)
    await addLines(page, 'ずんだもん:ボスのHPが多いのだ\n四国めたん:ＨＰより攻撃力よ\nずんだもん:hpを回復するのだ', 3)

    await page.getByTestId('script-text').first().click()
    await page.keyboard.press('Control+f')
    const query = page.getByTestId('script-find-query')
    await expect(query).toBeFocused()
    await query.fill('hp')
    // 1行目を選んでいるので、その行が1件目
    await expect(page.getByTestId('script-find-count')).toHaveText('1/3件')
    await expect(page.locator('.script__line--matched')).toHaveCount(3)
    await query.press('Enter')
    await expect(page.getByTestId('script-find-count')).toHaveText('2/3件')
    await query.press('Shift+Enter')
    await expect(page.getByTestId('script-find-count')).toHaveText('1/3件')
    await query.press('Enter')
    await expect(page.getByTestId('script-find-count')).toHaveText('2/3件')
    await expect(page.getByTestId('script-line').nth(1)).toHaveClass(/script__line--selected/)

    // ずんだもんのセリフだけ置換する
    const zunda = await page.locator('.script__speakerSelect').first().inputValue()
    await page.getByTestId('script-find-speaker').selectOption(zunda)
    await expect(page.getByTestId('script-find-count')).toContainText('/2件')
    await page.getByTestId('script-find-replacement').fill('体力')
    await page.getByTestId('script-find-replace-all').click()
    const texts = page.getByTestId('script-text')
    await expect(texts.nth(0)).toHaveValue('ボスの体力が多いのだ')
    await expect(texts.nth(1)).toHaveValue('ＨＰより攻撃力よ')
    await expect(texts.nth(2)).toHaveValue('体力を回復するのだ')
    await expect(page.getByTestId('script-find-count')).toHaveText('0件')

    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(texts.nth(0)).toHaveValue('ボスのHPが多いのだ')
    await expect(texts.nth(2)).toHaveValue('hpを回復するのだ')

    await query.press('Escape')
    await expect(page.getByTestId('script-find')).toHaveCount(0)
    await expect(page.locator('.script__line--matched')).toHaveCount(0)
  })

  test('保存したプロジェクトを「最近」から開ける', async ({ page, request }) => {
    const directory = mkdtempSync(join(tmpdir(), 'zs-recent-'))
    const projectPath = join(directory, `recent-${Date.now()}.zsproj`)
    await openFresh(page)
    const title = page.getByLabel('プロジェクト名')
    await title.fill('最近のテスト')
    await title.press('Enter')
    await queuePick(request, [projectPath])
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText(projectPath)).toBeVisible()

    await page.getByRole('button', { name: '新規' }).click()
    await expect(page.getByLabel('プロジェクト名')).not.toHaveValue('最近のテスト')
    await page.getByTestId('open-recent').click()
    const menu = page.getByTestId('context-menu')
    await menu.getByText(projectPath.split('/').at(-1)!.replace('.zsproj', ''), { exact: true }).click()
    await expect(page.getByText(projectPath)).toBeVisible()
    await expect(page.getByLabel('プロジェクト名')).toHaveValue('最近のテスト')
  })

  test('今の画面を PNG で保存できる', async ({ page, request }) => {
    const output = join(mkdtempSync(join(tmpdir(), 'zs-frame-')), 'frame.png')
    await openFresh(page)
    await page.getByTestId('add-caption').click()
    await queuePick(request, [output])
    await page.getByTestId('preview-canvas').click({ button: 'right' })
    await page.getByTestId('menu-preview-image-parent').hover()
    await page.getByTestId('menu-preview-image').click()
    await expect(page.getByTestId('preview-notice')).toContainText('frame.png')
    const bytes = readFileSync(output)
    expect(bytes.subarray(1, 4).toString()).toBe('PNG')
    // 動画と同じ大きさ(IHDR の幅・高さ)
    expect(bytes.readUInt32BE(16)).toBe(1920)
    expect(bytes.readUInt32BE(20)).toBe(1080)
  })

  test('ここから後ろをすべて選び、1つをドラッグするとまとめて動き、1回で取り消せる', async ({ page }) => {
    await openFresh(page)
    const ruler = page.getByTestId('timeline-ruler')
    const box = (await ruler.boundingBox())!
    const pxPerSecond = 60
    const seek = async (seconds: number): Promise<void> => {
      await ruler.click({ position: { x: seconds * pxPerSecond, y: box.height / 2 } })
    }
    for (const seconds of [0, 5, 10]) {
      await seek(seconds)
      await page.getByTestId('add-caption').click()
    }
    const captions = page.locator('[data-item-type="text"]')
    await expect(captions).toHaveCount(3)
    const starts = async (): Promise<string[]> =>
      (await captions.evaluateAll((elements) => elements.map((element) => element.getAttribute('title') ?? ''))).map((title) => title.split('\n')[1]!.split(' – ')[0]!).sort()
    expect(await starts()).toEqual(['0:00.000', '0:05.000', '0:10.000'])

    await ruler.click({ button: 'right', position: { x: 4 * pxPerSecond, y: box.height / 2 } })
    await page.getByTestId('context-menu').getByTestId('menu-ruler-select-from').click()
    await expect(page.locator('[data-item-type="text"][aria-pressed="true"]')).toHaveCount(2)

    // 選んだうちの1つ(5秒のもの)を右へ2秒ドラッグ
    const target = page.locator('[data-item-type="text"][title*="0:05.000 –"]')
    const itemBox = (await target.boundingBox())!
    await page.mouse.move(itemBox.x + 10, itemBox.y + itemBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(itemBox.x + 10 + pxPerSecond, itemBox.y + itemBox.height / 2, { steps: 4 })
    await page.mouse.move(itemBox.x + 10 + 2 * pxPerSecond, itemBox.y + itemBox.height / 2, { steps: 4 })
    await page.mouse.up()
    await expect.poll(starts).toEqual(['0:00.000', '0:07.000', '0:12.000'])

    await page.keyboard.press('Control+z')
    await expect.poll(starts).toEqual(['0:00.000', '0:05.000', '0:10.000'])
  })

  test('キーの操作の一覧を F1 と ? ボタンで出せる', async ({ page }) => {
    await openFresh(page)
    await page.keyboard.press('F1')
    await expect(page.getByTestId('shortcuts')).toContainText('Ctrl+F')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('shortcuts')).toHaveCount(0)
    await page.getByTestId('open-shortcuts').click()
    await expect(page.getByTestId('shortcuts')).toContainText('再生位置で分割')
  })

  test('複数選んでグループにすると一緒に選ばれ一緒に動き、グループを解くと独立に戻る', async ({ page }) => {
    await openFresh(page)
    const ruler = page.getByTestId('timeline-ruler')
    const box = (await ruler.boundingBox())!
    const pxPerSecond = 60
    for (const seconds of [0, 5, 10]) {
      await ruler.click({ position: { x: seconds * pxPerSecond, y: box.height / 2 } })
      await page.getByTestId('add-caption').click()
    }
    const captions = page.locator('[data-item-type="text"]')
    await expect(captions).toHaveCount(3)
    const at = (seconds: string) => page.locator(`[data-item-type="text"][title*="${seconds} –"]`)
    const starts = async (): Promise<string[]> =>
      (await captions.evaluateAll((elements) => elements.map((element) => element.getAttribute('title') ?? ''))).map((title) => title.split('\n')[1]!.split(' – ')[0]!).sort()

    // 1つ目と2つ目を選んで Ctrl+G
    await at('0:00.000').click()
    await at('0:05.000').click({ modifiers: ['Shift'] })
    await page.keyboard.press('Control+g')
    await expect(page.locator('[data-item-type="text"][data-group-id]')).toHaveCount(2)
    await expect(at('0:10.000')).not.toHaveAttribute('data-group-id', /.+/)

    // 1つをクリックするとグループごと選ばれ、ドラッグするとグループだけ一緒に動く
    await at('0:10.000').click()
    await at('0:00.000').click()
    await expect(page.locator('[data-item-type="text"][aria-pressed="true"]')).toHaveCount(2)
    const first = (await at('0:00.000').boundingBox())!
    await page.mouse.move(first.x + 10, first.y + first.height / 2)
    await page.mouse.down()
    await page.mouse.move(first.x + 10 + pxPerSecond, first.y + first.height / 2, { steps: 4 })
    await page.mouse.move(first.x + 10 + pxPerSecond * 1.5, first.y + first.height / 2, { steps: 4 })
    await page.mouse.up()
    await expect.poll(starts).toEqual(['0:01.500', '0:06.500', '0:10.000'])
    await page.keyboard.press('Control+z')
    await expect.poll(starts).toEqual(['0:00.000', '0:05.000', '0:10.000'])

    // インスペクタでグループと分かり、右クリックでグループを解ける
    await page.getByTestId('side-tab-inspector').click()
    await expect(page.getByTestId('inspector-group')).toContainText('2個')
    await at('0:05.000').click({ button: 'right' })
    await page.getByTestId('context-menu').getByTestId('menu-ungroup').click()
    await expect(page.locator('[data-item-type="text"][data-group-id]')).toHaveCount(0)
    await at('0:00.000').click()
    await expect(page.locator('[data-item-type="text"][aria-pressed="true"]')).toHaveCount(1)
  })

  test('セリフを書き換えて長さが変わっても、ほかのセリフや素材は動かない', async ({ page }) => {
    await openFresh(page)
    await addLines(page, 'ずんだもん:みじかい\n四国めたん:つぎのセリフよ\nずんだもん:さいごなのだ', 3)
    await page.getByTestId('add-caption').click()
    const starts = async (): Promise<string[]> =>
      page.locator('[data-item-type="voice"], [data-item-type="text"]').evaluateAll((elements) =>
        elements.map((element) => `${element.getAttribute('data-item-id')}@${(element.getAttribute('title') ?? '').split('\n')[1]!.split(' – ')[0]}`)
      )
    const firstId = await page.locator('[data-item-type="voice"]').first().getAttribute('data-item-id')
    const others = async (): Promise<string[]> => (await starts()).filter((entry) => !entry.startsWith(`${firstId}@`)).sort()
    const othersBefore = await others()
    expect(othersBefore).toHaveLength(3)

    const text = page.getByTestId('script-text').first()
    await text.fill('ずっとずっとながくなったセリフなのだ、とてもながいのだ')
    await text.blur()
    await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(3, { timeout: 30_000 })
    // 1行目の長さは変わっている
    await expect
      .poll(async () => (await page.locator('[data-item-type="voice"]').first().getAttribute('title')) ?? '')
      .not.toContain('– 0:00.')
    expect(await others()).toEqual(othersBefore)
  })
})
