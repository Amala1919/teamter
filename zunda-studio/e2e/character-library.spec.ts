import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { openFresh, queuePick, updateSettings } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

/** アプリに保存したキャラクターを全部消す(ほかのテストの新しいプロジェクトに入らないように)。 */
async function clearLibrary(request: APIRequestContext): Promise<void> {
  const response = await request.post('/ipc/characters:list', { data: { args: [] } })
  const body = (await response.json()) as { ok: boolean; value: { id: string }[] }
  for (const entry of body.value ?? []) await request.post('/ipc/characters:remove', { data: { args: [entry.id] } })
}

/** 新しいプロジェクトを作る(保存していない変更の確認には「破棄して進む」と答える)。 */
async function newProject(page: Page): Promise<void> {
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: '新規' }).click()
}

test.describe('アプリに保存したキャラクター', () => {
  test.beforeEach(async ({ request }) => {
    await clearLibrary(request)
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
  })
  test.afterEach(async ({ request }) => {
    await clearLibrary(request)
    await updateSettings(request, { ui: { syncCharactersToLibrary: true } })
  })

  test('キャラクターをアプリに保存すると、直した内容もアプリに残り、新しいプロジェクトに入る', async ({ page }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('open-characters').click()
    await page.locator('.character-dialog__item', { hasText: '四国めたん' }).click()

    // アプリに保存する
    await expect(page.getByTestId('library-entry')).toHaveCount(0)
    await page.getByTestId('library-save').click()
    await expect(page.getByTestId('library-status')).toContainText('アプリに保存済み')
    await expect(page.getByTestId('library-entry')).toHaveCount(1)
    await expect(page.getByTestId('library-entry')).toContainText('四国めたん')
    await expect(page.getByTestId('library-add')).toHaveText('追加済み')

    // プロジェクトで直すと、アプリのほうにも反映する
    const name = page.getByTestId('character-name')
    await name.fill('めたん先輩')
    await name.press('Tab')
    await expect(page.getByTestId('library-entry')).toContainText('めたん先輩')
    await page.keyboard.press('Escape')

    // 新しいプロジェクトには、保存したキャラクターが最初から入っている(ずんだもんは保存していないので入らない)
    await newProject(page)
    const speakers = page.getByTestId('add-speaker').locator('option')
    await expect(speakers).toHaveCount(1)
    await expect(speakers).toHaveText('めたん先輩')
    await page.getByTestId('open-characters').click()
    await expect(page.getByTestId('library-add')).toHaveText('追加済み')
    await expect(page.getByTestId('library-status')).toContainText('アプリに保存済み')

    // 「新しいプロジェクトに入れる」を切ると入らず、台本の欄から足せる
    await page.getByTestId('library-auto-add').uncheck()
    await expect(page.getByTestId('library-auto-add')).not.toBeChecked()
    await page.keyboard.press('Escape')
    await newProject(page)
    await expect(page.getByText('キャラクターがまだありません。')).toBeVisible()
    await page.getByTestId('script-library-add').click()
    await expect(speakers).toHaveText('めたん先輩')
    // 足したキャラクターは取り消せる
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(page.getByText('キャラクターがまだありません。')).toBeVisible()

    // アプリから消しても、プロジェクトのキャラクターは残る
    await page.getByTestId('script-library-add').click()
    await page.getByTestId('open-characters').click()
    await page.getByTestId('library-remove').click()
    await expect(page.getByTestId('library-entry')).toHaveCount(0)
    await expect(page.locator('.character-dialog__item', { hasText: 'めたん先輩' })).toHaveCount(1)
    await expect(page.getByTestId('library-save')).toHaveText('アプリから消えています。もう一度アプリに保存')
  })

  test('設定で反映を切ると、プロジェクトで直してもアプリのほうは変わらず、ボタンで保存できる', async ({ page, request }) => {
    await updateSettings(request, { ui: { syncCharactersToLibrary: false } })
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('open-characters').click()
    await page.locator('.character-dialog__item', { hasText: 'ずんだもん' }).click()
    await page.getByTestId('library-save').click()
    await expect(page.getByTestId('library-status')).toHaveText('アプリに保存済み')

    const name = page.getByTestId('character-name')
    await name.fill('ずんだもん2号')
    await name.press('Tab')
    // しばらく待っても、アプリのほうは前の名前のまま
    await page.waitForTimeout(1200)
    await expect(page.getByTestId('library-entry')).toContainText('ずんだもん')
    await expect(page.getByTestId('library-entry')).not.toContainText('2号')
    await page.getByTestId('library-save').click()
    await expect(page.getByTestId('library-entry')).toContainText('ずんだもん2号')
  })
  test('古いプロジェクトを開いても、アプリに保存したほうは古い内容で上書きしない', async ({ page, request }) => {
    const file = join(mkdtempSync(join(tmpdir(), 'zunda-e2e-library-')), 'old.zsproj')
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('open-characters').click()
    await page.locator('.character-dialog__item', { hasText: '四国めたん' }).click()
    await page.getByTestId('library-save').click()
    await expect(page.getByTestId('library-status')).toContainText('アプリに保存済み')
    await page.keyboard.press('Escape')

    // この時点(名前は「四国めたん」)で保存しておき、そのあと名前を変える(アプリにも反映)
    await queuePick(request, [file])
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText(file)).toBeVisible()
    await page.getByTestId('open-characters').click()
    await page.locator('.character-dialog__item', { hasText: '四国めたん' }).click()
    await page.getByTestId('character-name').fill('めたん新')
    await page.getByTestId('character-name').press('Tab')
    await expect(page.getByTestId('library-entry')).toContainText('めたん新')
    await page.keyboard.press('Escape')

    // 古いプロジェクトを開いても、アプリのほうは新しい名前のまま
    page.once('dialog', (dialog) => void dialog.accept())
    await queuePick(request, [file])
    await page.getByRole('button', { name: '開く' }).click()
    await page.getByTestId('open-characters').click()
    await expect(page.locator('.character-dialog__item', { hasText: '四国めたん' })).toHaveCount(1)
    await page.waitForTimeout(1000)
    await expect(page.getByTestId('library-entry')).toContainText('めたん新')
  })
})
