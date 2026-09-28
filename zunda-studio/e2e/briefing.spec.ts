import { expect, test } from '@playwright/test'

import { aiCalls, clearAiCalls, openFresh, queueAiResponses, updateSettings, useFakeAi } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

const MEMO = 'Hearts of Iron IV で日本を遊ぶ回。ずんだもんは初見で、めたんは経験者。'

test.describe('企画メモから相方の前提を作る', () => {
  test.beforeEach(async ({ request }) => {
    clearAiCalls()
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
    await useFakeAi(request)
  })

  test('スタンスと前提知識を作って裏付けを確かめ、確認した項目だけが相方の依頼に入る', async ({ page }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('open-synopsis').click()
    await page.getByTestId('synopsis-text').fill(MEMO)

    queueAiResponses([
      {
        stance: 'めたんは経験者として、初見のずんだもんに要点だけ教える。',
        facts: [
          { text: 'ずんだもんは初見', origin: 'memo', quote: 'ずんだもんは初見で、めたんは経験者。', checkHint: null },
          { text: 'HoI4 は Paradox Interactive が開発した', origin: 'ai', quote: null, checkHint: '公式サイトで確認' },
          { text: 'HoI4 の日本は最初から石油が豊富', origin: 'ai', quote: null, checkHint: '資源の量はバージョンで変わる' }
        ],
        questions: ['どの DLC で遊ぶか']
      },
      {
        results: [
          { id: '1', verdict: 'supported', reason: '公式サイトに記載', sources: [{ title: 'Paradox 公式', url: 'https://www.paradoxinteractive.com/games/hearts-of-iron-iv' }], suggestion: null },
          { id: '2', verdict: 'contradicted', reason: '日本は石油が乏しく輸入に頼る', sources: [], suggestion: 'HoI4 の日本は石油が乏しい' }
        ]
      }
    ])
    await page.getByTestId('briefing-generate').click()
    await expect(page.getByTestId('briefing-message')).toContainText('2件をウェブで確かめました')

    const facts = page.getByTestId('briefing-fact')
    await expect(facts).toHaveCount(3)
    await expect(page.getByTestId('briefing-stance')).toHaveValue(/経験者として/)
    // メモにあることは確認済み、AI の知識は未確認で始まる。誤りの可能性が高いものは使わない
    await expect(facts.nth(0)).toHaveAttribute('data-status', 'confirmed')
    await expect(facts.nth(0)).toHaveAttribute('data-origin', 'memo')
    await expect(facts.nth(1)).toHaveAttribute('data-status', 'unverified')
    await expect(facts.nth(1).getByTestId('briefing-fact-verdict')).toHaveText('裏付けあり')
    await expect(facts.nth(1).getByTestId('briefing-fact-source')).toHaveAttribute('href', 'https://www.paradoxinteractive.com/games/hearts-of-iron-iv')
    await expect(facts.nth(2)).toHaveAttribute('data-status', 'rejected')
    await expect(facts.nth(2).getByTestId('briefing-fact-verdict')).toHaveText('誤りの可能性')
    await expect(page.getByTestId('briefing-questions')).toContainText('どの DLC で遊ぶか')

    // 確かめる依頼はウェブ検索つきで、項目を番号で示している
    const checkCall = aiCalls().at(-1)!
    expect(checkCall.system).toContain('ウェブ検索を必ず使って')
    expect(checkCall.stdin).toContain('- 1: HoI4 は Paradox Interactive が開発した')

    // 出典のある項目を使う。自分で1つ書き足す
    await page.getByTestId('briefing-confirm-supported').click()
    await expect(facts.nth(1)).toHaveAttribute('data-status', 'confirmed')
    await page.getByTestId('briefing-add').click()
    await facts.nth(3).getByTestId('briefing-fact-text').fill('このシリーズは第3話')
    await expect(page.getByTestId('briefing-summary')).toContainText('使う 3件 / 未確認 0件 / 使わない 1件')
    await page.getByTestId('synopsis-save').click()
    await expect(page.getByTestId('briefing-unverified-badge')).toHaveCount(0)

    // 相方の返答の依頼には、確認した項目だけが入る
    queueAiResponses([{ candidates: [{ lines: [{ speaker: '四国めたん', text: 'まずは工業を伸ばしなさい', expression: null }] }] }])
    await page.getByTestId('cohost-candidates').selectOption('1')
    await page.getByTestId('cohost-generate').click()
    await expect(page.getByTestId('cohost-line-text')).toHaveValue('まずは工業を伸ばしなさい')
    const cohost = aiCalls().at(-1)!.system ?? ''
    expect(cohost).toContain('## 相方のスタンス')
    expect(cohost).toContain('HoI4 は Paradox Interactive が開発した')
    expect(cohost).toContain('このシリーズは第3話')
    expect(cohost).not.toContain('石油が豊富')
    expect(cohost).toContain('断定しない')

    // 企画メモを書き換えると、作り直しを勧める。保存した前提は取り消しで戻る
    await page.getByTestId('cohost-discard').click()
    await page.getByTestId('open-synopsis').click()
    await page.getByTestId('synopsis-text').fill(`${MEMO}\n難易度はシビア`)
    await expect(page.getByTestId('briefing-stale')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '元に戻す' }).click()
    await page.getByTestId('open-synopsis').click()
    await expect(page.getByTestId('briefing-fact')).toHaveCount(0)
    await expect(page.getByTestId('synopsis-text')).toHaveValue('')
  })
})
