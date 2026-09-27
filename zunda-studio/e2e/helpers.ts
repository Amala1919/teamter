import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { APIRequestContext, Page } from '@playwright/test'

import { AI_RESPONSE_DIR } from './ports'

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

/** 模擬CLIが次に返す AI の応答を積む(古い記録は消す)。 */
export function queueAiResponses(responses: unknown[]): void {
  mkdirSync(AI_RESPONSE_DIR, { recursive: true })
  writeFileSync(join(AI_RESPONSE_DIR, 'queue.json'), JSON.stringify(responses))
}

export function clearAiCalls(): void {
  rmSync(join(AI_RESPONSE_DIR, 'calls.jsonl'), { force: true })
  rmSync(join(AI_RESPONSE_DIR, 'queue.json'), { force: true })
}

/** 模擬CLIが受け取った依頼(システムプロンプトと入力)。 */
export function aiCalls(): { system: string | null; stdin: string; model?: string }[] {
  const path = join(AI_RESPONSE_DIR, 'calls.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { system: string | null; stdin: string; model?: string })
}

/** 会話AI・編集AIに模擬の Claude CLI を使う設定。 */
export async function useFakeAi(request: APIRequestContext): Promise<void> {
  await updateSettings(request, {
    ai: {
      roles: { conversation: { providerId: 'claude-code', model: 'sonnet' }, editor: { providerId: 'claude-code', model: 'opus' } },
      providers: { 'claude-code': { executablePath: join(FIXTURE_BIN, 'claude') } }
    }
  })
}
