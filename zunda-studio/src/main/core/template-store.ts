import { readFile } from 'node:fs/promises'

import { projectTemplateSchema, type ProjectTemplate } from '@shared/project/templates'

import { AppError } from './errors'
import { writeFileAtomic } from './fs'

/** 保存しておけるひな形の数の上限。 */
const MAX_TEMPLATES = 100

/**
 * アプリに保存したひな形(オープニング・エンディングなど)。userData/templates.json に置く。
 * ひな形で使う素材は、どのプロジェクトに入れても読めるよう onAsset で読み込みを許可する。
 */
export class TemplateStore {
  private entries: ProjectTemplate[] = []
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly onAsset: (path: string) => void
  ) {}

  async load(): Promise<ProjectTemplate[]> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as { templates?: unknown }
      const list = Array.isArray(raw.templates) ? raw.templates : []
      // 壊れた項目だけ飛ばす(ほかのひな形は残す)。
      this.entries = list.flatMap((entry) => {
        const parsed = projectTemplateSchema.safeParse(entry)
        return parsed.success ? [parsed.data as unknown as ProjectTemplate] : []
      })
    } catch {
      this.entries = []
    }
    for (const entry of this.entries) this.allow(entry)
    return this.list()
  }

  list(): ProjectTemplate[] {
    return structuredClone(this.entries)
  }

  /** 保存する。同じ ID があれば置き換え、無ければ最後に足す。 */
  async save(entry: ProjectTemplate): Promise<ProjectTemplate[]> {
    const parsed = projectTemplateSchema.safeParse(entry)
    if (!parsed.success) throw new AppError('INVALID_ARGUMENT', 'ひな形の形が不正です')
    const value = parsed.data as unknown as ProjectTemplate
    const index = this.entries.findIndex((candidate) => candidate.id === value.id)
    if (index >= 0) this.entries[index] = value
    else {
      if (this.entries.length >= MAX_TEMPLATES) throw new AppError('INVALID_ARGUMENT', `保存できるひな形は${MAX_TEMPLATES}個までです`)
      this.entries.push(value)
    }
    this.allow(value)
    await this.persist()
    return this.list()
  }

  async remove(id: string): Promise<ProjectTemplate[]> {
    this.entries = this.entries.filter((entry) => entry.id !== id)
    await this.persist()
    return this.list()
  }

  private allow(entry: ProjectTemplate): void {
    for (const asset of Object.values(entry.assets)) {
      const path = (asset as { path?: { absolute?: unknown } }).path?.absolute
      if (typeof path === 'string') this.onAsset(path)
    }
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify({ version: 1, templates: this.entries }, null, 2)
    // 連続した保存で書き込み順が入れ替わらないよう直列化する。
    this.writeChain = this.writeChain.then(() => writeFileAtomic(this.file, snapshot))
    await this.writeChain
  }
}
