import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { writePortraitPsd } from '../tests/fixtures/portrait-psd'
import { aiCalls, clearAiCalls, openFresh, queueAiResponses, queuePick, updateSettings, useFakeAi } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

test.describe('立ち絵を AI でまとめて調整', () => {
  test.beforeEach(async ({ request }) => {
    clearAiCalls()
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
    await useFakeAi(request)
  })

  test('セリフと場面をもとに表情・出し入れ・強調をまとめて提案させ、差分を見て適用できる(立ち絵以外には触れない)', async ({ page, request }) => {
    const psdPath = await writePortraitPsd(mkdtempSync(join(tmpdir(), 'zunda-psd-ai-')))
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('open-characters').click()
    await queuePick(request, [psdPath])
    await page.getByTestId('portrait-pick').click()
    await expect(page.getByTestId('portrait-section').getByTestId('portrait-open-manager')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByTestId('open-bulk').click()
    await page.getByTestId('bulk-text').fill('ずんだもん:ボスが出てきたのだ！\n四国めたん:落ち着きなさい')
    await page.getByTestId('bulk-submit').click()
    await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(2, { timeout: 30_000 })

    // AI に渡す ID を画面から拾う
    const zundaId = await page.locator('.script__speakerSelect').first().inputValue()
    const lineIds = await page.locator('[data-item-type="voice"]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-item-id')!))
    queueAiResponses([
      {
        reply: '驚く場面の表情を付け、最初の1秒は立ち絵を隠し、話していない人を暗くしました',
        commands: [
          { op: 'voice.setExpression', itemId: lineIds[0], expressionId: 'exp_normal' },
          { op: 'portrait.insert', characterId: zundaId, atMs: 0, durationMs: 1000, kind: 'hide' },
          { op: 'project.setEditing', portraitDim: 0.45, portraitHop: true },
          // 立ち絵以外(セリフ)を消す操作は除かれる
          { op: 'item.delete', itemId: lineIds[1] }
        ]
      }
    ])

    await page.getByTestId('open-portrait-ai').click()
    await page.getByTestId('portrait-ai-instruction').fill('驚く場面ははっきり')
    await page.getByTestId('portrait-ai-start').click()
    const proposal = page.getByTestId('proposal')
    await expect(proposal).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('chat-message-assistant').last()).toContainText('立ち絵以外に触れる操作 1 件は除きました')

    // AI には、表情の一覧・セリフ・指示が渡っている
    const call = aiCalls().at(-1)!
    expect(call.stdin).toContain('ボスが出てきたのだ')
    expect(call.stdin).toContain('exp_normal=')
    expect(call.stdin).toContain('驚く場面ははっきり')

    // 立ち絵を付けたときに置かれた「最後まで」の区間に、AI の「隠す」区間が加わる
    const hidden = page.locator('[data-item-type="portrait"]', { hasText: '隠す' })
    await expect(page.locator('[data-item-type="portrait"]')).toHaveCount(1)
    await page.getByTestId('proposal-apply').click()
    await expect(page.locator('[data-item-type="portrait"]')).toHaveCount(2)
    await expect(hidden).toHaveCount(1)
    await expect(page.locator('[data-item-type="voice"]')).toHaveCount(2)

    // 1回の取り消しで全部戻る
    await page.keyboard.press('Control+z')
    await expect(hidden).toHaveCount(0)
    await page.keyboard.press('Control+y')
    await expect(hidden).toHaveCount(1)
    await page.getByTestId('lane-lyr_bgm').click({ position: { x: 900, y: 10 } })
    // 話し手の強調の設定は、右の欄のインスペクタのタブにある
    await page.getByTestId('side-tab-inspector').click()
    await expect(page.getByTestId('speaker-dim')).toHaveValue('0.45')
    await expect(page.getByTestId('speaker-hop')).toBeChecked()
  })
})
