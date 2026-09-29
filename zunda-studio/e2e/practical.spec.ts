import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { openFresh, queuePick, updateSettings } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

async function addLines(page: Page, text: string): Promise<void> {
  await page.getByTestId('open-bulk').click()
  await page.getByTestId('bulk-text').fill(text)
  await page.getByTestId('bulk-submit').click()
}

/** 台本の行に出ている尺(秒)。 */
async function durationOf(line: Locator): Promise<number> {
  const text = (await line.locator('.script__time').textContent()) ?? ''
  const match = /([\d.]+)秒/.exec(text)
  return match ? Number(match[1]) : NaN
}

test.describe('実用の機能(読み方・辞書・自動保存・SRT・相方の設定)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zunda-e2e-practical-'))

  test.beforeEach(async ({ request }) => {
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
  })

  test('読み方を直すと、その読みで合成し直す', async ({ page }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await addLines(page, 'ずんだもん:ながいながいせりふなのだ')
    const line = page.getByTestId('script-line').first()
    await expect(line.getByTestId('synthesis-status')).toContainText('合成済み', { timeout: 30_000 })
    const before = await durationOf(line)

    // 台本の行を右クリック →「インスペクタで開く」で、読み方を直す欄を出す
    await line.locator('.script__index').click({ button: 'right' })
    await page.getByTestId('context-menu').getByTestId('menu-line-inspector').click()
    await expect(page.getByTestId('side-tab-inspector')).toHaveAttribute('aria-selected', 'true')
    const reading = page.getByTestId('reading-input')
    await expect(reading).toHaveValue(/ナガイ/)
    await reading.fill("ズ'ン")
    await page.getByTestId('reading-apply').click()
    await expect(page.getByTestId('reading-editor')).toContainText('手で直した読み')
    await expect(line.getByTestId('synthesis-status')).toContainText('合成済み', { timeout: 30_000 })
    await expect.poll(() => durationOf(line)).toBeLessThan(before)
  })

  test('辞書に語を登録すると、その語を含むセリフが新しい読みで合成し直される', async ({ page }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    const surface = `まおうじょうだ${Date.now() % 1000}`
    await addLines(page, `ずんだもん:${surface}`)
    const line = page.getByTestId('script-line').first()
    await expect(line.getByTestId('synthesis-status')).toContainText('合成済み', { timeout: 30_000 })
    const before = await durationOf(line)

    await page.getByTestId('open-settings').click()
    await page.getByTestId('settings-tab-voice').click()
    await page.getByTestId('dict-surface').fill(surface)
    await page.getByTestId('dict-pronunciation').fill('マ')
    await page.getByTestId('dict-add').click()
    await expect(page.getByTestId('dict-word').filter({ hasText: surface })).toBeVisible()
    await page.keyboard.press('Escape')

    await expect.poll(() => durationOf(line), { timeout: 30_000 }).toBeLessThan(before)
    await expect(line.getByTestId('synthesis-status')).toContainText('合成済み')
  })

  test('保存しないまま落ちても、次に開いたときに復元できる', async ({ page }) => {
    // e2e は DOM の型を読み込まないので、ブラウザ側の localStorage は形だけ書いて使う。
    await page.addInitScript(() =>
      (globalThis as unknown as { localStorage: { setItem(key: string, value: string): void } }).localStorage.setItem('zs.autosaveIntervalMs', '300')
    )
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await addLines(page, 'ずんだもん:消えたら困るセリフなのだ')
    await expect(page.getByTestId('script-line')).toHaveCount(1)
    await page.waitForTimeout(1200)

    // 画面を読み込み直す(落ちたのと同じ状態)
    await page.reload()
    const banner = page.getByTestId('recovery-banner')
    await expect(banner).toContainText('保存されていない編集が残っています')
    await page.getByTestId('recovery-restore').click()
    await expect(page.getByTestId('script-text').first()).toHaveValue('消えたら困るセリフなのだ')
    await expect(banner).toBeHidden()
  })

  test('字幕を SRT で保存し、相方の設定を書き出して別のプロジェクトで読み込める', async ({ page, request }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await addLines(page, 'ずんだもん:字幕のテストなのだ\n四国めたん:そうね')
    await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(2, { timeout: 30_000 })

    await page.getByTestId('open-export').click()
    const srtPath = join(directory, 'subtitles.srt')
    await queuePick(request, [srtPath])
    await page.getByTestId('srt-save').click()
    await expect.poll(() => {
      try {
        return readFileSync(srtPath, 'utf8')
      } catch {
        return ''
      }
    }).toContain('字幕のテストなのだ')
    expect(readFileSync(srtPath, 'utf8')).toMatch(/^1\n00:00:00,\d{3} --> 00:00:\d{2},\d{3}\n/)
    await page.keyboard.press('Escape')

    // 相方の設定を書き出す
    await page.getByTestId('open-characters').click()
    await page.locator('.character-dialog__item', { hasText: '四国めたん' }).click()
    await page.getByTestId('persona-personality').fill('とても冷静で、ボス戦に詳しい')
    await page.getByTestId('persona-personality').blur()
    const personaPath = join(directory, 'metan.json')
    await queuePick(request, [personaPath])
    await page.getByTestId('persona-export').click()
    await expect(page.getByText(`書き出しました: ${personaPath}`)).toBeVisible()
    expect(JSON.parse(readFileSync(personaPath, 'utf8')).persona.personality).toBe('とても冷静で、ボス戦に詳しい')
    await page.keyboard.press('Escape')

    // 別のプロジェクトで読み込む(保存していない変更は捨ててよいと答える)
    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: '新規' }).click()
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('open-characters').click()
    await page.locator('.character-dialog__item', { hasText: '四国めたん' }).click()
    await expect(page.getByTestId('persona-personality')).not.toHaveValue('とても冷静で、ボス戦に詳しい')
    await queuePick(request, [personaPath])
    await page.getByTestId('persona-import').click()
    await expect(page.getByTestId('persona-personality')).toHaveValue('とても冷静で、ボス戦に詳しい')
  })
})
