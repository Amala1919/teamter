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
