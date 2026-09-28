import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { makeTestVideo } from '../tests/fixtures/media'
import { aiCalls, clearAiCalls, openFresh, queueAiResponses, queuePick, updateSettings, useFakeAi } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

function reply(text: string): unknown {
  return { candidates: [{ lines: [{ speaker: '四国めたん', text, expression: null }] }] }
}

test.describe('相方に画面を見せる', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zunda-e2e-vision-'))

  test.beforeEach(async ({ request }) => {
    clearAiCalls()
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
    await useFakeAi(request)
  })

  test('再生位置の画面・区間の映像を画像として添えて、返答を作らせられる', async ({ page, request }) => {
    const video = makeTestVideo(directory, { name: 'boss.mp4', seconds: 12 })
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
    await queuePick(request, [video])
    await page.getByTestId('add-media').click()
    await expect(page.locator('[data-item-type="video"]')).toHaveCount(1)
    await page.getByTestId('open-bulk').click()
    await page.getByTestId('bulk-text').fill('ずんだもん:ボスが出てきたのだ！')
    await page.getByTestId('bulk-submit').click()
    await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(1, { timeout: 30_000 })

    // 再生位置(3秒)の画面を見せる
    const ruler = (await page.getByTestId('timeline-ruler').boundingBox())!
    await page.mouse.click(ruler.x + 3 * 60, ruler.y + ruler.height / 2)
    await page.getByTestId('cohost-candidates').selectOption('1')
    await page.getByTestId('cohost-vision').selectOption('frame')
    queueAiResponses([reply('画面の右側、青いのがボスね'), reply('今の数秒で一気に近づいてきたわ')])
    await page.getByTestId('cohost-generate').click()
    await expect(page.getByTestId('cohost-line-text')).toHaveValue('画面の右側、青いのがボスね')
    await expect(page.getByTestId('cohost-vision-status')).toHaveText('画面を 1 コマ見せて作りました')
    const frameCall = aiCalls().at(-1) as unknown as { stdin: string; images: { mediaType: string; bytes: number; caption: string }[] }
    expect(frameCall.images).toHaveLength(1)
    expect(frameCall.images[0]).toMatchObject({ mediaType: 'image/jpeg', caption: '動画の 0:03.000 の画面' })
    expect(frameCall.images[0]!.bytes).toBeGreaterThan(500)
    expect(frameCall.stdin).toContain('添付の画像は、動画の 0:03.000 のゲーム画面です')
    await page.getByTestId('cohost-discard').click()

    // 区間(3〜9秒)の映像を見せる → 5 コマに分けて送る
    // (セリフを入れたときに録画が後ろへずれているので、録画の映っている区間を選ぶ。映像の無い時刻は飛ばされる)
    await page.getByTestId('cohost-vision').selectOption('clip')
    await page.getByTestId('cohost-clip-start').fill('3')
    await page.getByTestId('cohost-clip-start').press('Enter')
    await page.getByTestId('cohost-clip-end').fill('9')
    await page.getByTestId('cohost-clip-end').press('Enter')
    await page.getByTestId('cohost-generate').click()
    await expect(page.getByTestId('cohost-line-text')).toHaveValue('今の数秒で一気に近づいてきたわ')
    await expect(page.getByTestId('cohost-vision-status')).toHaveText('画面を 5 コマ見せて作りました')
    const clipCall = aiCalls().at(-1) as unknown as { stdin: string; images: { caption: string }[] }
    expect(clipCall.images.map((item) => item.caption)).toEqual([
      '動画の 0:03.000 の画面',
      '動画の 0:04.500 の画面',
      '動画の 0:06.000 の画面',
      '動画の 0:07.500 の画面',
      '動画の 0:09.000 の画面'
    ])
    expect(clipCall.stdin).toContain('0:03.000〜0:09.000 の映像を時間順にコマで分けたもの')
    await page.getByTestId('cohost-discard').click()

    // 再生位置の画面を複数(3秒・8秒・5秒)選んで見せる。時間順に並び、外すこともできる
    await page.getByTestId('cohost-vision').selectOption('frame')
    for (const seconds of [3, 8, 5, 10]) {
      await page.mouse.click(ruler.x + seconds * 60, ruler.y + ruler.height / 2)
      await page.getByTestId('cohost-frame-add').click()
    }
    // 同じ時刻は2回足せない
    await expect(page.getByTestId('cohost-frame-add')).toBeDisabled()
    await expect(page.getByTestId('cohost-frame')).toHaveText(['0:03.000×', '0:05.000×', '0:08.000×', '0:10.000×'])
    await page.getByTestId('cohost-frame').nth(3).getByTestId('cohost-frame-remove').click()
    await expect(page.getByTestId('cohost-frame')).toHaveCount(3)
    queueAiResponses([reply('三つの場面で、ボスがどんどん近づいてるわね')])
    await page.getByTestId('cohost-generate').click()
    await expect(page.getByTestId('cohost-line-text')).toHaveValue('三つの場面で、ボスがどんどん近づいてるわね')
    await expect(page.getByTestId('cohost-vision-status')).toHaveText('画面を 3 コマ見せて作りました')
    const framesCall = aiCalls().at(-1) as unknown as { stdin: string; images: { caption: string }[] }
    expect(framesCall.images.map((item) => item.caption)).toEqual(['動画の 0:03.000 の画面', '動画の 0:05.000 の画面', '動画の 0:08.000 の画面'])
    expect(framesCall.stdin).toContain('0:03.000、0:05.000、0:08.000 のゲーム画面です(時間順。間は飛んでいます)')

    // すべて外すと、今の再生位置の1コマに戻る
    await page.getByTestId('cohost-frame-clear').click()
    await expect(page.getByTestId('cohost-frame')).toHaveCount(0)
  })
})
