import { expect, test, type Locator } from '@playwright/test'

import { aiCalls, clearAiCalls, openFresh, queueAiResponses, updateSettings, useFakeAi } from './helpers'
import { MOCK_COMMONS_PORT, MOCK_VOICEVOX_URL } from './ports'

/** canvas の中の、指定した色(許容差つき)の画素の数(4画素に1つ調べる)。 */
async function countColor(canvas: Locator, color: readonly number[], tolerance = 40): Promise<number> {
  return canvas.evaluate(
    (element, [target, limit]) => {
      const canvasElement = element as unknown as {
        width: number
        height: number
        getContext(type: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } | null
      }
      const context = canvasElement.getContext('2d')
      if (!context) return 0
      const { data } = context.getImageData(0, 0, canvasElement.width, canvasElement.height)
      let count = 0
      for (let index = 0; index < data.length; index += 16) {
        if (Math.abs(data[index]! - target[0]!) <= limit && Math.abs(data[index + 1]! - target[1]!) <= limit && Math.abs(data[index + 2]! - target[2]!) <= limit) count++
      }
      return count
    },
    [color, tolerance] as const
  )
}

test.describe('解説パートを作る', () => {
  test.beforeEach(async ({ request }) => {
    clearAiCalls()
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
    await useFakeAi(request)
  })

  test('お題と長さから、AI の台本でセリフ・合いの手・参考画像・出典・見出しが並び、1回で取り消せる', async ({ page }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    queueAiResponses([
      {
        title: 'カイザーライヒとは',
        lines: [
          { speaker: '四国めたん', text: '今日はカイザーライヒの世界を解説しますわ', speech: null, expression: null, image: { query: 'ドイツ帝国 地図', queryEn: 'German Empire map', caption: '地図', sources: [] } },
          { speaker: 'ずんだもん', text: 'へぇ〜なのだ', speech: null, expression: null, image: null },
          { speaker: '四国めたん', text: '1918年にドイツが勝った世界ですの', speech: 'せんきゅうひゃくじゅうはちねんにドイツが勝った世界ですの', expression: null, image: null }
        ]
      }
    ])

    await page.getByTestId('side-tab-chat').click()
    await page.getByTestId('open-explainer').click()
    await page.getByTestId('explainer-topic').fill('カイザーライヒの世界観')
    await page.getByTestId('explainer-length').selectOption('60')
    await page.getByTestId('explainer-image-sources-free').check()
    // 相方が1人なので「ひとりで語る」、あなた(ずんだもん)の合いの手が入る。
    await expect(page.getByTestId('explainer-style-solo')).toBeChecked()
    await expect(page.getByTestId('explainer-interject')).toBeChecked()
    await page.getByTestId('explainer-start').click()
    await expect(page.getByTestId('explainer-done')).toContainText('3行のセリフ', { timeout: 30_000 })
    await expect(page.getByTestId('explainer-done')).toContainText('参考画像 1枚')

    // AI への依頼に、お題・長さ・語り方・合いの手が入っている。
    const call = aiCalls().at(-1)!
    expect(call.stdin).toContain('カイザーライヒの世界観')
    expect(call.system).toContain('約60秒')
    expect(call.system).toContain('1人で語る')
    expect(call.system).toContain('合いの手')
    expect(call.system).toContain('speech は合成音声が読み上げる文')

    await page.getByRole('button', { name: '閉じる' }).last().click()
    await expect(page.locator('[data-item-type="voice"]')).toHaveCount(3)
    await expect(page.locator('[data-item-type="image"]')).toHaveCount(1)
    await expect(page.locator('[data-item-type="text"][title*="出典: Wikimedia Commons"]')).toHaveCount(1)
    await expect(page.locator('[data-item-type="text"][title*="カイザーライヒとは"]')).toHaveCount(1)
    // 画像・出典・見出しは、それぞれ専用のレイヤーに1つずつ入る。
    for (const name of ['解説の画像', '出典', '解説の見出し']) await expect(page.locator('.timeline__layerName').getByText(name, { exact: true })).toHaveCount(1)
    await expect(page.locator('.timeline__layerName', { hasText: '解説の画像 2' })).toHaveCount(0)
    // セリフは合成済みで並ぶ(字幕も出る)。
    await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(3)
    // 読み間違えやすい語(年号)は、声は読み上げ用の文で作り、字幕はふつうの文のまま出す。
    const third = page.getByTestId('script-line').nth(2)
    await expect(third.getByTestId('script-text')).toHaveValue('せんきゅうひゃくじゅうはちねんにドイツが勝った世界ですの')
    await expect(third.getByTestId('script-display-text')).toHaveText('字幕: 1918年にドイツが勝った世界ですの')
    // 読み上げと字幕が同じセリフは、分けない。
    await expect(page.getByTestId('script-line').first().getByTestId('script-display-text')).toHaveCount(0)

    // 参考画像(模擬の Commons はマゼンタの画像)が画面に出る。
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(() => countColor(page.getByTestId('preview-canvas'), [255, 0, 255], 30), { timeout: 10_000 }).toBeGreaterThan(1000)

    // 1回の「元に戻す」で全部消える。
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(page.locator('[data-item-type="voice"]')).toHaveCount(0)
    await expect(page.locator('[data-item-type="image"]')).toHaveCount(0)
  })

  test('一次ソース・信頼できるサイトの画像も使うと、AI がウェブで見つけたページの画像を出典つきで出し、無ければ Commons で探す', async ({ page }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    const official = `http://127.0.0.1:${MOCK_COMMONS_PORT}/site/official.html`
    queueAiResponses([
      {
        title: '地図で見る',
        lines: [
          {
            speaker: '四国めたん',
            text: 'まずは公式の地図ですわ',
            speech: null,
            expression: null,
            image: {
              query: '地図',
              queryEn: 'map',
              caption: '公式の地図',
              sources: [
                { pageUrl: 'https://www.pinterest.com/pin/1', imageUrl: null, site: '転載', title: 'x', kind: 'reliable', reason: '' },
                { pageUrl: official, imageUrl: null, site: '模擬の公式サイト', title: '公式の地図', kind: 'primary', reason: '公式サイト' }
              ]
            }
          },
          { speaker: '四国めたん', text: '次は昔の写真ですの', speech: null, expression: null, image: { query: '写真', queryEn: 'old photo', caption: '写真', sources: [] } }
        ]
      }
    ])
    await page.getByTestId('side-tab-chat').click()
    await page.getByTestId('open-explainer').click()
    await page.getByTestId('explainer-topic').fill('地図の話')
    await page.getByTestId('explainer-interject').uncheck()
    // 既定は「一次ソース・信頼できるサイトの画像も使う」。
    await expect(page.getByTestId('explainer-image-sources-web')).toBeChecked()
    await page.getByTestId('explainer-start').click()
    await expect(page.getByTestId('explainer-done')).toContainText('参考画像 2枚', { timeout: 30_000 })
    await expect(page.getByTestId('explainer-done')).toContainText('一次ソース 1・Wikimedia Commons 1')
    await expect(page.getByTestId('explainer-done')).toContainText('出どころの確かめられないサイトの画像の候補 1 件')

    // ウェブで探すよう頼んでいる。
    const call = aiCalls().at(-1)!
    expect(call.system).toContain('一次ソース(primary)')

    await page.getByRole('button', { name: '閉じる' }).last().click()
    await expect(page.locator('[data-item-type="image"]')).toHaveCount(2)
    // 公式サイトの画像は、サイトの名前と題を出典に出す(ライセンスは出さない)。
    await expect(page.locator('[data-item-type="text"][title*="出典: 模擬の公式サイト「公式の地図」"]')).toHaveCount(1)
    await expect(page.locator('[data-item-type="text"][title*="出典: Wikimedia Commons"]')).toHaveCount(1)
    // 公式サイトの代表の画像(シアン)が画面に出る。
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(() => countColor(page.getByTestId('preview-canvas'), [0, 255, 255], 30), { timeout: 10_000 }).toBeGreaterThan(1000)
  })

  test('AI 同士の掛け合いでは、解説するキャラクターを2人以上選ぶ', async ({ page }) => {
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await page.getByTestId('side-tab-chat').click()
    await page.getByTestId('open-explainer').click()
    await page.getByTestId('explainer-topic').fill('お題')
    await page.getByTestId('explainer-style-dialogue').check()
    // 相方は1人だけなので、そのままでは作れない。
    await expect(page.getByTestId('explainer-start')).toBeDisabled()
    await page.getByTestId('explainer-interject').uncheck()
    await page.getByTestId('explainer-group').getByText('ずんだもん').click()
    await expect(page.getByTestId('explainer-start')).toBeEnabled()
  })
})
