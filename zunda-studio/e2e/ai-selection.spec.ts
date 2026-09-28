import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { GOOD_KEY, startMockOpenCodeApi } from '../tests/fixtures/mock-opencode-api.mjs'
import { FIXTURE_BIN, openFresh, queuePick, updateSettings } from './helpers'

test.describe('AIの選択', () => {
  test.beforeEach(async ({ request }) => {
    await updateSettings(request, {
      ai: {
        roles: { conversation: null, editor: null },
        providers: {
          'claude-code': { executablePath: null },
          opencode: { connection: 'cli', executablePath: join(FIXTURE_BIN, 'missing-opencode') }
        }
      }
    })
    await request.post('/ipc/secrets:set', { data: { args: ['opencode.apiKey', null] } })
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

  test('OpenCode は APIキーを入れるだけで使え、モデルはおすすめとその他に分かれて全て選べる', async ({ page, request }) => {
    const mock = await startMockOpenCodeApi()
    try {
      await updateSettings(request, { ai: { providers: { opencode: { connection: 'api-key', baseUrl: mock.baseUrl } } } })
      await openFresh(page)
      await page.getByTestId('open-settings').click()
      await expect(page.getByTestId('provider-opencode-status')).toContainText('APIキーが未入力')
      await expect(page.getByTestId('opencode-path')).toHaveCount(0)

      // キーを入れる前でも、内蔵の一覧から Go と Zen の全モデルを選べる
      await page.getByTestId('role-conversation-provider').selectOption('opencode')
      const conversation = page.getByTestId('role-conversation-model')
      await expect(conversation.locator('optgroup[label="OpenCode Zen(従量課金)"] option', { hasText: 'Claude Opus 5' }).first()).toBeAttached()
      await expect(conversation.locator('optgroup[label="OpenCode Zen(従量課金)"] option', { hasText: 'Gemini 3.8 Flash' })).toHaveCount(1)
      expect(await conversation.locator('option').count()).toBeGreaterThan(100)

      // 間違ったキーでは、保存したときの接続テストで原因が分かる(サーバーの理由も出す)
      await page.getByTestId('opencode-key-input').fill('sk-wrong-0000')
      await page.getByTestId('opencode-key-save').click()
      await expect(page.getByTestId('opencode-key-status')).toContainText('…0000')
      await expect(page.getByTestId('opencode-key-test-result')).toContainText('無効なAPIキーです')
      // まだ選んでいなかった編集AIは、キーを入れたときに OpenCode になる
      await expect(page.getByTestId('role-editor-provider')).toHaveValue('opencode')
      await page.getByTestId('role-editor-provider').selectOption('opencode')
      await page.getByTestId('role-editor-test').click()
      await expect(page.getByTestId('role-editor-status')).toContainText('API キーを入力してください')

      // 正しいキーに入れ直すと、API のモデル一覧が出る(おすすめが先頭)
      await page.getByTestId('opencode-key-input').fill(GOOD_KEY)
      await page.getByTestId('opencode-key-save').click()
      await expect(page.getByTestId('provider-opencode-status')).toContainText('利用可能')
      await expect(page.getByTestId('opencode-key-input')).toHaveValue('')
      await expect(page.getByTestId('opencode-key-test-result')).toContainText('つながりました')
      await page.getByTestId('role-editor-provider').selectOption('claude-code')
      await page.getByTestId('role-editor-provider').selectOption('opencode')
      const model = page.getByTestId('role-editor-model')
      await expect(model.locator('optgroup[label="おすすめ"] option')).toHaveCount(4)
      await expect(model.locator('optgroup[label="OpenCode Go(月額プラン)"] option', { hasText: 'GLM-5.2' })).toHaveCount(1)
      await expect(model).toHaveValue(/^opencode-go\/(kimi|glm|deepseek|qwen)/)

      // その他から選んでも使える(messages 形式のモデル)
      await model.selectOption('opencode-go/minimax-m3')
      await page.getByTestId('role-editor-test').click()
      await expect(page.getByTestId('role-editor-status')).toContainText('接続できたのだ')

      // キーを消すと未入力に戻る
      await page.getByTestId('opencode-key-clear').click()
      await expect(page.getByTestId('provider-opencode-status')).toContainText('APIキーが未入力')
    } finally {
      await mock.close()
    }
  })

  test('Claude を選んだままキーを入れると、OpenCode に切り替える案内が出る', async ({ page, request }) => {
    const mock = await startMockOpenCodeApi()
    try {
      await updateSettings(request, {
        ai: {
          roles: { conversation: { providerId: 'claude-code', model: 'sonnet' }, editor: null },
          providers: { opencode: { connection: 'api-key', baseUrl: mock.baseUrl } }
        }
      })
      await openFresh(page)
      await page.getByTestId('open-settings').click()
      // 前後の空白や「Bearer」付きで貼っても通る
      await page.getByTestId('opencode-key-input').fill(`  Bearer ${GOOD_KEY}  `)
      await page.getByTestId('opencode-key-save').click()
      await expect(page.getByTestId('opencode-key-test-result')).toContainText('つながりました')
      await expect(page.getByTestId('opencode-key-status')).toContainText('…1234')

      // Claude を選んでいる会話AIはそのまま(勝手に変えない)で、案内を出す
      await expect(page.getByTestId('role-conversation-provider')).toHaveValue('claude-code')
      await expect(page.getByTestId('role-editor-provider')).toHaveValue('opencode')
      const notice = page.getByTestId('opencode-role-notice')
      await expect(notice).toContainText('会話AI(相方): Claude')
      await page.getByTestId('opencode-use-for-roles').click()
      await expect(page.getByTestId('role-conversation-provider')).toHaveValue('opencode')
      await expect(page.getByTestId('role-conversation-model')).toHaveValue(/^opencode-go\//)
      await expect(notice).toHaveCount(0)

      // 接続テストのボタンでいつでも確かめられる
      await page.getByTestId('opencode-key-test').click()
      await expect(page.getByTestId('opencode-key-test-result')).toContainText('つながりました')
    } finally {
      await mock.close()
    }
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
