import { resolve } from 'node:path'

import type { APIRequestContext, Page } from '@playwright/test'

export const FIXTURE_BIN = resolve('tests/fixtures/bin')

/** 次のファイル選択ダイアログの応答を積む。 */
export async function queuePick(request: APIRequestContext, paths: string[] | null): Promise<void> {
  await request.post('/__test/pick', { data: { response: paths } })
}

/** main 側の設定を直接更新する(画面操作の前提を整えるため)。 */
export async function updateSettings(request: APIRequestContext, patch: unknown): Promise<void> {
  const response = await request.post('/ipc/settings:update', { data: { args: [patch] } })
  const body = (await response.json()) as { ok: boolean }
  if (!body.ok) throw new Error(`settings:update failed: ${JSON.stringify(body)}`)
}

export async function openFresh(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: '新規' }).click()
}
