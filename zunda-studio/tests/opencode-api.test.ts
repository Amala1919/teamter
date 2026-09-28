import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { PLAIN_CIPHER, SecretStore } from '@main/core/secret-store'
import { AiService } from '@main/services/ai/ai-service'
import { CLAUDE_MODELS } from '@main/services/ai/claude-code-provider'
import { apiModelName, baseUrlFor, formatsFor, httpFailure, modelPrefix, parseGatewayError, usesOfficialEndpoints } from '@main/services/ai/opencode-api'
import { OpenCodeProvider } from '@main/services/ai/opencode-provider'
import { groupModels, markRecommended, OPENCODE_RECOMMENDED } from '@shared/ai/models'
import type { ModelInfo } from '@shared/ai/types'
import type { AppSettings } from '@shared/settings/schema'
import { normalizeApiKey } from '@shared/settings/secrets'

import { GOOD_KEY, startMockOpenCodeApi, type MockOpenCodeApi } from './fixtures/mock-opencode-api.mjs'
import { settingsWith, tempDir } from './helpers/env'

let mock: MockOpenCodeApi
let work: string

beforeAll(async () => {
  mock = await startMockOpenCodeApi()
  work = await tempDir('zs-opencode-api-')
})
afterAll(async () => {
  await mock.close()
})

const settingsFor = (baseUrl = mock.baseUrl): AppSettings =>
  settingsWith({ ai: { providers: { opencode: { connection: 'api-key', baseUrl, timeoutMs: 10_000 } } } })

const provider = (key: string | null, settings = settingsFor()): OpenCodeProvider =>
  new OpenCodeProvider(() => settings, work, {}, () => key)

describe('OpenCode の API(キーで接続)', () => {
  it('キーが無ければ「未入力」、あれば末尾だけ見せて利用可能にする', async () => {
    expect((await provider(null).status()).state).toEqual({ kind: 'needs-key' })
    expect((await provider(GOOD_KEY).status()).state).toEqual({ kind: 'ready', version: 'APIキー …1234' })
  })

  it('モデル一覧を API から取り、opencode コマンドと同じ ID にそろえる', async () => {
    const models = await provider(GOOD_KEY).listModels()
    const ids = models.map((model) => model.id)
    expect(ids).toContain('opencode-go/kimi-k3')
    expect(ids).toContain('opencode-go/gpt-6-luna')
    // 系列ごとに最新の1つだけを勧める
    const recommended = models.filter((model) => model.recommended).map((model) => model.id)
    expect(recommended).toEqual(
      expect.arrayContaining(['opencode-go/kimi-k3', 'opencode-go/glm-5.3', 'opencode-go/deepseek-v4-pro', 'opencode-go/qwen3.8-max'])
    )
    expect(recommended).not.toContain('opencode-go/glm-5.2')
    expect(recommended).not.toContain('opencode-go/kimi-k2.7-code')
  })

  it('キーが無い・間違っているときも、内蔵の一覧(Go と Zen の全モデル)から選べる', async () => {
    const models = await provider(null).listModels()
    expect(models.length).toBeGreaterThan(100)
    const { recommended, groups } = groupModels(models)
    expect(groups.map((group) => group.label)).toEqual(['OpenCode Go(月額プラン)', 'OpenCode Zen(従量課金)'])
    // おすすめは契約しているプラン(既定は Go)から選ぶ
    expect(recommended.every((model) => model.id.startsWith('opencode-go/'))).toBe(true)
    const zen = groups[1]!.models
    expect(zen.find((model) => model.id === 'opencode/claude-opus-5')).toMatchObject({ label: 'Claude Opus 5' })
    // API キーでつなぐときは、無料のモデルは opencode コマンド経由でしか使えないと書き添える
    expect(zen.find((model) => model.id === 'opencode/big-pickle')).toMatchObject({ note: '無料・opencode コマンド経由のみ' })
    expect((await provider('sk-wrong').listModels()).some((model) => model.source === 'static')).toBe(true)
  })

  it('公式の接続先では、1つのキーで Go と Zen のモデルをそれぞれの接続先へ送る', () => {
    const go = 'https://opencode.ai/zen/go/v1'
    const zen = 'https://opencode.ai/zen/v1'
    expect(usesOfficialEndpoints(go)).toBe(true)
    expect(baseUrlFor('opencode/claude-opus-5', go)).toBe(zen)
    expect(baseUrlFor('opencode-go/kimi-k3', zen)).toBe(go)
    expect(baseUrlFor('opencode/claude-opus-5', 'http://127.0.0.1:9/v1')).toBe('http://127.0.0.1:9/v1')
    // 形式は内蔵の一覧で決まる(同じ名前でもプランで違うことがある)
    expect(formatsFor('opencode-go/minimax-m3')[0]).toBe('messages')
    expect(formatsFor('opencode/minimax-m3')[0]).toBe('chat')
    expect(formatsFor('opencode/gemini-3.8-flash')[0]).toBe('gemini')
    expect(formatsFor('opencode/claude-opus-5')[0]).toBe('messages')
  })

  it('Gemini の形式でも呼べる(考え中の部分は返事に含めない)', async () => {
    mock.calls.length = 0
    const result = await provider(GOOD_KEY).generate('opencode/gemini-3.8-flash', { system: 's', turns: [{ role: 'user', content: 'やあ' }] })
    expect(result.text).toBe('(gemini-3.8-flash が gemini で答えました)')
    expect(mock.calls.map((call) => call.path)).toEqual(['/models/gemini-3.8-flash:generateContent'])
    expect(mock.calls[0]!.body['systemInstruction']).toEqual({ parts: [{ text: 's' }] })
  })

  it('モデルごとに合った形式(chat / messages / responses)で呼ぶ', async () => {
    const ai = provider(GOOD_KEY)
    const request = { system: 'あなたは四国めたんです。', turns: [{ role: 'user' as const, content: 'やあ' }] }
    mock.calls.length = 0
    expect((await ai.generate('opencode-go/kimi-k3', request)).text).toBe('(kimi-k3 が chat で答えました)')
    expect((await ai.generate('opencode-go/minimax-m3', request)).text).toBe('(minimax-m3 が messages で答えました)')
    expect((await ai.generate('opencode-go/gpt-6-luna', request)).text).toBe('(gpt-6-luna が responses で答えました)')
    expect(mock.calls.map((call) => call.path)).toEqual(['/chat/completions', '/messages', '/responses'])
    // system は形式ごとの置き場所に入る
    expect(mock.calls[0]!.body['messages']).toEqual([
      { role: 'system', content: 'あなたは四国めたんです。' },
      { role: 'user', content: 'やあ' }
    ])
    expect(mock.calls[1]!.body['system']).toBe('あなたは四国めたんです。')
    expect(mock.calls[2]!.body['instructions']).toBe('あなたは四国めたんです。')
  })

  it('形式の見当が外れたら別の形式で試し、通った形式を覚える', async () => {
    const ai = provider(GOOD_KEY)
    const request = { system: 's', turns: [{ role: 'user' as const, content: 'やあ' }] }
    mock.calls.length = 0
    expect((await ai.generate('opencode-go/odd-model', request)).text).toContain('responses')
    expect(mock.calls.map((call) => call.path)).toEqual(['/chat/completions', '/messages', '/responses'])
    mock.calls.length = 0
    await ai.generate('opencode-go/odd-model', request)
    expect(mock.calls.map((call) => call.path)).toEqual(['/responses'])
  })

  it('キーの誤り・上限・キー未入力を、対処の分かるエラーにする', async () => {
    const request = { system: 's', turns: [{ role: 'user' as const, content: 'やあ' }] }
    await expect(provider('sk-wrong').generate('opencode-go/kimi-k3', request)).rejects.toMatchObject({ code: 'AI_KEY_REQUIRED' })
    await expect(provider(null).generate('opencode-go/kimi-k3', request)).rejects.toMatchObject({ code: 'AI_KEY_REQUIRED' })
    await expect(provider(GOOD_KEY).generate('opencode-go/limited-model', request)).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' })
  })

  it('キーは形式ごとに決まったヘッダーだけで送り、エラーの文は日本語で求める', async () => {
    const ai = provider(GOOD_KEY)
    const request = { system: 's', turns: [{ role: 'user' as const, content: 'やあ' }] }
    mock.calls.length = 0
    await ai.generate('opencode-go/kimi-k3', request)
    await ai.generate('opencode-go/minimax-m3', request)
    await ai.generate('opencode/gemini-3.8-flash', request)
    const [chat, messages, gemini] = mock.calls.map((call) => call.headers)
    expect(chat).toMatchObject({ authorization: `Bearer ${GOOD_KEY}`, 'accept-language': 'ja' })
    expect(chat!['x-api-key']).toBeUndefined()
    expect(messages).toMatchObject({ 'x-api-key': GOOD_KEY, 'anthropic-version': '2023-06-01' })
    expect(messages!['authorization']).toBeUndefined()
    expect(gemini).toMatchObject({ 'x-goog-api-key': GOOD_KEY })
    expect(gemini!['authorization']).toBeUndefined()
  })

  it('貼り付けたキーの余計な部分(Bearer・引用符・改行・全角)を取り除いて使う', async () => {
    const request = { system: 's', turns: [{ role: 'user' as const, content: 'やあ' }] }
    for (const pasted of [`Bearer ${GOOD_KEY}`, ` "${GOOD_KEY}"\n`, `OPENCODE_API_KEY=${GOOD_KEY}`, `\uFEFF${GOOD_KEY}\u3000`, GOOD_KEY.replace('sk', 'ｓｋ')]) {
      expect(normalizeApiKey(pasted)).toBe(GOOD_KEY)
      expect((await provider(pasted).generate('opencode-go/kimi-k3', request)).text).toContain('kimi-k3')
    }
  })

  it('残高不足・同意が必要などは、キーの誤りと言わずにサーバーの理由を見せる', async () => {
    const request = { system: 's', turns: [{ role: 'user' as const, content: 'やあ' }] }
    const wrong = await provider('sk-wrong').generate('opencode-go/kimi-k3', request).catch((error: unknown) => error)
    expect(wrong).toMatchObject({ code: 'AI_KEY_REQUIRED', message: expect.stringContaining('無効なAPIキーです') })

    const balance = await provider(GOOD_KEY).generate('opencode-go/balance-model', request).catch((error: unknown) => error)
    expect(balance).toMatchObject({ code: 'AI_MODEL_UNAVAILABLE', message: expect.stringContaining('残高が不足しています') })
    expect((balance as Error).message).toContain('OpenCode Go を契約しているアカウント')

    const consent = await provider(GOOD_KEY).generate('opencode-go/consent-model', request).catch((error: unknown) => error)
    expect(consent).toMatchObject({ code: 'AI_MODEL_UNAVAILABLE', message: expect.stringContaining('明示的な同意が必要') })

    expect(httpFailure(401, JSON.stringify({ type: 'error', error: { type: 'CreditsError', message: 'Insufficient balance.' } }), 'opencode/claude-opus-5').message).toContain(
      'OpenCode Go(月額プラン)」のモデルを選んでください'
    )
    expect(httpFailure(429, JSON.stringify({ type: 'error', error: { type: 'GoUsageLimitError', message: '5時間の利用上限に達しました' } }))).toMatchObject({
      code: 'AI_RATE_LIMITED',
      message: expect.stringContaining('5時間の利用上限')
    })
    // 無料枠のアカウントは OpenCode 本体の中からしか使えない。キーの誤りとは言わない
    const free = await provider(GOOD_KEY).generate('opencode-go/free-tier-model', request).catch((error: unknown) => error)
    expect(free).toMatchObject({ code: 'AI_SUBSCRIPTION_REQUIRED', message: expect.stringContaining('無料枠として扱われました') })
    expect(httpFailure(403, "OpenCode's free tier can only be used from within OpenCode").code).toBe('AI_SUBSCRIPTION_REQUIRED')

    expect(parseGatewayError('<html>Bad gateway</html>')).toEqual({ type: '', message: '<html>Bad gateway</html>' })
  })

  it('「この形式では使えない」と 401 で断られても、別の形式で試し直す', async () => {
    mock.calls.length = 0
    const result = await provider(GOOD_KEY).generate('opencode-go/strict-model', { system: 's', turns: [{ role: 'user', content: 'やあ' }] })
    expect(result.text).toContain('responses')
    expect(mock.calls.map((call) => call.path)).toEqual(['/chat/completions', '/messages', '/responses'])
  })

  it('構造化出力も、アプリ側の検証とやり直しの仕組みにそのまま乗る', async () => {
    process.env['FAKE_OPENCODE_JSON'] = '```json\n{"lines":["はいはい"]}\n```'
    try {
      const settings = settingsWith({
        ai: {
          roles: { editor: { providerId: 'opencode', model: 'opencode-go/glm-5.3' } },
          providers: { opencode: { connection: 'api-key', baseUrl: mock.baseUrl } }
        }
      })
      const ai = new AiService(() => settings)
      ai.register(new OpenCodeProvider(() => settings, work, {}, () => GOOD_KEY))
      const { value } = await ai.generateStructured('editor', { system: 's', turns: [{ role: 'user', content: 'x' }] }, z.object({ lines: z.array(z.string()) }))
      expect(value).toEqual({ lines: ['はいはい'] })
    } finally {
      delete process.env['FAKE_OPENCODE_JSON']
    }
  })

  it('接続先の URL から ID の前置きを決め、API には前置きを外して渡す', () => {
    expect(modelPrefix('https://opencode.ai/zen/go/v1')).toBe('opencode-go')
    expect(modelPrefix('https://opencode.ai/zen/v1')).toBe('opencode')
    expect(apiModelName('opencode-go/kimi-k3')).toBe('kimi-k3')
    expect(formatsFor('qwen3.8-max')[0]).toBe('messages')
    expect(formatsFor('grok-4.7')[0]).toBe('responses')
    expect(formatsFor('kimi-k3')).toEqual(['chat', 'messages', 'responses'])
    expect(formatsFor('gemini-9-flash')).toEqual(['gemini', 'chat', 'messages', 'responses'])
  })
})

describe('APIキーの保管', () => {
  it('暗号化して書き、値は返さず末尾だけ見せる。消すこともできる', async () => {
    const dir = await tempDir('zs-secrets-')
    const file = join(dir, 'secrets.json')
    const cipher = { secure: true, encrypt: (text: string) => `enc:${Buffer.from(text).toString('hex')}`, decrypt: (text: string) => Buffer.from(text.slice(4), 'hex').toString() }
    const store = new SecretStore(file, cipher)
    await store.load()
    expect(store.status('opencode.apiKey')).toEqual({ name: 'opencode.apiKey', set: false, hint: null, secure: true })
    await store.set('opencode.apiKey', '  sk-abcdef9876  ')
    expect(store.status('opencode.apiKey')).toMatchObject({ set: true, hint: '…9876' })
    const onDisk = await readFile(file, 'utf8')
    expect(onDisk).not.toContain('sk-abcdef9876')

    const reopened = new SecretStore(file, cipher)
    await reopened.load()
    expect(reopened.get('opencode.apiKey')).toBe('sk-abcdef9876')
    // 別の PC などで復号できないときは、無いものとして扱う
    const other = new SecretStore(file, { ...PLAIN_CIPHER, decrypt: () => { throw new Error('bad') } })
    await other.load()
    expect(other.get('opencode.apiKey')).toBeNull()

    await reopened.set('opencode.apiKey', null)
    expect(reopened.status('opencode.apiKey').set).toBe(false)
    await expect(reopened.set('opencode.apiKey', 'a\nb')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    // 貼り付けで付いた余計な部分は、保存する前に取り除く
    await reopened.set('opencode.apiKey', 'Bearer "sk-abcdef9876"\n')
    expect(reopened.get('opencode.apiKey')).toBe('sk-abcdef9876')
  })
})

describe('モデルのおすすめ', () => {
  it('Claude はエイリアスを勧め、それ以外の版も全て選べる', () => {
    const { recommended, groups } = groupModels(CLAUDE_MODELS)
    expect(recommended.map((model) => model.id)).toEqual(['sonnet', 'opus', 'haiku'])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.models.map((model) => model.id)).toEqual(expect.arrayContaining(['fable', 'claude-opus-4-8', 'claude-sonnet-4-5', 'claude-haiku-4-5']))
  })

  it('手入力のモデルは勧めず、一覧の最後に置く', () => {
    const models: ModelInfo[] = [
      { id: 'opencode-go/kimi-k9', label: 'x', source: 'custom' },
      { id: 'opencode-go/kimi-k3', label: 'x', source: 'cli' },
      { id: 'opencode-go/aaa', label: 'x', source: 'cli' }
    ]
    const { recommended, groups } = groupModels(markRecommended(models, OPENCODE_RECOMMENDED))
    expect(recommended.map((model) => model.id)).toEqual(['opencode-go/kimi-k3'])
    expect(groups.flatMap((group) => group.models.map((model) => model.id))).toEqual(['opencode-go/aaa', 'opencode-go/kimi-k9'])
  })
})
