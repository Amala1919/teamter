// OpenCode Go / Zen の API の模擬。モデルごとに受け付ける形式を変えて、形式の切り替えを確かめられるようにする。
import { createServer } from 'node:http'

export const GOOD_KEY = 'sk-test-good-key-1234'

/** モデル名 → 受け付ける形式。 */
const MODELS = {
  'kimi-k3': 'chat',
  'kimi-k2.7-code': 'chat',
  'glm-5.3': 'chat',
  'glm-5.2': 'chat',
  'deepseek-v4-pro': 'chat',
  'deepseek-v4-flash': 'chat',
  'qwen3.8-max': 'messages',
  'minimax-m3': 'messages',
  'gpt-6-luna': 'responses',
  'gemini-3.8-flash': 'gemini',
  // 名前からは形式が分からないモデル(chat と見当をつけて外れる)
  'odd-model': 'responses',
  // 上限に達したふりをする
  'limited-model': 'chat',
  // 残高が無いアカウントで Zen のモデルを呼んだふり(本物も 401 で返す)
  'balance-model': 'chat',
  // データ利用への同意が要るモデル(本物は 403)
  'consent-model': 'chat',
  // 形式違いを 401 の ModelError で断るモデル
  'strict-model': 'responses',
  // 無料枠のアカウントを API から使ったふり(本物の文そのまま)
  'free-tier-model': 'chat'
}

/** 本物の OpenCode と同じ形のエラー。 */
function gatewayError(type, message) {
  return { type: 'error', error: { type, message } }
}

const PATHS = { '/chat/completions': 'chat', '/messages': 'messages', '/responses': 'responses' }

/** Gemini 形式は /models/<名前>:generateContent に送られる。 */
function geminiModel(path) {
  const match = /^\/models\/([^/:]+):generateContent$/.exec(path)
  return match ? decodeURIComponent(match[1]) : null
}

function reply(format, text) {
  if (format === 'chat') return { choices: [{ message: { role: 'assistant', content: text } }] }
  if (format === 'messages') return { content: [{ type: 'text', text }] }
  if (format === 'gemini') return { candidates: [{ content: { role: 'model', parts: [{ text: '考え中', thought: true }, { text }] } }] }
  return { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
}

/** 返答の中身。system に JSON スキーマの指示があれば、FAKE_JSON を返す。 */
function answer(body, format) {
  if (format === 'gemini') {
    const last = body.contents?.at(-1)?.parts?.[0]?.text ?? ''
    return last.includes('接続できたのだ') ? '接続できたのだ' : `(${body.model} が gemini で答えました)`
  }
  const system = format === 'chat' ? body.messages?.[0]?.content : format === 'messages' ? body.system : body.instructions
  const turns = format === 'chat' ? body.messages.slice(1) : format === 'messages' ? body.messages : body.input
  const last = turns?.at(-1)?.content ?? ''
  if (typeof system === 'string' && system.includes('JSONスキーマ') && process.env.FAKE_OPENCODE_JSON) {
    return process.env.FAKE_OPENCODE_JSON
  }
  if (last.includes('接続できたのだ')) return '接続できたのだ'
  return `(${body.model} が ${format} で答えました)`
}

export async function startMockOpenCodeApi({ port = 0, basePath = '/zen/go/v1' } = {}) {
  const calls = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => (raw += chunk))
    request.on('end', () => {
      const send = (status, body) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(body))
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (!url.pathname.startsWith(basePath)) return send(404, { error: 'not found' })
      const path = url.pathname.slice(basePath.length)
      // 本物と同じく、形式ごとに決まったヘッダーからだけキーを読む。
      const key = path.endsWith('/messages')
        ? request.headers['x-api-key']
        : geminiModel(path)
          ? request.headers['x-goog-api-key']
          : (request.headers.authorization ?? '').split(' ')[1]
      if (!key) return send(401, gatewayError('AuthError', 'APIキーがありません。'))
      if (key !== GOOD_KEY) return send(401, gatewayError('AuthError', '無効なAPIキーです。'))

      if (request.method === 'GET' && path === '/models') {
        return send(200, { object: 'list', data: Object.keys(MODELS).map((id) => ({ id, object: 'model' })) })
      }
      const gemini = geminiModel(path)
      const format = gemini ? 'gemini' : PATHS[path]
      if (request.method !== 'POST' || !format) return send(404, { error: 'not found' })
      const body = JSON.parse(raw || '{}')
      if (gemini) body.model = gemini
      calls.push({ path, model: body.model, body, headers: request.headers })
      const accepts = MODELS[body.model]
      if (!accepts) return send(400, { error: { message: `Model ${body.model} not found` } })
      if (body.model === 'limited-model') return send(429, { error: { message: 'rate limit exceeded' } })
      if (body.model === 'balance-model') {
        return send(401, gatewayError('CreditsError', '残高が不足しています。こちらから請求を管理してください: https://opencode.ai/workspace/billing'))
      }
      if (body.model === 'consent-model') {
        return send(403, gatewayError('DataPolicyError', 'このモデルは品質向上のためのデータを収集します。利用するには明示的な同意が必要です'))
      }
      if (body.model === 'free-tier-model') {
        return send(401, gatewayError('FreeTierError', "OpenCode's free tier can only be used from within OpenCode"))
      }
      if (body.model === 'strict-model' && accepts !== format) {
        return send(401, gatewayError('ModelError', `フォーマット ${format} ではモデル strict-model はサポートされていません`))
      }
      if (accepts !== format) return send(404, { error: { message: `Endpoint is unavailable for ${body.model}` } })
      return send(200, reply(format, answer(body, format)))
    })
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  return {
    baseUrl: `http://127.0.0.1:${address.port}${basePath}`,
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
