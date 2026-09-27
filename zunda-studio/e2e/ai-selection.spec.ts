import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { FIXTURE_BIN, openFresh, queuePick, updateSettings } from './helpers'

test.describe('AIの選択', () => {
  test.beforeEach(async ({ request }) => {
    await updateSettings(request, {
      ai: {
        roles: { conversation: null, editor: null },
        providers: {
          'claude-code': { executablePath: null },
          opencode: { executablePath: join(FIXTURE_BIN, 'missing-opencode') }
        }
      }
    })
  })

  test('会話AIと編集AIを別々に選び、接続テストできる', async ({ page }) => {
    await openFresh(page)
    await page.getByTestId('open-settings').click()

    // CLIの場所を指定すると状態が「利用可能」になる
    const claudePath = page.getByTestId('claude-path')
    await claudePath.fill(join(FIXTURE_BIN, 'claude'))
    await claudePath.blur()
    await expect(page.getByTestId('provider-claude-code-status')).toContainText('利用可能')
    await expect(page.getByTestId('provider-opencode-status')).toContainText('見つかりません')

    // 会話AI: Claude の opus
    await page.getByTestId('role-conversation-provider').selectOption('claude-code')
    await page.getByTestId('role-conversation-model').selectOption('opus')
    await page.getByTestId('role-conversation-test').click()
    await expect(page.getByTestId('role-conversation-status')).toContainText('接続できたのだ')

    // 編集AI: OpenCode。CLIが無くても内蔵の候補から選べる
    await page.getByTestId('role-editor-provider').selectOption('opencode')
    await expect(page.getByTestId('role-editor-model')).toHaveValue(/^opencode-go\//)

    // 一覧に無いモデルは手入力で指定できる
    await page.getByTestId('role-editor-model').selectOption('__custom__')
    const custom = page.getByTestId('role-editor-custom')
    await custom.fill('opencode-go/future-model-9')
    await custom.press('Enter')
    await expect(custom).toHaveValue('opencode-go/future-model-9')

    // CLIが無いOpenCodeで接続テストすると、原因と対処が表示される
    await page.getByTestId('role-editor-test').click()
    await expect(page.getByTestId('role-editor-status')).toContainText('インストールされているか確認してください')
  })

  test('相方の中の人をプロジェクトごとに切り替え、元に戻し、保存できる', async ({ page, request }) => {
    await updateSettings(request, {
      ai: {
        roles: { conversation: { providerId: 'claude-code', model: 'sonnet' } },
        providers: { 'claude-code': { executablePath: join(FIXTURE_BIN, 'claude') } }
      }
    })
    await openFresh(page)
    await page.getByRole('button', { name: /ずんだもん\(あなた\)/ }).click()

    const provider = page.getByTestId('cohost-model-provider')
    await expect(provider).toHaveValue('')
    await expect(provider.locator('option:checked')).toContainText('Claude / sonnet')

    // この動画だけ OpenCode に交代する
    await provider.selectOption('opencode')
    await expect(page.getByTestId('cohost-model-model')).toHaveValue(/^opencode-go\//)

    // 交代は undo で取り消せる
    await page.getByRole('button', { name: '元に戻す' }).click()
    await expect(provider).toHaveValue('')
    await page.getByRole('button', { name: 'やり直す' }).click()
    await expect(provider).toHaveValue('opencode')

    // 保存して開き直しても残っている
    const directory = mkdtempSync(join(tmpdir(), 'zunda-e2e-project-'))
    const projectPath = join(directory, 'episode1.zsproj')
    await queuePick(request, [projectPath])
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText(projectPath)).toBeVisible()

    await page.getByRole('button', { name: '新規' }).click()
    await expect(page.getByTestId('cohost-bar')).toHaveCount(0)
    await queuePick(request, [projectPath])
    await page.getByRole('button', { name: '開く' }).click()
    await expect(page.getByTestId('cohost-model-provider')).toHaveValue('opencode')
  })
})
