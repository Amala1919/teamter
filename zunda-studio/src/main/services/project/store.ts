import { readFile } from 'node:fs/promises'

import { migratePortraitTracks } from '@shared/portrait/tracks'
import { createEmptyProject } from '@shared/project/factory'
import { PROJECT_FORMAT_VERSION, type Project } from '@shared/project/types'

import { writeFileAtomic } from '../../core/fs'

export const PROJECT_FILE_EXTENSION = 'zsproj'

export async function writeProject(path: string, project: Project): Promise<void> {
  const payload = JSON.stringify({ ...project, formatVersion: PROJECT_FORMAT_VERSION }, null, 2)
  await writeFileAtomic(path, payload)
}

export async function readProject(path: string): Promise<Project> {
  const raw = await readFile(path, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  return migrateProject(parsed)
}

/**
 * 読み込んだデータを現在のフォーマットへ移行する。
 * 移行関数は一度書いたら変更しない(docs/PROJECT_FORMAT.md の バージョニング)。
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
  // 以前は表示の区間を置かずに立ち絵を動画全体で出していた。同じ見た目になる区間を足す(何度読んでも同じ結果)。
  return migratePortraitTracks(fillMissingContainers(raw as Partial<Project>))
}

/**
 * 同じバージョン内で後から足した入れ物が無いファイルを補う。
 * 入れ物(空のオブジェクトや配列)に限り、既存のデータの意味は変えない。
 */
function fillMissingContainers(raw: Partial<Project>): Project {
  const empty = createEmptyProject({ renderSeed: raw.meta?.renderSeed ?? 0 })
  return {
    ...empty,
    ...raw,
    liveSessions: raw.liveSessions ?? {},
    chat: raw.chat ?? empty.chat,
    ai: raw.ai ?? empty.ai,
    editing: { ...empty.editing, ...raw.editing },
    credits: raw.credits ?? empty.credits,
    subtitleStyles: raw.subtitleStyles ?? empty.subtitleStyles
  } as Project
}
