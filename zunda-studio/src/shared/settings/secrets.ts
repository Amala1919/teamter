/** アプリが預かる秘密の値の種類。値そのものは main から出さない。 */
export const SECRET_NAMES = ['opencode.apiKey'] as const
export type SecretName = (typeof SECRET_NAMES)[number]

export interface SecretStatus {
  name: SecretName
  set: boolean
  /** 入れたキーを見分けるための末尾数文字(例: …a1b2)。 */
  hint: string | null
  /** OS の鍵保管庫で暗号化しているか。 */
  secure: boolean
}

/**
 * 貼り付けたキーを整える。全角の英数字・前後の空白と改行・見えない文字、囲みの引用符、「Bearer 」の前置き、
 * 「OPENCODE_API_KEY=」のような代入の形を取り除く。
 */
export function normalizeApiKey(value: string): string {
  // キーは半角英数字なので、全角で入ってしまった文字は半角に直す(NFKC)。
  let key = value.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim()
  key = key.replace(/^(export\s+)?[A-Z_]*API_KEY\s*=\s*/i, '').trim()
  key = key.replace(/^bearer\s+/i, '').trim()
  const quoted = /^(["'`「『])(.*)(["'`」』])$/.exec(key)
  if (quoted) key = quoted[2]!.trim()
  return key
}
