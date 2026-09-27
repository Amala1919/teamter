import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { makeTestVideo } from '../tests/fixtures/media'
import { openFresh, queuePick, updateSettings } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

async function prepareProject(page: Page, request: Parameters<typeof queuePick>[0], video: string): Promise<void> {
  await openFresh(page)
  await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()
  await page.getByTestId('open-bulk').click()
  await page.getByTestId('bulk-text').fill('ずんだもん:書き出すのだ！\n四国めたん:いいわね。')
  await page.getByTestId('bulk-submit').click()
  await expect(page.getByTestId('synthesis-status').filter({ hasText: '合成済み' })).toHaveCount(2, { timeout: 30_000 })
  await page.getByTestId('timeline-ruler').click({ position: { x: 1, y: 5 } })
  await queuePick(request, [video])
  await page.getByTestId('add-media').click()
  await expect(page.locator('[data-item-type="video"]')).toHaveCount(1)
}

test.describe('書き出し', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zunda-e2e-export-'))
  let shortVideo: string
  let longVideo: string

  test.beforeAll(() => {
    shortVideo = makeTestVideo(directory, { name: 'short.mp4', seconds: 3 })
    longVideo = makeTestVideo(directory, { name: 'long.mp4', seconds: 30 })
  })

  test.beforeEach(async ({ request }) => {
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
  })

  test('mp4 に書き出し、概要欄のクレジットを確認して保存できる', async ({ page, request }) => {
    test.setTimeout(180_000)
    await prepareProject(page, request, shortVideo)

    await page.getByTestId('open-export').click()
    const credits = page.getByTestId('credits-text')
    await expect(credits).toHaveValue(/【音声】\nVOICEVOX:ずんだもん\nVOICEVOX:四国めたん/)
    await expect(page.getByTestId('credit-issue')).toHaveCount(0)

    // 解像度を下げて書き出す
    await page.getByTestId('export-height').selectOption('720')
    const output = join(directory, 'out.mp4')
    await queuePick(request, [output])
    await page.getByTestId('export-start').click()
    await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 150_000 })
    await expect(page.getByTestId('export-done')).toContainText(output)

    const probe = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', output]).toString()
    ) as { streams: { codec_name: string; height?: number }[]; format: { duration: string } }
    expect(probe.streams.map((stream) => stream.codec_name).sort()).toEqual(['aac', 'h264'])
    expect(probe.streams.find((stream) => stream.codec_name === 'h264')!.height).toBe(720)
    expect(Number(probe.format.duration)).toBeGreaterThan(2.5)

    // クレジットを確認して、概要欄のテキストとして保存する
    await page.getByTestId('credits-confirmed').check()
    await expect(page.getByTestId('credits-confirmed')).toBeChecked()
    const textPath = join(directory, 'description.txt')
    await queuePick(request, [textPath])
    await page.getByTestId('credits-save').click()
    await expect(page.getByText(`保存しました: ${textPath}`)).toBeVisible()
    expect(readFileSync(textPath, 'utf8')).toContain('VOICEVOX:ずんだもん')

    // 文を書き換えると確認済みの印が外れる
    await credits.fill(`${await credits.inputValue()}\n立ち絵: 例`)
    await credits.blur()
    await expect(page.getByTestId('credits-confirmed')).not.toBeChecked()
  })

  test('書き出しは途中で中止でき、ファイルを残さない', async ({ page, request }) => {
    test.setTimeout(120_000)
    await prepareProject(page, request, longVideo)
    await page.getByTestId('open-export').click()
    const output = join(directory, 'cancelled.mp4')
    await queuePick(request, [output])
    await page.getByTestId('export-start').click()
    await expect(page.getByTestId('export-phase')).toContainText('映像を書き出し中', { timeout: 60_000 })
    await page.getByTestId('export-cancel').click()
    await expect(page.getByTestId('export-phase')).toHaveText('中止しました')
    expect(existsSync(output)).toBe(false)
    expect(existsSync(output.replace('.mp4', '.part.mp4'))).toBe(false)
  })

  test('保存ダイアログで選んでいない場所には書き出せない', async ({ request }) => {
    const response = await request.post('/ipc/export:start', {
      data: { args: [{ project: { formatVersion: 1, meta: { title: 'x' }, assets: {}, items: [] }, outputPath: join(directory, 'evil.mp4') }] }
    })
    const body = (await response.json()) as { ok: boolean; error?: { code: string } }
    expect(body).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
  })
})
