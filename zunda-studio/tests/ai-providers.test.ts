import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { AppError } from '@main/core/errors'
import { AiService } from '@main/services/ai/ai-service'
import { ClaudeCodeProvider } from '@main/services/ai/claude-code-provider'
import { OpenCodeProvider, parseModelList, parseRunEvents } from '@main/services/ai/opencode-provider'
import type { AppSettings } from '@shared/settings/schema'

import { fakeCliSettings, readCliLog, tempDir, type CliLogEntry } from './helpers/env'

let work: string
let logFile: string

beforeEach(async () => {
  work = await tempDir('zs-ai-')
  logFile = join(work, 'cli-log.jsonl')
})

function envFor(mode: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, FAKE_MODE: mode, FAKE_LOG: logFile, ...extra }
}

async function onlyLogEntry(): Promise<CliLogEntry> {
  const entries = await readCliLog(logFile)
  expect(entries).toHaveLength(1)
  return entries[0]!
}

async function expectAppError(promise: Promise<unknown>, code: string): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(AppError)
  expect((error as AppError).code).toBe(code)
  return error as AppError
}

describe('ClaudeCodeProvider', () => {
  const claude = (settings: AppSettings, env: NodeJS.ProcessEnv): ClaudeCodeProvider =>
    new ClaudeCodeProvider(() => settings, work, env)

  it('ツールと利用者の設定を外し、サブスクのログインで生成する', async () => {
    const provider = claude(fakeCliSettings(), envFor('text', { ANTHROPIC_API_KEY: 'sk-should-be-stripped' }))
    const result = await provider.generate('sonnet', {
      system: 'あなたは四国めたんです。',
      turns: [{ role: 'user', content: 'ボスが強すぎるのだ' }]
    })

    expect(result.text).toBe('こんにちはなのだ')
    expect(result.generatedBy).toMatchObject({ providerId: 'claude-code', model: 'sonnet' })

    const entry = await onlyLogEntry()
    expect(entry.argv).toEqual(
      expect.arrayContaining(['-p', '--output-format', 'json', '--model', 'sonnet', '--safe-mode'])
    )
    expect(entry.argv).toContain('--no-session-persistence')
    const toolsIndex = entry.argv.indexOf('--tools')
    expect(entry.argv[toolsIndex + 1]).toBe('')
    expect(entry.argv[entry.argv.indexOf('--disallowedTools') + 1]).toBe('mcp__*')
    expect(entry.argv[entry.argv.indexOf('--permission-prompts') + 1]).toBe('none')
    // --bare を付けるとサブスクのログインが使われなくなる
    expect(entry.argv).not.toContain('--bare')
    expect(entry.stdin).toBe('ボスが強すぎるのだ')
    expect(entry.system).toBe('あなたは四国めたんです。')
    expect(entry.hasApiKey).toBe(false)
    expect(entry.cwd).toBe(work)
  })

  it('システムプロンプトの一時ファイルを後に残さない', async () => {
    await claude(fakeCliSettings(), envFor('text')).generate('sonnet', {
      system: 's',
      turns: [{ role: 'user', content: 'u' }]
    })
    const leftovers = (await readdir(work)).filter((name) => name.startsWith('system-'))
    expect(leftovers).toEqual([])
  })

  it('小さなスキーマは --json-schema で渡し structured_output を読む', async () => {
    const structured = { candidates: [{ text: 'はい' }] }
    const result = await claude(
      fakeCliSettings(),
      envFor('structured', { FAKE_STRUCTURED: JSON.stringify(structured) })
    ).generate('sonnet', {
      system: 's',
      turns: [{ role: 'user', content: 'u' }],
      jsonSchema: { type: 'object' }
    })
    expect(result.structured).toEqual(structured)
    const entry = await onlyLogEntry()
    expect(entry.argv[entry.argv.indexOf('--json-schema') + 1]).toBe('{"type":"object"}')
  })

  it('大きなスキーマはシステムプロンプトで指示し、本文から JSON を取り出す', async () => {
    const hugeSchema = { type: 'object', description: 'x'.repeat(7000) }
    const result = await claude(
      fakeCliSettings(),
      envFor('structured-in-text', { FAKE_STRUCTURED: '{"ok":true}' })
    ).generate('sonnet', { system: '基本の指示', turns: [{ role: 'user', content: 'u' }], jsonSchema: hugeSchema })
    expect(result.structured).toEqual({ ok: true })
    const entry = await onlyLogEntry()
    expect(entry.argv).not.toContain('--json-schema')
    expect(entry.system).toContain('基本の指示')
    expect(entry.system).toContain('JSONスキーマ')
  })

  it('会話の履歴を1つのプロンプトにまとめて渡す', async () => {
    await claude(fakeCliSettings(), envFor('text')).generate('sonnet', {
      system: 's',
      turns: [
        { role: 'user', content: '一回目' },
        { role: 'assistant', content: '返事' },
        { role: 'user', content: '二回目' }
      ]
    })
    const entry = await onlyLogEntry()
    expect(entry.stdin).toContain('一回目')
    expect(entry.stdin).toContain('返事')
    expect(entry.stdin.indexOf('二回目')).toBeGreaterThan(entry.stdin.indexOf('返事'))
  })

  it('未ログインを利用者に分かるエラーにする', async () => {
    await expectAppError(
      claude(fakeCliSettings(), envFor('login')).generate('sonnet', { system: 's', turns: [{ role: 'user', content: 'u' }] }),
      'AI_NOT_LOGGED_IN'
    )
  })

  it('利用上限を利用者に分かるエラーにする', async () => {
    await expectAppError(
      claude(fakeCliSettings(), envFor('rate')).generate('sonnet', { system: 's', turns: [{ role: 'user', content: 'u' }] }),
      'AI_RATE_LIMITED'
    )
  })

  it('プランで使えないモデルは、CLI の理由を添えて別のモデルを選ぶよう案内する', async () => {
    const error = await claude(fakeCliSettings(), envFor('credits'))
      .generate('fable', { system: 's', turns: [{ role: 'user', content: 'u' }] })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ code: 'AI_MODEL_UNAVAILABLE' })
    expect((error as AppError).message).toContain('Fable 5.1 requires usage credits')
  })

  it('CLI が古くてオプションを知らなければ、更新を案内する', async () => {
    const error = await claude(fakeCliSettings(), envFor('outdated'))
      .generate('sonnet', { system: 's', turns: [{ role: 'user', content: 'u' }] })
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'CLI_OUTDATED' })
    expect((error as AppError).message).toContain("unknown option '--safe-mode'")
  })

  it('時間内に応答しなければ打ち切る', async () => {
    const settings = fakeCliSettings({ ai: { providers: { 'claude-code': { timeoutMs: 500 } } } })
    const error = await expectAppError(
      claude(settings, envFor('sleep')).generate('sonnet', { system: 's', turns: [{ role: 'user', content: 'u' }] }),
      'CLI_FAILED'
    )
    expect(error.message).toContain('時間内に応答しませんでした')
  })

  it('中止できる', async () => {
    const controller = new AbortController()
    const pending = claude(fakeCliSettings(), envFor('sleep')).generate(
      'sonnet',
      { system: 's', turns: [{ role: 'user', content: 'u' }] },
      controller.signal
    )
    setTimeout(() => controller.abort(), 200)
    await expectAppError(pending, 'CANCELLED')
  })

  it('モデルIDに危険な文字があれば起動しない', async () => {
    await expectAppError(
      claude(fakeCliSettings(), envFor('text')).generate('sonnet; rm -rf /', {
        system: 's',
        turns: [{ role: 'user', content: 'u' }]
      }),
      'INVALID_ARGUMENT'
    )
  })

  it('実行ファイルが無ければ未インストールと報告する', async () => {
    const settings = fakeCliSettings({ ai: { providers: { 'claude-code': { executablePath: join(work, 'missing') } } } })
    const provider = claude(settings, envFor('text'))
    expect((await provider.status()).state.kind).toBe('not-installed')
    await expectAppError(provider.generate('sonnet', { system: 's', turns: [{ role: 'user', content: 'u' }] }), 'CLI_NOT_FOUND')
  })

  it('バージョンを報告する', async () => {
    const status = await claude(fakeCliSettings(), envFor('text')).status()
    expect(status.state).toEqual({ kind: 'ready', version: '9.9.9 (Claude Code)' })
  })

  it('手入力したモデルを一覧に加える', async () => {
    const settings = fakeCliSettings({ ai: { providers: { 'claude-code': { customModels: ['claude-future-9'] } } } })
    const models = await claude(settings, envFor('text')).listModels()
    expect(models.map((model) => model.id)).toContain('sonnet')
    expect(models.at(-1)).toEqual({ id: 'claude-future-9', label: 'claude-future-9', source: 'custom' })
  })
})

describe('OpenCodeProvider', () => {
  const opencode = (settings: AppSettings, env: NodeJS.ProcessEnv): OpenCodeProvider =>
    new OpenCodeProvider(() => settings, work, env)

  it('ツールを全て拒否した専用エージェントで生成する', async () => {
    const result = await opencode(fakeCliSettings(), envFor('text')).generate('opencode-go/kimi-k3', {
      system: 'あなたは四国めたんです。',
      turns: [{ role: 'user', content: 'ボスが強すぎるのだ' }]
    })
    expect(result.text).toBe('了解したわ')
    expect(result.generatedBy).toMatchObject({ providerId: 'opencode', model: 'opencode-go/kimi-k3' })

    const entry = await onlyLogEntry()
    expect(entry.argv).toEqual([
      'run',
      '--format',
      'json',
      '--agent',
      'zunda-studio',
      '--model',
      'opencode-go/kimi-k3',
      '--pure'
    ])
    expect(entry.stdin).toBe('ボスが強すぎるのだ')
    expect(entry.disableClaudeCode).toBe('1')
    const agent = (entry.config?.['agent'] as Record<string, Record<string, unknown>>)['zunda-studio']!
    expect(agent['prompt']).toBe('あなたは四国めたんです。')
    const permission = agent['permission'] as Record<string, string>
    expect(permission['*']).toBe('deny')
    expect(permission['bash']).toBe('deny')
    expect(permission['edit']).toBe('deny')
    // steps: 1 は最初の応答に「最大ステップ到達」の指示を注入してしまうため指定しない
    expect(agent).not.toHaveProperty('steps')
  })

  it('前置きやコードブロックが付いた応答からも JSON を取り出す', async () => {
    const result = await opencode(
      fakeCliSettings(),
      envFor('json-with-prose', { FAKE_STRUCTURED: '{"candidates":[{"text":"ええ"}]}' })
    ).generate('opencode-go/kimi-k3', {
      system: '基本の指示',
      turns: [{ role: 'user', content: 'u' }],
      jsonSchema: { type: 'object' }
    })
    expect(result.structured).toEqual({ candidates: [{ text: 'ええ' }] })
    const entry = await onlyLogEntry()
    const agent = (entry.config?.['agent'] as Record<string, Record<string, unknown>>)['zunda-studio']!
    expect(String(agent['prompt'])).toContain('JSONスキーマ')
  })

  it('認証エラーを利用者に分かるエラーにする', async () => {
    await expectAppError(
      opencode(fakeCliSettings(), envFor('auth-error')).generate('opencode-go/kimi-k3', {
        system: 's',
        turns: [{ role: 'user', content: 'u' }]
      }),
      'AI_NOT_LOGGED_IN'
    )
  })

  it('モデル一覧を CLI から取得し、全プロバイダのモデルをプランごとにまとめて出す', async () => {
    const models = await opencode(fakeCliSettings(), envFor('text')).listModels()
    expect(models.map((model) => model.id)).toEqual(['opencode-go/kimi-k3', 'opencode-go/glm-5.3', 'anthropic/claude-sonnet-5'])
    expect(models.every((model) => model.source === 'cli')).toBe(true)
    expect(models[0]).toMatchObject({ label: 'Kimi K3', group: 'OpenCode Go(月額プラン)', recommended: true })
    expect(models[2]!.group).toBe('その他のプロバイダ(anthropic)')
  })

  it('一覧を取得できなければ内蔵の一覧(Go と Zen)を出す', async () => {
    const models = await opencode(fakeCliSettings(), envFor('models-fail')).listModels()
    expect(models.length).toBeGreaterThan(100)
    expect(models.every((model) => model.source === 'static')).toBe(true)
    expect(models.map((model) => model.id)).toEqual(expect.arrayContaining(['opencode-go/kimi-k3', 'opencode/claude-opus-5', 'opencode/gemini-3.8-flash']))
  })

  it('provider/model の形式でないモデルを拒否する', async () => {
    await expectAppError(
      opencode(fakeCliSettings(), envFor('text')).generate('kimi-k3', { system: 's', turns: [{ role: 'user', content: 'u' }] }),
      'INVALID_ARGUMENT'
    )
  })

  it('イベント列から本文とエラーを読み取る', () => {
    const stdout = [
      '{"type":"step_start"}',
      'ノイズ',
      '{"type":"text","part":{"type":"text","text":"前半"}}',
      '{"type":"text","part":{"type":"text","text":"後半"}}',
      '{"type":"error","error":{"name":"X","data":{"message":"壊れた"}}}'
    ].join('\n')
    expect(parseRunEvents(stdout)).toEqual({ text: '前半\n後半', errors: ['壊れた'] })
  })

  it('モデル一覧の出力から provider/model の行だけを拾う', () => {
    expect(parseModelList('Loading...\nopencode-go/kimi-k3\n\n  opencode-go/glm-5.3  \nnot a model\n')).toEqual([
      'opencode-go/kimi-k3',
      'opencode-go/glm-5.3'
    ])
  })
})

describe('AiService', () => {
  function service(settings: AppSettings, env: NodeJS.ProcessEnv): AiService {
    const ai = new AiService(() => settings)
    ai.register(new ClaudeCodeProvider(() => settings, work, env))
    ai.register(new OpenCodeProvider(() => settings, work, env))
    return ai
  }

  it('明示指定 → プロジェクトの会話AI → アプリの既定値 の順で決める', () => {
    const settings = fakeCliSettings({
      ai: {
        roles: {
          conversation: { providerId: 'claude-code', model: 'sonnet' },
          editor: { providerId: 'claude-code', model: 'opus' }
        }
      }
    })
    const ai = service(settings, envFor('text'))
    const project = { providerId: 'opencode' as const, model: 'opencode-go/kimi-k3' }
    const explicit = { providerId: 'opencode' as const, model: 'opencode-go/glm-5.3' }

    expect(ai.resolve('conversation')).toEqual({ providerId: 'claude-code', model: 'sonnet' })
    expect(ai.resolve('conversation', { projectConversation: project })).toEqual(project)
    expect(ai.resolve('conversation', { projectConversation: project, explicit })).toEqual(explicit)
    // プロジェクトの会話AI設定は編集AIには効かない
    expect(ai.resolve('editor', { projectConversation: project })).toEqual({ providerId: 'claude-code', model: 'opus' })
  })

  it('未設定の役割はそれと分かるエラーにする', () => {
    const ai = service(fakeCliSettings(), envFor('text'))
    expect(() => ai.resolve('editor')).toThrow(AppError)
    try {
      ai.resolve('editor')
    } catch (error) {
      expect((error as AppError).code).toBe('AI_NOT_CONFIGURED')
    }
  })

  const replySchema = z.object({ reply: z.string().min(1) })

  it('形式に合わない応答は指摘して1回だけやり直させる', async () => {
    const settings = fakeCliSettings({ ai: { roles: { editor: { providerId: 'claude-code', model: 'sonnet' } } } })
    const ai = service(
      settings,
      envFor('sequence', {
        FAKE_SEQUENCE: JSON.stringify([{ wrong: 1 }, { reply: 'できたのだ' }]),
        FAKE_COUNTER: join(work, 'counter')
      })
    )
    const { value, result } = await ai.generateStructured(
      'editor',
      { system: 's', turns: [{ role: 'user', content: '依頼' }] },
      replySchema
    )
    expect(value).toEqual({ reply: 'できたのだ' })
    expect(result.generatedBy.model).toBe('sonnet')

    const entries = await readCliLog(logFile)
    expect(entries).toHaveLength(2)
    expect(entries[1]!.stdin).toContain('形式に合っていませんでした')
    expect(entries[1]!.stdin).toContain('reply')
  })

  it('やり直しても合わなければ AI_OUTPUT_INVALID にする', async () => {
    const settings = fakeCliSettings({ ai: { roles: { editor: { providerId: 'opencode', model: 'opencode-go/kimi-k3' } } } })
    const ai = service(
      settings,
      envFor('sequence', { FAKE_SEQUENCE: JSON.stringify([{ wrong: 1 }]), FAKE_COUNTER: join(work, 'counter') })
    )
    await expectAppError(
      ai.generateStructured('editor', { system: 's', turns: [{ role: 'user', content: 'u' }] }, replySchema),
      'AI_OUTPUT_INVALID'
    )
  })
})
