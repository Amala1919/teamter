import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const DEVHOST_PORT = 5317
/** 模擬 VOICEVOX。E2E はこのエンジンに接続する。 */
export const MOCK_VOICEVOX_PORT = 50121
export const MOCK_VOICEVOX_URL = `http://127.0.0.1:${MOCK_VOICEVOX_PORT}`
/** 模擬CLIが返す AI の応答を置く場所(queue.json)。呼ばれた内容は calls.jsonl に残る。 */
// Windows では '/tmp' がそのときのドライブの直下になり、CLI の作業場所(別のドライブ)から見ると別の場所になるので、OS の一時フォルダを使う。
export const AI_RESPONSE_DIR = join(tmpdir(), 'zunda-e2e-ai-responses')
/** VOICEVOX ENGINE の配布元の模擬(自動インストールのテストで立てる)。 */
export const ENGINE_RELEASE_PORT = 50135
/** 自動インストールしたエンジンが待ち受けるポート。 */
export const INSTALLED_ENGINE_PORT = 50141
/** Wikimedia Commons の模擬(解説の参考画像)。 */
export const MOCK_COMMONS_PORT = 50151
