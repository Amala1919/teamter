import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { makeTestVideo } from '../tests/fixtures/media'
import { aiCalls, clearAiCalls, openFresh, queueAiResponses, queuePick, updateSettings, useFakeAi } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

async function startWithVideo(page: Page, request: Parameters<typeof queuePick>[0], video: string): Promise<string> {
  await openFresh(page)
  await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
  await queuePick(request, [video])
  await page.getByTestId('add-media').click()
  const item = page.locator('[data-item-type="video"]')
  await expect(item).toHaveCount(1)
  return (await item.getAttribute('data-asset-id'))!
}

test.describe('投稿文と録画からの下書き', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zunda-e2e-draft-'))
  let video: string

  test.beforeAll(() => {
    video = makeTestVideo(directory, { name: 'boss.mp4', seconds: 30 })
  })

  test.beforeEach(async ({ request }) => {
    clearAiCalls()
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
    await useFakeAi(request)
  })

  test('AI にタイトル案・概要欄・チャプターを作らせ、選んで直し、概要欄としてまとめて保存できる', async ({ page, request }) => {
    await startWithVideo(page, request, video)
    await page.getByTestId('open-bulk').click()
    await page.getByTestId('bulk-text').fill('ずんだもん:今日はボスに挑むのだ')
    await page.getByTestId('bulk-submit').click()
    await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(1, { timeout: 30_000 })

    queueAiResponses([
      {
        titles: ['初見でボスに挑むずんだもん', 'ボス戦、3日目の決着'],
        description: 'ずんだもんがボスに挑みます。',
        chapters: [
          { atSeconds: 0, title: 'はじめに' },
          { atSeconds: 12, title: 'ボス登場' },
          { atSeconds: 24, title: '決着' }
        ]
      }
    ])
    await page.getByTestId('open-export').click()
    await page.getByTestId('publish-generate').click()
    await expect(page.getByTestId('publish-title')).toHaveCount(2)
    expect(aiCalls().at(-1)!.stdin).toContain('今日はボスに挑むのだ')

    await page.getByTestId('publish-title').nth(1).click()
    await expect(page.getByLabel('プロジェクト名')).toHaveValue('ボス戦、3日目の決着')
    await expect(page.getByTestId('publish-chapter')).toHaveCount(3)
    await expect(page.getByTestId('publish-description')).toHaveValue('ずんだもんがボスに挑みます。')

    const textPath = join(directory, 'description.txt')
    await queuePick(request, [textPath])
    await page.getByTestId('credits-save').click()
    await expect.poll(() => {
      try {
        return readFileSync(textPath, 'utf8')
      } catch {
        return ''
      }
    }).toContain('ずんだもんがボスに挑みます。\n\n0:00 はじめに\n0:12 ボス登場\n0:24 決着\n\n【音声】\nVOICEVOX:ずんだもん')
  })

  test('録画から下書きを作らせ、差分を見て適用すると区間が並び、1回で取り消せる', async ({ page, request }) => {
    const assetId = await startWithVideo(page, request, video)
    queueAiResponses([
      {
        reply: '盛り上がる2か所をつなぎました',
        commands: [
          { op: 'media.placeVideo', assetId, atMs: 30_000, inMs: 2_000, outMs: 10_000 },
          { op: 'media.placeVideo', assetId, atMs: 38_000, inMs: 20_000, outMs: 26_000 }
        ]
      }
    ])
    await page.getByTestId('open-draft').click()
    await page.getByTestId('draft-minutes').selectOption('3')
    await page.getByTestId('draft-start').click()

    await expect(page.getByTestId('chat-message-user').last()).toContainText('から3分くらいの下書きを作って')
    const proposal = page.getByTestId('proposal')
    await expect(proposal).toContainText('動画を追加(2件)', { timeout: 60_000 })
    await expect(page.getByTestId('chat-message-assistant').last()).toContainText('盛り上がる2か所をつなぎました')
    // 録画を解析した候補が依頼文に入っている
    expect(aiCalls().at(-1)!.stdin).toContain('使えそうな区間の候補')
    expect(aiCalls().at(-1)!.system).toContain(`assetId は "${assetId}"`)

    await page.getByTestId('proposal-apply').click()
    await expect(page.locator('[data-item-type="video"]')).toHaveCount(3)
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(page.locator('[data-item-type="video"]')).toHaveCount(1)
  })
})
