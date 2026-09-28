import { expect, test, type Page } from '@playwright/test'

import { aiCalls, clearAiCalls, openFresh, queueAiResponses, updateSettings, useFakeAi } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

async function startWithLines(page: Page, text: string): Promise<void> {
  await openFresh(page)
  await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
  await page.getByTestId('open-bulk').click()
  await page.getByTestId('bulk-text').fill(text)
  await page.getByTestId('bulk-submit').click()
  const count = text.split('\n').length
  await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(count, { timeout: 30_000 })
}

function reply(...texts: string[][]): unknown {
  return { candidates: texts.map((lines) => ({ lines: lines.map((line) => ({ speaker: line.split(':')[0], text: line.split(':')[1], expression: null })) })) }
}

test.describe('相方の返答と編集チャット', () => {
  test.beforeEach(async ({ request }) => {
    clearAiCalls()
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
    await useFakeAi(request)
  })

  test('相方の返答の候補を見て、直して採用すると台本に入り、生成元が記録される', async ({ page }) => {
    await startWithLines(page, 'ずんだもん:ボスが強すぎるのだ！')
    queueAiResponses([reply(['四国めたん:あなたが弱いだけじゃないかしら']), reply(['四国めたん:回復してから挑みなさい'], ['四国めたん:盾を使ってみたら?'])])

    await page.getByTestId('cohost-candidates').selectOption('1')
    await page.getByTestId('cohost-instruction').fill('辛口で')
    await page.getByTestId('cohost-generate').click()
    await expect(page.getByTestId('cohost-candidate')).toHaveCount(1)
    await expect(page.getByTestId('cohost-line-text')).toHaveValue('あなたが弱いだけじゃないかしら')

    // AI に渡した依頼: 相方の人物像・直前の会話・その場の指示
    const call = aiCalls().at(-1)!
    expect(call.model).toBe('sonnet')
    expect(call.system).toContain('四国めたん')
    expect(call.stdin).toContain('ずんだもん: ボスが強すぎるのだ！')
    expect(call.stdin).toContain('辛口で')

    // 再生成すると別の候補になる。2案から選べる
    await page.getByTestId('cohost-candidates').selectOption('2')
    await page.getByTestId('cohost-regenerate').click()
    await expect(page.getByTestId('cohost-candidate')).toHaveCount(2)

    // 2案目を少し直して採用する
    const second = page.getByTestId('cohost-candidate').nth(1)
    await second.getByTestId('cohost-line-text').fill('盾を使ってみたらどうかしら')
    await second.getByTestId('cohost-adopt').click()
    await expect(page.getByTestId('cohost-candidates-panel')).toBeHidden()

    const lines = page.getByTestId('script-line')
    await expect(lines).toHaveCount(2)
    await expect(lines.nth(1).getByTestId('script-text')).toHaveValue('盾を使ってみたらどうかしら')
    await expect(lines.nth(1).getByTestId('generated-by')).toContainText('Claude / sonnet が書いたセリフ')
    await expect(lines.nth(1).getByTestId('synthesis-status')).toContainText('合成済み', { timeout: 30_000 })

    // 採用は1回の取り消しで戻る
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(lines).toHaveCount(1)
  })

  test('台本が長くても、返答の操作は下に固定され、セリフの右クリックやショートカットから返答を作れる', async ({ page }) => {
    const script = Array.from({ length: 24 }, (_, index) => `${index % 2 === 0 ? 'ずんだもん' : '四国めたん'}:${index + 1}番目のセリフなのだ`).join('\n')
    await startWithLines(page, script)
    const pane = page.locator('.pane--script')
    // 一番上までスクロールしても、返答の操作は画面の中にある
    await pane.evaluate((element) => element.scrollTo(0, 0))
    await expect(page.getByTestId('cohost-generate')).toBeInViewport()
    await pane.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect(page.getByTestId('cohost-generate')).toBeInViewport()

    // 途中のセリフを右クリックして、そのセリフへの返答を作る
    queueAiResponses([reply(['四国めたん:三番目への返事よ'])])
    await page.getByTestId('cohost-candidates').selectOption('1')
    await pane.evaluate((element) => element.scrollTo(0, 0))
    await page.getByTestId('script-line').nth(2).click({ button: 'right', position: { x: 8, y: 8 } })
    await page.getByTestId('context-menu').getByTestId('menu-line-cohost').click()
    await expect(page.getByTestId('cohost-line-text')).toHaveValue('三番目への返事よ')
    const call = aiCalls().at(-1)!
    expect(call.stdin).toContain('3番目のセリフなのだ')
    expect(call.stdin).not.toContain('4番目のセリフなのだ')
    await page.getByTestId('cohost-discard').click()

    // セリフの入力中に Ctrl+Shift+Enter でも作れる(書きかけの文も反映してから頼む)
    queueAiResponses([reply(['四国めたん:書きかけにも返事するわ'])])
    const fifth = page.getByTestId('script-line').nth(4).getByTestId('script-text')
    await fifth.fill('ここを書き直したのだ')
    await fifth.press('Control+Shift+Enter')
    await expect(page.getByTestId('cohost-line-text')).toHaveValue('書きかけにも返事するわ')
    expect(aiCalls().at(-1)!.stdin).toContain('ここを書き直したのだ')
    // 行は増えていない(Ctrl+Enter の「次にセリフを追加」とは別)
    await expect(page.getByTestId('script-line')).toHaveCount(24)

    // 設定をたたむと生成のボタンだけになり、開き直すと戻る
    await page.getByTestId('cohost-discard').click()
    await page.getByTestId('cohost-compact').click()
    await expect(page.getByTestId('cohost-instruction')).toHaveCount(0)
    await expect(page.getByTestId('cohost-generate')).toBeVisible()
    await page.getByTestId('cohost-compact').click()
    await expect(page.getByTestId('cohost-instruction')).toBeVisible()
  })

  test('続きをまとめて作ると、両者のセリフが交互に入る。AIの応答が壊れていれば理由を出す', async ({ page }) => {
    await startWithLines(page, 'ずんだもん:今日はホラーゲームなのだ')
    queueAiResponses([reply(['四国めたん:怖いのは苦手じゃなかった?', 'ずんだもん:ぜんぜん平気なのだ', '四国めたん:声が震えてるわよ'])])
    await page.getByTestId('cohost-candidates').selectOption('1')
    await page.getByTestId('cohost-rounds').selectOption('3')
    await page.getByTestId('cohost-generate').click()
    await expect(page.getByTestId('cohost-line-text')).toHaveCount(3)
    await page.getByTestId('cohost-adopt').click()
    const texts = page.getByTestId('script-text')
    await expect(texts).toHaveCount(4)
    await expect(texts.nth(2)).toHaveValue('ぜんぜん平気なのだ')
    await expect(page.getByTestId('script-line').nth(2).locator('select').first()).toHaveValue(/.+/)
    await expect(page.getByTestId('script-line').nth(3).getByText('AI', { exact: true })).toBeVisible()

    // 形式に合わない応答が2回続いたら、理由を表示して台本は変えない
    queueAiResponses(['ただの文章です', 'やはりただの文章です'])
    await page.getByTestId('cohost-generate').click()
    await expect(page.getByTestId('cohost-error')).toContainText('AIの応答が指定の形式になりませんでした')
    await page.getByTestId('cohost-discard').click()
    await expect(texts).toHaveCount(4)
  })

  test('編集チャットの提案を差分で確かめて適用し、1回で元に戻せる。適用できない提案は適用させない', async ({ page }) => {
    await startWithLines(page, 'ずんだもん:ボスが強すぎるのだ！\n四国めたん:それはあなたの腕が足りないだけではなくて?')
    const itemIds = await page.locator('[data-item-type="voice"]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-item-id')))

    queueAiResponses([
      {
        reply: '相方のセリフを短くして、ボス登場で左上に寄せました',
        commands: [
          { op: 'voice.setText', itemId: itemIds[1], text: '腕が足りないのよ' },
          { op: 'zoom.insert', atMs: 0, durationMs: 2000, region: { x: 0, y: 0, width: 960 }, method: 'punch' }
        ]
      }
    ])
    await page.getByTestId('chat-input').fill('テンポを上げて。最初は左上に寄って')
    await page.getByTestId('chat-send').click()
    const proposal = page.getByTestId('proposal')
    await expect(proposal).toBeVisible()
    await expect(page.getByTestId('chat-message-assistant')).toContainText('相方のセリフを短くして')
    await expect(page.getByTestId('proposal-line')).toContainText('- それはあなたの腕が足りないだけではなくて?')
    await expect(page.getByTestId('proposal-line')).toContainText('+ 腕が足りないのよ')
    await expect(proposal).toContainText('ズームを追加(1件)')
    await expect(page.getByTestId('proposal-duration')).toContainText('尺:')

    // 編集AIには台本の表(ID付き)と指示が渡る
    const call = aiCalls().at(-1)!
    expect(call.model).toBe('opus')
    expect(call.system).toContain('編集アシスタント')
    expect(call.stdin).toContain(`${itemIds[1]} 四国めたん`)
    expect(call.stdin).toContain('テンポを上げて。最初は左上に寄って')

    await page.getByTestId('proposal-apply').click()
    await expect(page.getByTestId('proposal-outcome')).toContainText('適用しました')
    await expect(page.getByTestId('script-text').nth(1)).toHaveValue('腕が足りないのよ')
    await expect(page.locator('[data-item-type="zoom"]')).toHaveCount(1)

    // 1回の取り消しで提案の全体が戻り、チャットの記録は残る
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(page.getByTestId('script-text').nth(1)).toHaveValue('それはあなたの腕が足りないだけではなくて?')
    await expect(page.locator('[data-item-type="zoom"]')).toHaveCount(0)
    await expect(page.getByTestId('chat-message-user')).toHaveCount(1)

    // 存在しないアイテムを指す提案は、理由を出して適用させない
    queueAiResponses([{ reply: '消しました', commands: [{ op: 'item.delete', itemId: 'itm_nope' }] }])
    await page.getByTestId('chat-input').fill('いらないものを消して')
    await page.getByTestId('chat-input').press('Control+Enter')
    await expect(page.getByTestId('proposal-invalid')).toContainText('アイテムが見つかりません')
    await expect(page.getByTestId('proposal-apply')).toBeDisabled()
    await page.getByTestId('proposal-reject').click()
    await expect(page.getByTestId('proposal-outcome').last()).toHaveText('適用しませんでした')
  })
})
