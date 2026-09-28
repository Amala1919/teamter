import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { makeTestAudio } from '../tests/fixtures/media'
import { openFresh, queuePick, updateSettings } from './helpers'
import { MOCK_VOICEVOX_URL } from './ports'

test.describe('フリー素材サイトとクレジット', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zunda-e2e-free-'))

  test.beforeEach(async ({ request }) => {
    await updateSettings(request, {
      voice: { engines: [{ id: 'voicevox', label: 'VOICEVOX', url: MOCK_VOICEVOX_URL, executablePath: null, autoLaunch: false }] }
    })
  })

  test('サイトの一覧を見られ、取り込んだ素材のクレジットが概要欄の下書きに自動で入る', async ({ page, request }) => {
    const maou = makeTestAudio(directory, { name: 'maou_bgm_orchestra20.wav', seconds: 1 })
    const plain = makeTestAudio(directory, { name: 'ほのぼの日常.wav', seconds: 1 })
    await openFresh(page)

    // サイトの一覧(戦争・歴史もの向きで絞れる)
    await page.getByTestId('open-free-sources').click()
    await expect(page.getByTestId('free-source').first()).toBeVisible()
    const all = await page.getByTestId('free-source').count()
    expect(all).toBeGreaterThan(10)
    await page.getByTestId('free-source-filter-epic').check()
    await expect(page.getByTestId('free-source')).toHaveCount(3)
    await expect(page.getByTestId('free-sources')).toContainText('魔王魂')
    await page.keyboard.press('Escape')

    // 魔王魂のファイル名なら、取り込んだ時点で入手元とクレジットが埋まる
    await queuePick(request, [maou])
    await page.getByTestId('add-media').click()
    await expect(page.getByTestId('license-site')).toHaveValue('maoudamashii')
    await expect(page.getByTestId('license-credit-text')).toHaveValue('音楽: 魔王魂')
    await expect(page.getByTestId('license-site-notes')).toContainText('クレジット表記が必要')

    // 分からないファイルは、あとからサイトを選ぶと埋まる(任意のサイトも既定で概要欄に載せる)
    await page.getByTestId('timeline-ruler').click({ position: { x: 90, y: 5 } })
    await queuePick(request, [plain])
    await page.getByTestId('add-media').click()
    await expect(page.getByTestId('license-site')).toHaveValue('')
    await page.getByTestId('license-site').selectOption('dova')
    await expect(page.getByTestId('license-credit-optin')).toBeChecked()
    await expect(page.getByTestId('license-credit-text')).toHaveValue('BGM: DOVA-SYNDROME「ほのぼの日常」')

    await page.getByTestId('open-export').click()
    const credits = page.getByTestId('credits-section')
    await expect(credits.locator('textarea')).toHaveValue(/音楽: 魔王魂/)
    await expect(credits.locator('textarea')).toHaveValue(/BGM: DOVA-SYNDROME「ほのぼの日常」/)
  })
})
