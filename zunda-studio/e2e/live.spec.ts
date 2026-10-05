import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { aiCalls, clearAiCalls, FIXTURE_BIN, fixtureCommand, openFresh, queueAiResponses, queuePick, updateSettings, useFakeAi } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

async function openLive(page: Page): Promise<Page> {
  await page.getByTestId('side-tab-live').click()
  const popup = page.waitForEvent('popup')
  await page.getByTestId('open-live').click()
  const live = await popup
  await expect(live.getByTestId('live-window')).toBeVisible()
  return live
}

test.describe('ライブ(録画中の会話と振り返り)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zunda-e2e-live-'))

  test.beforeEach(async ({ request }) => {
    clearAiCalls()
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] },
      speech: { whisperPath: fixtureCommand('whisper-cli'), whisperModelPath: join(FIXTURE_BIN, 'claude') },
      live: { speakReplies: false },
      obs: { enabled: false }
    })
    await useFakeAi(request)
  })

  test('録画中に相方と話し、目印を打ち、あとで記録を取り込んで台本に使える', async ({ page, request }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    const live = await openLive(page)
    await expect(live.getByText('相方: 四国めたん')).toBeVisible()

    await live.getByTestId('live-start').click()
    await expect(live.getByTestId('live-clock')).toBeVisible()

    // 文字で話しかけると、相方の人物像で短く返事が来る
    queueAiResponses(['四国めたん: 足元の影を見ることね'])
    await live.getByTestId('live-input').fill('このボスのパターンある?')
    await live.getByTestId('live-input').press('Enter')
    const entries = live.getByTestId('live-entry')
    await expect(entries).toHaveCount(2)
    await expect(entries.nth(1)).toContainText('足元の影を見ることね')
    const call = aiCalls().at(-1)!
    expect(call.model).toBe('sonnet')
    expect(call.system).toContain('四国めたん')
    expect(call.stdin).toContain('このボスのパターンある?')

    // 押しながら話す: マイクの声を文字にして送る(模擬の whisper)
    queueAiResponses(['左側の柱の裏よ'])
    const talk = live.getByTestId('live-talk')
    await talk.hover()
    await live.mouse.down()
    await live.waitForTimeout(700)
    await live.mouse.up()
    await expect(entries).toHaveCount(4, { timeout: 20_000 })
    await expect(entries.nth(2)).toContainText('ボスの弱点はどこなのだ')
    await expect(entries.nth(3)).toContainText('左側の柱の裏よ')

    // 目印とメモ(メモには返事をしない)
    await live.getByTestId('live-input').fill('いまのは奇跡')
    await live.getByTestId('live-mark').click()
    await expect(entries.nth(4)).toHaveAttribute('data-kind', 'marker')
    await live.getByText('メモ', { exact: true }).click()
    await live.getByTestId('live-input').fill('ここはサムネに使う')
    await live.getByTestId('live-send').click()
    await expect(entries).toHaveCount(6)
    await live.getByTestId('live-stop').click()
    await expect(live.getByTestId('live-start')).toBeVisible()

    // 編集画面で取り込む
    await page.getByTestId('open-live-import').click()
    await page.getByTestId('live-import').first().click()
    const logEntries = page.getByTestId('live-log-entry')
    await expect(logEntries).toHaveCount(6)
    await expect(page.getByTestId('live-offset')).toContainText('未調整')

    // 探す
    await page.getByTestId('live-search').fill('柱')
    await expect(logEntries).toHaveCount(1)
    await page.getByTestId('live-search').fill('')

    // 相方の発言を台本に使うと、相方の役のセリフになり、生成元も残る
    await logEntries.nth(1).getByTestId('live-adopt').click()
    const lines = page.getByTestId('script-line')
    await expect(lines).toHaveCount(1)
    await expect(lines.first().getByTestId('script-text')).toHaveValue('足元の影を見ることね')
    await expect(lines.first().getByTestId('generated-by')).toContainText('Claude / sonnet')
    await expect(logEntries.nth(1)).toContainText('採用済み')

    // 目印はタイムラインにも出る
    await expect(page.getByTestId('timeline-live-marker')).toHaveCount(1)

    // 発言を選ぶとその場面へ移る
    await logEntries.nth(0).getByTestId('live-seek').click()
    await expect(page.getByTestId('playhead')).toContainText(/^0:0\d\.\d{3}/)

    // ずれの調整: 最初の発言を、タイムラインの 5 秒の場面に合わせる
    await page.getByTestId('timeline-ruler').click({ position: { x: 300, y: 5 } })
    await logEntries.nth(0).getByTestId('live-align').click()
    await page.getByTestId('live-align-here').click()
    await expect(page.getByTestId('live-offset')).toContainText('手で調整')

    // テキストに保存
    const textPath = join(directory, 'live.txt')
    await queuePick(request, [textPath])
    await page.getByTestId('live-save-text').click()
    await expect.poll(() => {
      try {
        return readFileSync(textPath, 'utf8')
      } catch {
        return ''
      }
    }).toContain('四国めたん: 足元の影を見ることね')
    expect(readFileSync(textPath, 'utf8')).toContain('★ いまのは奇跡')
  })

  test('相方がいないプロジェクトでは、理由を出してライブを開かない', async ({ page }) => {
    await openFresh(page)
    await page.getByTestId('side-tab-live').click()
    await page.getByTestId('open-live').click()
    await expect(page.getByRole('alert')).toContainText('相方(AIの役)のキャラクターがいません')
  })
})
