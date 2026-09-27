import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { migrateProject, readProject, writeProject } from '@main/project/store'
import { createEmptyProject } from '@shared/project/factory'
import { PROJECT_FORMAT_VERSION } from '@shared/project/types'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'zunda-studio-test-'))
})

describe('writeProject / readProject', () => {
  it('保存して読み直すと同じ内容になる', async () => {
    const project = createEmptyProject({ title: 'テスト', renderSeed: 42 })
    const path = join(directory, 'test.zsproj')

    await writeProject(path, project)
    const loaded = await readProject(path)

    expect(loaded).toEqual(project)
  })

  it('一時ファイルを残さない', async () => {
    const path = join(directory, 'test.zsproj')
    await writeProject(path, createEmptyProject())
    expect(await readdir(directory)).toEqual(['test.zsproj'])
  })

  it('既存ファイルを上書きできる', async () => {
    const path = join(directory, 'test.zsproj')
    await writeProject(path, createEmptyProject({ title: 'ひとつめ' }))
    await writeProject(path, createEmptyProject({ title: 'ふたつめ' }))
    expect((await readProject(path)).meta.title).toBe('ふたつめ')
  })
})

describe('migrateProject', () => {
  it('現在のバージョンはそのまま通す', () => {
    const project = createEmptyProject()
    expect(migrateProject(project).formatVersion).toBe(PROJECT_FORMAT_VERSION)
  })

  it('バージョンが無いファイルを拒否する', () => {
    expect(() => migrateProject({ meta: {} })).toThrow(/フォーマットバージョン/)
  })

  it('未来のバージョンを拒否する', () => {
    expect(() => migrateProject({ formatVersion: PROJECT_FORMAT_VERSION + 1 })).toThrow(
      /新しいバージョン/
    )
  })

  it('JSONでないファイルを拒否する', async () => {
    const path = join(directory, 'broken.zsproj')
    await writeFile(path, 'これはJSONではない', 'utf8')
    await expect(readProject(path)).rejects.toThrow()
  })
})
