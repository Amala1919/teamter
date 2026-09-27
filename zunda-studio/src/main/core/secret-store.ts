import { readFile } from 'node:fs/promises'

import { SECRET_NAMES, type SecretName, type SecretStatus } from '@shared/settings/secrets'

import { AppError } from './errors'
import { writeFileAtomic } from './fs'

/**
 * APIキーなどの秘密の値を暗号化して保持する。
 * 設定ファイル(settings.json)には書かず、レンダラにも値そのものは返さない(末尾の数文字だけ見せる)。
 */
export interface SecretCipher {
  /** OS の鍵保管庫で守られているか。false なら画面で注意を出す。 */
  readonly secure: boolean
  encrypt: (plain: string) => string
  decrypt: (sealed: string) => string
}

/** 暗号化の仕組みが無い環境(テスト用ホスト)向け。値は base64 にするだけ。 */
export const PLAIN_CIPHER: SecretCipher = {
  secure: false,
  encrypt: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
  decrypt: (sealed) => Buffer.from(sealed, 'base64').toString('utf8')
}

interface SecretFile {
  version: 1
  values: Partial<Record<SecretName, string>>
}

const MAX_SECRET_LENGTH = 1000

export class SecretStore {
  private sealed: Partial<Record<SecretName, string>> = {}
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly cipher: SecretCipher
  ) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<SecretFile>
      const values = parsed.values ?? {}
      this.sealed = {}
      for (const name of SECRET_NAMES) {
        const value = values[name]
        if (typeof value === 'string') this.sealed[name] = value
      }
    } catch {
      this.sealed = {}
    }
  }

  get(name: SecretName): string | null {
    const sealed = this.sealed[name]
    if (sealed === undefined) return null
    try {
      return this.cipher.decrypt(sealed)
    } catch {
      // 別の PC から持ってきた等で復号できないときは、無いものとして扱う(入れ直してもらう)。
      return null
    }
  }

  async set(name: SecretName, value: string | null): Promise<SecretStatus> {
    const trimmed = value?.trim() ?? ''
    if (trimmed.length > MAX_SECRET_LENGTH || /[\r\n]/.test(trimmed)) {
      throw new AppError('INVALID_ARGUMENT', 'キーの形式が正しくありません')
    }
    if (trimmed === '') delete this.sealed[name]
    else this.sealed[name] = this.cipher.encrypt(trimmed)
    const snapshot = JSON.stringify({ version: 1, values: this.sealed } satisfies SecretFile, null, 2)
    this.writeChain = this.writeChain.then(() => writeFileAtomic(this.file, snapshot))
    await this.writeChain
    return this.status(name)
  }

  status(name: SecretName): SecretStatus {
    const value = this.get(name)
    return {
      name,
      set: value !== null,
      hint: value === null ? null : `…${value.slice(-4)}`,
      secure: this.cipher.secure
    }
  }

  statuses(): SecretStatus[] {
    return SECRET_NAMES.map((name) => this.status(name))
  }
}
