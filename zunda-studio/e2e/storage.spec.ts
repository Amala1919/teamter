import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { openFresh, queuePick, updateSettings } from './helpers'

test.describe('キャッシュの保存場所', () => {
  test.afterEach(async ({ request }) => {
    await updateSettings(request, { storage: { cacheDir: null, cleanupCacheDir: null } })
  })

  test('キャッシュを別のフォルダへ移し(次の起動から使う)、既定の場所に戻せる', async ({ page, request }) => {
    const drive = mkdtempSync(join(tmpdir(), 'zunda-e2e-drive-'))
    await openFresh(page)
    await page.getByTestId('open-settings').click()
    await page.getByTestId('settings-tab-storage').click()
    const path = page.getByTestId('storage-path')
    await expect(path).not.toBeEmpty()
    const before = (await path.textContent()) ?? ''
    await expect(page.getByTestId('storage-size')).toContainText(/B$/)
    await expect(page.getByTestId('storage-pending')).toHaveCount(0)

    // フォルダを選んで移す。今の場所は次の起動まで変わらない
    await queuePick(request, [drive])
    await page.getByTestId('storage-move').click()
    const next = join(drive, 'zunda-studio-cache')
    await expect(page.getByTestId('storage-pending')).toBeVisible()
    await expect(page.getByTestId('storage-next-path')).toHaveText(next)
    await expect(path).toHaveText(before)
    expect(existsSync(join(next, '.zunda-studio-cache'))).toBe(true)

    // テスト用ホストでは起動し直せないので、その旨を出す
    await page.getByTestId('storage-relaunch').click()
    await expect(page.getByText('アプリを閉じて、もう一度開いてください')).toBeVisible()

    // 既定の場所に戻すと、コピーした先は片付ける
    await page.getByTestId('storage-reset').click()
    await expect(page.getByTestId('storage-pending')).toHaveCount(0)
    await expect.poll(() => existsSync(next)).toBe(false)
    expect(readdirSync(drive)).toEqual([])
  })

  test('選んだフォルダ以外へは移せない', async ({ request }) => {
    const response = await request.post('/ipc/cache:move', { data: { args: [join(tmpdir(), 'not-picked')] } })
    const body = (await response.json()) as { ok: boolean; error?: { message: string } }
    expect(body.ok).toBe(false)
    expect(body.error?.message).toContain('フォルダの選択で選んで')
  })
})
