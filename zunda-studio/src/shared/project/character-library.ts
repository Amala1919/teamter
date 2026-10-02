import { z } from 'zod'

import type { Command } from '../commands/types'
import type { AiPersona, AssetLicense, Character, PortraitConfig, Project, SubtitleStyle, VoiceConfig } from './types'

/**
 * アプリに保存したキャラクター(動画ごとではなく、アプリで使い回すキャラクター)。
 * 声・ペルソナ・字幕の見た目・立ち絵(PSD の場所と設定)・タイムラインの色・クレジットを持つ。
 * プロジェクトに足すと、プロジェクトの中にそのコピーができる(Character.libraryId で元を覚える)。
 */
export interface SavedCharacter {
  id: string
  name: string
  /** 最後に保存した日時(ISO 8601)。 */
  savedAt: string
  /** 新しいプロジェクトを作ったとき、自動で入れるか。 */
  autoAdd: boolean
  authorRole: Character['authorRole']
  persona: AiPersona | null
  voice: VoiceConfig
  creditText: string
  timelineColor?: string
  subtitleStyle: Omit<SubtitleStyle, 'id'>
  portrait: { psd: { path: string; license: AssetLicense }; config: Omit<PortraitConfig, 'assetId'> } | null
}

/** プロジェクトのキャラクターを、アプリに保存する形にする。base を渡すと、その保存先(ID・自動で入れるか)を引き継ぐ。 */
export function toSavedCharacter(
  project: Project,
  characterId: string,
  base: { id: string; autoAdd: boolean },
  now: Date
): SavedCharacter {
  const character = project.characters[characterId]
  if (!character) throw new Error(`キャラクターが見つかりません: ${characterId}`)
  const style = project.subtitleStyles[character.subtitleStyleId]
  if (!style) throw new Error('キャラクターの字幕スタイルが見つかりません')
  const { id: _styleId, ...subtitleStyle } = clone(style)
  let portrait: SavedCharacter['portrait'] = null
  if (character.portrait) {
    const asset = project.assets[character.portrait.assetId]
    if (asset?.type === 'psd') {
      const { assetId: _assetId, ...config } = clone(character.portrait)
      portrait = { psd: { path: asset.path.absolute, license: clone(asset.license) }, config }
    }
  }
  return {
    id: base.id,
    name: character.name,
    savedAt: now.toISOString(),
    autoAdd: base.autoAdd,
    authorRole: character.authorRole,
    persona: character.persona ? clone(character.persona) : null,
    voice: clone(character.voice),
    creditText: character.creditText,
    ...(character.timelineColor ? { timelineColor: character.timelineColor } : {}),
    subtitleStyle,
    portrait
  }
}

/** 保存の中身(保存日時・自動で入れるかを除く)。プロジェクトで変わったかを比べるのに使う。 */
export function savedContent(saved: SavedCharacter): string {
  const { savedAt: _savedAt, autoAdd: _autoAdd, id: _id, ...content } = saved
  return JSON.stringify(content)
}

/**
 * 保存したキャラクターをプロジェクトに足すコマンド。字幕スタイル・立ち絵の PSD も一緒に足す(同じ PSD は二重に登録しない)。
 * tempPrefix を変えれば、複数のキャラクターを1回で足せる。キャラクターの ID は `${tempPrefix}character` で受け取れる。
 */
export function addSavedCharacterCommands(saved: SavedCharacter, tempPrefix = ''): Command[] {
  const character = `${tempPrefix}character`
  const style = `${tempPrefix}style`
  const psd = `${tempPrefix}psd`
  const { engineId, speakerId, speakerName, ...params } = saved.voice
  const commands: Command[] = [
    { op: 'style.upsertSubtitle', props: clone(saved.subtitleStyle), tempId: style },
    {
      op: 'character.create',
      name: saved.name,
      authorRole: saved.authorRole === 'ai' && saved.persona ? 'ai' : 'user',
      ...(saved.persona ? { persona: clone(saved.persona) } : {}),
      engineId,
      speakerId,
      speakerName,
      subtitleStyleId: style,
      creditText: saved.creditText,
      tempId: character
    },
    {
      op: 'character.update',
      characterId: character,
      voice: params,
      libraryId: saved.id,
      ...(saved.timelineColor ? { timelineColor: saved.timelineColor } : {})
    }
  ]
  if (saved.portrait) {
    commands.splice(
      0,
      0,
      { op: 'asset.add', asset: { type: 'psd', path: { absolute: saved.portrait.psd.path, relative: null }, license: clone(saved.portrait.psd.license) }, tempId: psd }
    )
    commands.push({ op: 'character.setPortrait', characterId: character, portrait: { ...clone(saved.portrait.config), assetId: psd } })
  }
  return commands
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** アプリに保存するキャラクターの形の検証(main で、壊れたファイルや不正な値を弾く)。中身の細部はプロジェクトに足すときに確かめる。 */
export const savedCharacterSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    savedAt: z.string().max(40),
    autoAdd: z.boolean(),
    authorRole: z.enum(['user', 'ai']),
    persona: z
      .object({
        personality: z.string().max(2000),
        speechStyle: z.string().max(2000),
        banterRole: z.enum(['tsukkomi', 'boke', 'navigator', 'free']),
        forbidden: z.array(z.string().max(200)).max(200),
        targetLengthChars: z.number().int().min(1).max(1000)
      })
      .nullable(),
    voice: z
      .object({ engineId: z.string().min(1).max(100), speakerId: z.number(), speakerName: z.string().max(200) })
      .loose(),
    creditText: z.string().max(500),
    timelineColor: z.string().max(20).optional(),
    subtitleStyle: z.object({ name: z.string().max(200), fontFamily: z.string().max(200) }).loose(),
    portrait: z
      .object({
        psd: z.object({ path: z.string().min(1).max(4096), license: z.object({ source: z.string().max(2000) }).loose() }),
        config: z.object({}).loose()
      })
      .nullable()
  })
  .loose()
