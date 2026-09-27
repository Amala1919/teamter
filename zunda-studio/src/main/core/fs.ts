import { randomBytes } from 'node:crypto'
import { access, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * 書き込み中のクラッシュで既存ファイルを壊さないよう、一時ファイルへ書いてから rename する。
 * rename は同一ファイルシステム内で原子的なので、一時ファイルは保存先と同じディレクトリに置く。
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const temporaryPath = join(dirname(path), `.${randomBytes(6).toString('hex')}.tmp`)
  await writeFile(temporaryPath, data)
  await rename(temporaryPath, path)
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
