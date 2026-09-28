/**
 * プロセス境界を越えて伝えるエラーの分類。
 * レンダラはコードを見て、利用者が次に何をすればよいかを表示する(AI-7)。
 */
export const ERROR_CODES = [
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'ACCESS_DENIED',
  'CANCELLED',
  'CLI_NOT_FOUND',
  'CLI_FAILED',
  'AI_NOT_CONFIGURED',
  'AI_NOT_LOGGED_IN',
  'AI_RATE_LIMITED',
  /** APIキーが無い・正しくない。 */
  'AI_KEY_REQUIRED',
  /** キーは通ったが、選んだモデルが今の契約・設定では使えない(残高不足・プラン外・同意が必要など)。 */
  'AI_MODEL_UNAVAILABLE',
  /** キーのアカウントが無料枠扱い。無料枠は OpenCode 本体の中からしか使えない。 */
  'AI_SUBSCRIPTION_REQUIRED',
  'AI_OUTPUT_INVALID',
  'ENGINE_UNAVAILABLE',
  'ENGINE_FAILED',
  'FFMPEG_NOT_FOUND',
  'FFMPEG_FAILED',
  'PSD_UNSUPPORTED',
  'OBS_UNAVAILABLE',
  'STT_UNAVAILABLE',
  'INTERNAL'
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface AppErrorShape {
  code: ErrorCode
  message: string
  /** 技術的な詳細(CLIの標準エラー出力など)。画面では折りたたんで表示する。 */
  detail?: string
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
}

/** エラーコードごとの対処の案内。message はその場の状況、これは次の一手を示す。 */
export const ERROR_GUIDANCE: Record<ErrorCode, string> = {
  INVALID_ARGUMENT: '入力内容を確認してください。',
  NOT_FOUND: 'ファイルが移動・削除されていないか確認してください。',
  ACCESS_DENIED: 'プロジェクトに登録されていないファイルにはアクセスできません。',
  CANCELLED: '',
  CLI_NOT_FOUND:
    'CLIがインストールされているか確認してください。設定画面で実行ファイルの場所を指定することもできます。',
  CLI_FAILED: 'CLIの出力を確認してください。CLIを単体で起動して動作するか試すと原因が分かることがあります。',
  AI_NOT_CONFIGURED: '設定画面の「AI」で、この役割に使うAIを選んでください。',
  AI_NOT_LOGGED_IN:
    'ターミナルでCLIを起動してログインしてください(Claude Code は claude で /login、OpenCode は opencode auth login)。',
  AI_RATE_LIMITED: '利用上限に達しています。時間をおくか、設定で別のモデルを選んでください。',
  AI_KEY_REQUIRED: '設定画面の「AI」→ OpenCode に API キーを入力してください。キーは OpenCode のサイト(opencode.ai)の管理画面で発行できます。',
  AI_MODEL_UNAVAILABLE:
    '別のモデルを選ぶか、OpenCode のサイト(opencode.ai)の管理画面で契約・残高・モデルの設定を確認してください。',
  AI_SUBSCRIPTION_REQUIRED:
    'API キーで使うには、キーを発行したワークスペースで OpenCode Go を契約するか、Zen に残高を入れてください。契約せずに無料枠で使うなら、設定の「接続のしかた」を「opencode コマンドを使う」にしてください。',
  AI_OUTPUT_INVALID: 'AIの応答を解釈できませんでした。もう一度試すか、別のモデルを選んでください。',
  ENGINE_UNAVAILABLE:
    'VOICEVOXエンジンに接続できません。設定画面でエンジンの場所を指定するか、VOICEVOXを起動してください。',
  ENGINE_FAILED: '音声合成に失敗しました。読めない文字が含まれていないか確認してください。',
  FFMPEG_NOT_FOUND: 'ffmpeg が見つかりません。設定画面で ffmpeg の場所を指定してください。',
  FFMPEG_FAILED: '動画処理に失敗しました。素材ファイルが壊れていないか確認してください。',
  PSD_UNSUPPORTED: 'このPSDの構造には対応していません。レイヤーを統合したPSDで試してください。',
  OBS_UNAVAILABLE:
    'OBSに接続できません。OBSの「ツール → WebSocketサーバー設定」で有効化し、ポートとパスワードを設定画面に入力してください。',
  STT_UNAVAILABLE: '音声入力に必要な文字起こしの設定がありません。設定画面で whisper の場所とモデルを指定してください。',
  INTERNAL: '予期しないエラーです。操作をやり直してください。'
}
