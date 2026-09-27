import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { AutosaveEntry } from '@shared/ipc/contract'
import type { Project } from '@shared/project/types'

import { AppError } from '../../core/errors'
import { writeFileAtomic } from '../../core/fs'
import { migrateProject } from './store'

const KEY_PATTERN = /^[A-Za-z0-9_-]{6,40}$/

/**
 * 自動保存とクラッシュ後の復元(REQUIREMENTS.md T-5)。
 * 編集中のプロジェクトを、利用者が保存するまで一定間隔でアプリのデータ置き場に写しておく。
 * 保存したら消すので、起動時に残っていれば「保存されなかった変更」がある。
 */
export class AutosaveService {
  constructor(private readonly directory: string) {}

  async write(key: string, filePath: string | null, project: Project): Promise<void> {
    this.check(key)
    await mkdir(this.directory, { recursive: true })
    const entry: AutosaveEntry = { key, filePath, title: project.meta.title, savedAt: new Date().toISOString() }
    await writeFileAtomic(join(this.directory, `${key}.zsproj`), JSON.stringify(project))
    await writeFileAtomic(join(this.directory, `${key}.json`), JSON.stringify(entry))
  }

  async list(): Promise<AutosaveEntry[]> {
    let files: string[]
    try {
      files = await readdir(this.directory)
    } catch {
      return []
    }
    const entries: AutosaveEntry[] = []
    for (const file of files.filter((name) => name.endsWith('.json'))) {
      try {
        const entry = JSON.parse(await readFile(join(this.directory, file), 'utf8')) as AutosaveEntry
        if (KEY_PATTERN.test(entry.key)) entries.push(entry)
      } catch {
        // 壊れた記録は無視する(本体が読めなければ復元できないので出さない)。
      }
    }
    return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  async read(key: string): Promise<Project> {
    this.check(key)
    try {
      return migrateProject(JSON.parse(await readFile(join(this.directory, `${key}.zsproj`), 'utf8')))
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('NOT_FOUND', '自動保存したデータを読めませんでした')
    }
  }

  async clear(key: string): Promise<void> {
    this.check(key)
    await rm(join(this.directory, `${key}.zsproj`), { force: true })
    await rm(join(this.directory, `${key}.json`), { force: true })
  }

  private check(key: string): void {
    if (!KEY_PATTERN.test(key)) throw new AppError('INVALID_ARGUMENT', `自動保存のキーが不正です: ${key}`)
  }
}
