import { randomBytes } from 'node:crypto'
import { rename, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { PROJECT_FORMAT_VERSION, type Project } from '@shared/project/types'

export const PROJECT_FILE_EXTENSION = 'zsproj'

/**
 * 書き込み中のクラッシュで既存ファイルを壊さないよう、一時ファイルへ書いてから rename する。
 * rename は同一ファイルシステム内で原子的なので、一時ファイルは保存先と同じディレクトリに置く。
 */
export async function writeProject(path: string, project: Project): Promise<void> {
  const payload = JSON.stringify({ ...project, formatVersion: PROJECT_FORMAT_VERSION }, null, 2)
  const temporaryPath = join(dirname(path), `.${randomBytes(6).toString('hex')}.tmp`)
  await writeFile(temporaryPath, payload, 'utf8')
  await rename(temporaryPath, path)
}

export async function readProject(path: string): Promise<Project> {
  const raw = await readFile(path, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  return migrateProject(parsed)
}

/**
 * 読み込んだデータを現在のフォーマットへ移行する。
 * 移行関数は一度書いたら変更しない(docs/PROJECT_FORMAT.md の 10章)。
 */
export function migrateProject(raw: unknown): Project {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('プロジェクトファイルの形式が不正です')
  }
  const version = (raw as { formatVersion?: unknown }).formatVersion
  if (typeof version !== 'number') {
    throw new Error('プロジェクトファイルにフォーマットバージョンがありません')
  }
  if (version > PROJECT_FORMAT_VERSION) {
    throw new Error(
      `このプロジェクトは新しいバージョン(${version})で作られています。アプリを更新してください`
    )
  }
  // 現時点ではバージョン1のみ。以降のバージョンを追加するときはここに移行処理を並べる。
  return raw as Project
}
