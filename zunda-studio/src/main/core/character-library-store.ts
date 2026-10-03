import { readFile } from 'node:fs/promises'

import { savedCharacterSchema, type SavedCharacter } from '@shared/project/character-library'

import { AppError } from './errors'
import { writeFileAtomic } from './fs'

/** 保存しておけるキャラクターの数の上限。 */
const MAX_CHARACTERS = 200

/**
 * アプリに保存したキャラクター(動画ごとではなく、アプリで使い回すもの)。userData/characters.json に置く。
 * 立ち絵の PSD は、保存したキャラクターを新しいプロジェクトに足したときに読めるよう、onPsd で読み込みを許可する。
 */
export class CharacterLibraryStore {
  private entries: SavedCharacter[] = []
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly onPsd: (path: string) => void
  ) {}

  async load(): Promise<SavedCharacter[]> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as { characters?: unknown }
      const list = Array.isArray(raw.characters) ? raw.characters : []
      // 壊れた項目だけ飛ばす(ほかのキャラクターは残す)。
      this.entries = list.flatMap((entry) => {
        const parsed = savedCharacterSchema.safeParse(entry)
        return parsed.success ? [parsed.data as unknown as SavedCharacter] : []
      })
    } catch {
      this.entries = []
    }
    for (const entry of this.entries) this.allow(entry)
    return this.list()
  }

  list(): SavedCharacter[] {
    return structuredClone(this.entries)
  }

  /** 保存する。同じ ID があれば置き換え、無ければ最後に足す。 */
  async save(entry: SavedCharacter): Promise<SavedCharacter[]> {
    const parsed = savedCharacterSchema.safeParse(entry)
    if (!parsed.success) throw new AppError('INVALID_ARGUMENT', 'アプリに保存するキャラクターの形が不正です')
    const value = parsed.data as unknown as SavedCharacter
    const index = this.entries.findIndex((candidate) => candidate.id === value.id)
    if (index >= 0) this.entries[index] = value
    else {
      if (this.entries.length >= MAX_CHARACTERS) throw new AppError('INVALID_ARGUMENT', `アプリに保存できるキャラクターは${MAX_CHARACTERS}人までです`)
      this.entries.push(value)
    }
    this.allow(value)
    await this.persist()
    return this.list()
  }

  async remove(id: string): Promise<SavedCharacter[]> {
    this.entries = this.entries.filter((entry) => entry.id !== id)
    await this.persist()
    return this.list()
  }

  private allow(entry: SavedCharacter): void {
    if (entry.portrait) this.onPsd(entry.portrait.psd.path)
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify({ version: 1, characters: this.entries }, null, 2)
    // 連続した保存で書き込み順が入れ替わらないよう直列化する。
    this.writeChain = this.writeChain.then(() => writeFileAtomic(this.file, snapshot))
    await this.writeChain
  }
}
