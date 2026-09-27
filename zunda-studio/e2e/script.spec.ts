import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { openFresh, queuePick, updateSettings } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

const TEN_LINES = [
  'ずんだもん:今日はこのゲームをやっていくのだ！',
  '四国めたん:あら、ずいぶん張り切っているのね。',
  'ずんだもん:ボスが強すぎて三日も詰まっているのだ。',
  '四国めたん:それは張り切りではなく、意地かしら。',
  'ずんだもん:今日こそ倒すのだ！',
  '四国めたん:まずは足元をよく見ることね。',
  'ずんだもん:足元？なにもないのだ。',
  '四国めたん:そこ、穴よ。',
  'ずんだもん:うわあああ！',
  '四国めたん:三日が四日になったわね。'
]

function engineAt(url: string): unknown {
  return {
    voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url, executablePath: null, autoLaunch: false }] }
  }
}

async function secondsOf(page: Page): Promise<number> {
  const text = (await page.getByTestId('playhead').textContent()) ?? ''
  const match = /^(\d+):(\d+)\.(\d+)/.exec(text.trim())
  if (!match) throw new Error(`再生位置を読めません: ${text}`)
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000
}

test.describe('台本と音声合成', () => {
  test.beforeEach(async ({ request }) => {
    await updateSettings(request, engineAt(MOCK_VOICEVOX_URL))
  })

  test('10行をまとめて入力すると全て合成され、順に再生すると字幕が音声に合わせて切り替わる', async ({ page }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()

    await page.getByTestId('open-bulk').click()
    await page.getByTestId('bulk-text').fill(TEN_LINES.join('\n'))
    await page.getByTestId('bulk-submit').click()

    const lines = page.getByTestId('script-line')
    await expect(lines).toHaveCount(10)
    await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(10, { timeout: 30_000 })

    // 話者の割り当て(名前:セリフ)が反映されている
    await expect(lines.nth(1).locator('select').first()).toHaveValue(/.+/)
    await expect(lines.nth(1).getByText('AI', { exact: true })).toBeVisible()

    // 先頭から再生すると、再生位置が進み、字幕が2行目に切り替わる
    await page.getByTestId('play-toggle').click()
    await expect(page.getByTestId('current-subtitle')).toContainText('今日はこのゲームをやっていくのだ！')
    await expect(page.getByTestId('current-subtitle')).toContainText('四国めたん「あら、ずいぶん張り切っているのね。」', {
      timeout: 15_000
    })
    await page.getByTestId('play-toggle').click()
    const stoppedAt = await secondsOf(page)
    expect(stoppedAt).toBeGreaterThan(1)
    await page.waitForTimeout(400)
    expect(await secondsOf(page)).toBe(stoppedAt)
  })

  test('セリフを消すと後ろが詰まり、元に戻すと元の位置に戻る', async ({ page }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('open-bulk').click()
    await page.getByTestId('bulk-text').fill(TEN_LINES.slice(0, 3).join('\n'))
    await page.getByTestId('bulk-submit').click()
    await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(3, { timeout: 30_000 })

    const lines = page.getByTestId('script-line')
    const thirdStart = await lines.nth(2).locator('.script__time').textContent()
    const secondStart = await lines.nth(1).locator('.script__time').textContent()

    await lines.nth(1).getByTestId('delete-line').click()
    await expect(lines).toHaveCount(2)
    // 3行目が2行目のあった位置に詰まる
    await expect(lines.nth(1).locator('.script__time')).toHaveText(new RegExp(`^${(secondStart ?? '').split(' ')[0]}`))

    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(lines).toHaveCount(3)
    await expect(lines.nth(2).locator('.script__time')).toHaveText(thirdStart ?? '')
  })

  test('セリフを書き換えると合成し直され、尺が変わる', async ({ page }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('add-line').click()
    const text = page.getByTestId('script-text').first()
    await expect(text).toBeFocused()
    await text.fill('みじかい')
    await text.blur()
    await expect(page.getByTestId('synthesis-status').first()).toHaveText('合成済み', { timeout: 15_000 })
    const shortDuration = await page.locator('.script__time').first().textContent()

    await text.fill('こんどはずっとながいセリフにかきかえたのだ')
    await text.blur()
    await expect(page.getByTestId('synthesis-status').first()).toHaveText('合成済み', { timeout: 15_000 })
    await expect(page.locator('.script__time').first()).not.toHaveText(shortDuration ?? '')
  })

  test('Ctrl+Enter で次のセリフを追加すると、2人なら話者が交互になる', async ({ page }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('add-line').click()
    const first = page.getByTestId('script-text').first()
    await first.fill('ひとつめ')
    await first.press('Control+Enter')

    const lines = page.getByTestId('script-line')
    await expect(lines).toHaveCount(2)
    await expect(page.getByTestId('script-text').nth(1)).toBeFocused()
    await expect(lines.nth(1).getByText('AI', { exact: true })).toBeVisible()
  })

  test('エンジンに繋がらなければ対処を表示し、繋がったら自動で合成する', async ({ page, request }) => {
    await updateSettings(request, engineAt('http://127.0.0.1:59999'))
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('add-line').click()
    // キャッシュ済みのセリフだとエンジン無しでも再生できてしまうので、初めてのセリフにする。
    const text = page.getByTestId('script-text').first()
    await text.fill(`はじめてのセリフ${Date.now()}`)
    await text.blur()

    const banner = page.getByTestId('synthesis-banner')
    await expect(banner).toContainText('VOICEVOX', { timeout: 15_000 })
    await expect(banner).toContainText('設定')

    // 設定画面で正しい接続先にすると、エンジンが使える状態になり自動で合成される
    await page.getByTestId('open-settings').click()
    await page.getByTestId('settings-tab-voice').click()
    const url = page.getByTestId('engine-voicevox-url')
    await url.fill(MOCK_VOICEVOX_URL)
    await url.blur()
    await page.getByTestId('engine-voicevox-connect').click()
    await expect(page.getByTestId('engine-voicevox-status')).toContainText('接続中')
    await page.keyboard.press('Escape')

    await expect(banner).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByTestId('synthesis-status').first()).toHaveText('合成済み')
  })

  test('キャラクターの話者を変えると、そのキャラクターのセリフが合成し直される', async ({ page }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('open-bulk').click()
    await page.getByTestId('bulk-text').fill(TEN_LINES.slice(0, 2).join('\n'))
    await page.getByTestId('bulk-submit').click()
    await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(2, { timeout: 30_000 })

    await page.getByTestId('open-characters').click()
    await page.getByTestId('character-speaker').selectOption({ label: 'ずんだもん(あまあま)' })
    await expect(page.getByTestId('character-credit')).toHaveValue('VOICEVOX:ずんだもん')
    await page.keyboard.press('Escape')

    await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(2, { timeout: 30_000 })
  })

  test('合成済みの台本を保存して開き直しても、音声を合成し直さずに再生できる', async ({ page, request }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('open-bulk').click()
    await page.getByTestId('bulk-text').fill(TEN_LINES.slice(0, 2).join('\n'))
    await page.getByTestId('bulk-submit').click()
    await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(2, { timeout: 30_000 })

    const path = join(mkdtempSync(join(tmpdir(), 'zunda-e2e-script-')), 'script.zsproj')
    await queuePick(request, [path])
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText(path)).toBeVisible()

    await page.getByRole('button', { name: '新規' }).click()
    await queuePick(request, [path])
    await page.getByRole('button', { name: '開く' }).click()
    await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(2)
    await page.getByTestId('play-toggle').click()
    await expect(page.getByTestId('current-subtitle')).toContainText('今日はこのゲームをやっていくのだ！')
  })
})
