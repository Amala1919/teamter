export const DEVHOST_PORT = 5317
/** 模擬 VOICEVOX。E2E はこのエンジンに接続する。 */
export const MOCK_VOICEVOX_PORT = 50121
export const MOCK_VOICEVOX_URL = `http://127.0.0.1:${MOCK_VOICEVOX_PORT}`
/** 模擬CLIが返す AI の応答を置く場所(queue.json)。呼ばれた内容は calls.jsonl に残る。 */
export const AI_RESPONSE_DIR = '/tmp/zunda-e2e-ai-responses'
/** VOICEVOX ENGINE の配布元の模擬(自動インストールのテストで立てる)。 */
export const ENGINE_RELEASE_PORT = 50135
/** 自動インストールしたエンジンが待ち受けるポート。 */
export const INSTALLED_ENGINE_PORT = 50141
