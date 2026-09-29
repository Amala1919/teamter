import { describe, expect, it } from 'vitest'

import { applyCommands, type CommandContext } from '@shared/commands/apply'
import { CommandError, type Command } from '@shared/commands/types'
import { createEmptyProject, DEFAULT_LAYER_IDS } from '@shared/project/factory'
import { effectiveVoice, voiceItemsInOrder } from '@shared/project/queries'
import type { AudioItem, Project, SynthesisResult, VoiceItem } from '@shared/project/types'

function context(): CommandContext {
  let counter = 0
  return { newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }
}

const ctx = context()
function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, ctx).project
}

function synthesis(durationMs: number): SynthesisResult {
  return { cacheKey: 'k'.repeat(64), audioDurationMs: durationMs, lipSync: [], accentPhrases: [] }
}

/** セリフ3行(各1000ms、間200ms)と、2行目の途中から鳴るBGM を持つプロジェクト。 */
function script(): { project: Project; ids: string[]; characterId: string } {
  let project = apply(createEmptyProject({ renderSeed: 1 }), [
    { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん' }
  ])
  const characterId = Object.keys(project.characters)[0]!
  // 1行ずつ足して合成し(各 1000ms)、次の行をその後ろ(間 200ms)に足す
  let previous: string | null = null
  for (const text of ['いちぎょうめ', 'にぎょうめ', 'さんぎょうめ']) {
    const result = applyCommands(
      project,
      [previous === null ? { op: 'voice.insert', characterId, text, atMs: 0, tempId: 't' } : { op: 'voice.insert', characterId, text, afterItemId: previous, tempId: 't' }],
      ctx
    )
    const id = result.resolvedIds['t']!
    project = apply(result.project, [{ op: 'voice.applySynthesis', itemId: id, expectedText: text, synthesis: synthesis(1000) }])
    previous = id
  }
  const bgm: AudioItem = {
    id: 'bgm',
    type: 'audio',
    layerId: DEFAULT_LAYER_IDS.bgm,
    startMs: 1500,
    durationMs: 10_000,
    effects: [],
    locked: false,
    assetId: 'ast',
    inMs: 0,
    outMs: 10_000,
    volume: 0.3,
    loop: false,
    fadeInMs: 0,
    fadeOutMs: 0,
    duckable: true
  }
  project = { ...project, items: [...project.items, bgm] }
  return { project, ids: voiceItemsInOrder(project).map((line) => line.id), characterId }
}

const starts = (project: Project): number[] => voiceItemsInOrder(project).map((line) => line.startMs)
const texts = (project: Project): string[] => voiceItemsInOrder(project).map((line) => line.text)

describe('セリフの並びとリップル編集', () => {
  it('合成結果の尺に合わせて、後ろのセリフが同じ間を保ってずれる', () => {
    const { project } = script()
    expect(starts(project)).toEqual([0, 1200, 2400])
  })

  it('途中に挿入すると、後ろのアイテムが挿入した分だけずれる', () => {
    const { project, ids, characterId } = script()
    const next = apply(project, [{ op: 'voice.insert', characterId, text: 'わりこみ', afterItemId: ids[0]! }])
    expect(texts(next)).toEqual(['いちぎょうめ', 'わりこみ', 'にぎょうめ', 'さんぎょうめ'])
    const inserted = voiceItemsInOrder(next)[1]!
    expect(inserted.startMs).toBe(1200)
    expect(starts(next)[2]).toBe(1200 + inserted.durationMs + 200)
  })

  it('削除すると後ろを前に詰め、同じ間を保つ', () => {
    const { project, ids } = script()
    const next = apply(project, [{ op: 'voice.delete', itemId: ids[1]! }])
    expect(texts(next)).toEqual(['いちぎょうめ', 'さんぎょうめ'])
    expect(starts(next)).toEqual([0, 1200])
  })

  it('並べ替えると、元の場所を詰めて新しい場所を空ける', () => {
    const { project, ids } = script()
    const toTop = apply(project, [{ op: 'voice.move', itemId: ids[2]!, afterItemId: null }])
    expect(texts(toTop)).toEqual(['さんぎょうめ', 'いちぎょうめ', 'にぎょうめ'])
    expect(starts(toTop)).toEqual([0, 1200, 2400])

    const toMiddle = apply(project, [{ op: 'voice.move', itemId: ids[0]!, afterItemId: ids[1]! }])
    expect(texts(toMiddle)).toEqual(['にぎょうめ', 'いちぎょうめ', 'さんぎょうめ'])
    expect(starts(toMiddle)).toEqual([0, 1200, 2400])
  })

  it('間を変えると、それ以降が全てずれる', () => {
    const { project, ids } = script()
    const next = apply(project, [{ op: 'voice.setGapAfter', itemId: ids[0]!, gapMs: 700 }])
    expect(starts(next)).toEqual([0, 1700, 2900])
  })

  it('セリフを書き換えて尺が変わっても、ほかのセリフも素材も動かさない(素材は独立)', () => {
    const { project, ids } = script()
    const edited = apply(project, [{ op: 'voice.setText', itemId: ids[1]!, text: 'ながくなったにぎょうめ' }])
    const next = apply(edited, [{ op: 'voice.applySynthesis', itemId: ids[1]!, expectedText: 'ながくなったにぎょうめ', synthesis: synthesis(1600) }])
    expect(starts(next)).toEqual([0, 1200, 2400])
    expect(next.items.find((item) => item.id === 'bgm')!.startMs).toBe(1500)
    // 重なっても、書き換えたセリフは置いたレイヤーのまま(別のレイヤーへ飛ばさない)
    expect(new Set(voiceItemsInOrder(next).map((line) => line.layerId)).size).toBe(1)
  })

  it('足したばかりのセリフの最初の合成でも、後ろのセリフは動かさない', () => {
    const { project, characterId } = script()
    const added = apply(project, [{ op: 'voice.insert', characterId, text: 'あいだ', atMs: 10_000, tempId: 'n' }])
    const line = added.items.find((item) => item.type === 'voice' && item.startMs === 10_000)!
    const later = apply(added, [{ op: 'voice.insert', characterId, text: 'うしろ', atMs: 12_000 }])
    const next = apply(later, [{ op: 'voice.applySynthesis', itemId: line.id, expectedText: 'あいだ', synthesis: synthesis(5000) }])
    expect(next.items.find((item) => item.type === 'voice' && item.startMs === 12_000)).toBeDefined()
    expect(starts(next).slice(0, 3)).toEqual(starts(project))
  })

  it('グループにしたものは、グループのセリフの尺が変わると後ろのものだけ合わせてずれる', () => {
    const { project, ids } = script()
    const grouped = apply(project, [{ op: 'item.group', itemIds: [ids[0]!, ids[1]!, 'bgm'] }])
    const edited = apply(grouped, [{ op: 'voice.setText', itemId: ids[0]!, text: 'のびた' }])
    const next = apply(edited, [{ op: 'voice.applySynthesis', itemId: ids[0]!, expectedText: 'のびた', synthesis: synthesis(1500) }])
    // 同じグループの2行目と BGM は +500、グループ外の3行目は動かない
    expect(starts(next)).toEqual([0, 1700, 2400])
    expect(next.items.find((item) => item.id === 'bgm')!.startMs).toBe(2000)
  })

  it('追従を切ると、尺が変わっても後ろは動かない', () => {
    const { project, ids } = script()
    const next = apply(project, [
      { op: 'project.setEditing', rippleOnVoiceChange: false },
      { op: 'voice.setText', itemId: ids[0]!, text: 'かわった' },
      { op: 'voice.applySynthesis', itemId: ids[0]!, expectedText: 'かわった', synthesis: synthesis(500) }
    ])
    expect(starts(next)).toEqual([0, 1200, 2400])
  })

  it('合成中に書き換えられたセリフには、古い合成結果を反映しない', () => {
    const { project, ids } = script()
    const edited = apply(project, [{ op: 'voice.setText', itemId: ids[0]!, text: '新しいほう' }])
    expect(() =>
      apply(edited, [{ op: 'voice.applySynthesis', itemId: ids[0]!, expectedText: '古いほう', synthesis: synthesis(3000) }])
    ).toThrow(CommandError)
  })

  it('ロックしたアイテムは追従で動かさない', () => {
    const { project, ids } = script()
    const locked = {
      ...project,
      items: project.items.map((item) => (item.id === ids[2] ? { ...item, locked: true } : item))
    }
    const next = apply(locked, [{ op: 'voice.delete', itemId: ids[1]! }])
    expect(voiceItemsInOrder(next).map((line) => line.startMs)).toEqual([0, 2400])
  })
})

describe('声の設定', () => {
  it('アイテムごとの上書きはキャラクターの既定値に重なり、null で外せる', () => {
    const { project, ids } = script()
    const next = apply(project, [{ op: 'voice.setVoiceParams', itemId: ids[0]!, params: { speedScale: 1.3 } }])
    const line = voiceItemsInOrder(next)[0]!
    expect(line.synthesis).toBeNull()
    expect(effectiveVoice(next, line)!.params.speedScale).toBe(1.3)
    expect(effectiveVoice(next, line)!.params.pitchScale).toBe(0)

    const cleared = apply(next, [{ op: 'voice.setVoiceParams', itemId: ids[0]!, params: { speedScale: null } }])
    expect(voiceItemsInOrder(cleared)[0]!.voiceOverride).toBeNull()
  })

  it('範囲外の値は拒否する', () => {
    const { project, ids } = script()
    expect(() =>
      apply(project, [{ op: 'voice.setVoiceParams', itemId: ids[0]!, params: { speedScale: 9 } }])
    ).toThrow(/0.5 〜 2/)
  })

  it('キャラクターの声を変えると、そのキャラクターのセリフを合成し直す対象にする', () => {
    const { project, characterId } = script()
    const next = apply(project, [{ op: 'character.update', characterId, voice: { speakerId: 1, speakerName: 'あまあま' } }])
    expect(voiceItemsInOrder(next).every((line) => line.synthesis === null)).toBe(true)
    // 名前だけの変更では合成し直さない
    const renamed = apply(project, [{ op: 'character.update', characterId, name: 'ずんだもん改' }])
    expect(voiceItemsInOrder(renamed).every((line) => line.synthesis !== null)).toBe(true)
  })

  it('セリフが残っているキャラクターは削除できない', () => {
    const { project, characterId } = script()
    expect(() => apply(project, [{ op: 'character.delete', characterId }])).toThrow(/削除できません/)
  })
})

describe('字幕の行', () => {
  it('挿入時とテキスト変更時に自動改行する', () => {
    let project = apply(createEmptyProject({ renderSeed: 1 }), [
      { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん' }
    ])
    const characterId = Object.keys(project.characters)[0]!
    project = apply(project, [
      { op: 'voice.insert', characterId, text: 'あ'.repeat(30), atMs: 0 }
    ])
    const line = voiceItemsInOrder(project)[0] as VoiceItem
    expect(line.subtitleLines).toEqual(['あ'.repeat(22), 'あ'.repeat(8)])
  })

  it('手で決めた改行はテキストを書き換えると自動に戻る', () => {
    const { project, ids } = script()
    const manual = apply(project, [{ op: 'voice.setSubtitleLines', itemId: ids[0]!, lines: ['いちぎょ', 'うめ'] }])
    expect(voiceItemsInOrder(manual)[0]!.subtitleLines).toEqual(['いちぎょ', 'うめ'])
    expect(voiceItemsInOrder(manual)[0]!.subtitleLinesManual).toBe(true)

    const edited = apply(manual, [{ op: 'voice.setText', itemId: ids[0]!, text: 'かきかえた' }])
    expect(voiceItemsInOrder(edited)[0]!.subtitleLines).toEqual(['かきかえた'])
    expect(voiceItemsInOrder(edited)[0]!.subtitleLinesManual).toBe(false)
  })

  it('改行位置の変更以外(文字の追加・削除)は拒否する', () => {
    const { project, ids } = script()
    expect(() =>
      apply(project, [{ op: 'voice.setSubtitleLines', itemId: ids[0]!, lines: ['ちがう', 'もじ'] }])
    ).toThrow(CommandError)
  })
})

describe('字幕スタイル', () => {
  it('既存のスタイルを元に新しいスタイルを作り、キャラクターに割り当てられる', () => {
    const project = createEmptyProject({ renderSeed: 1 })
    const next = apply(project, [
      { op: 'style.upsertSubtitle', props: { name: 'ずんだもん', outline: { color: '#2b7a0b', widthPx: 8 } }, tempId: 's' },
      {
        op: 'character.create',
        name: 'ずんだもん',
        engineId: 'voicevox',
        speakerId: 3,
        speakerName: 'ずんだもん',
        subtitleStyleId: 's'
      }
    ])
    const character = Object.values(next.characters)[0]!
    const style = next.subtitleStyles[character.subtitleStyleId]!
    expect(style.name).toBe('ずんだもん')
    expect(style.outline).toEqual({ color: '#2b7a0b', widthPx: 8 })
    // 元のスタイルの他の値を引き継ぐ
    expect(style.fontSizePx).toBe(64)
  })

  it('1行の文字数を変えると、そのスタイルのセリフを改行し直す', () => {
    const { project, ids } = script()
    const styleId = Object.keys(project.subtitleStyles)[0]!
    const next = apply(project, [{ op: 'style.upsertSubtitle', styleId, props: { maxCharsPerLine: 3 } }])
    expect(voiceItemsInOrder(next).find((line) => line.id === ids[0])!.subtitleLines).toEqual(['いちぎょ', 'うめ'])
  })

  it('不正な色は拒否する', () => {
    expect(() =>
      apply(createEmptyProject(), [{ op: 'style.upsertSubtitle', props: { color: 'red; x' } }])
    ).toThrow(CommandError)
  })
})

describe('グループ', () => {
  it('2つ以上でグループになり、既存のグループはまとめ、外して1つになったグループは解く', () => {
    const { project, ids } = script()
    expect(() => apply(project, [{ op: 'item.group', itemIds: [ids[0]!] }])).toThrow('2つ以上')
    let next = apply(project, [{ op: 'item.group', itemIds: [ids[0]!, ids[1]!] }])
    const first = next.items.find((item) => item.id === ids[0])!.groupId
    expect(first).toBeDefined()
    // グループの1つと別のアイテムをまとめると、元のグループの仲間ごと1つのグループになる
    next = apply(next, [{ op: 'item.group', itemIds: [ids[1]!, 'bgm'] }])
    const groupIds = new Set(next.items.filter((item) => [ids[0], ids[1], 'bgm'].includes(item.id)).map((item) => item.groupId))
    expect(groupIds.size).toBe(1)
    expect([...groupIds][0]).not.toBe(first)
    // 2つ外すと1つだけ残るので、そのグループも解く
    next = apply(next, [{ op: 'item.ungroup', itemIds: [ids[0]!, ids[1]!] }])
    expect(next.items.every((item) => item.groupId === undefined)).toBe(true)
    // 消して1つになっても解く
    next = apply(project, [{ op: 'item.group', itemIds: [ids[0]!, 'bgm'] }, { op: 'item.delete', itemId: 'bgm' }])
    expect(next.items.every((item) => item.groupId === undefined)).toBe(true)
  })

  it('貼り付けたものは元のグループに入らず、一緒に貼った仲間どうしで新しいグループになる', () => {
    const { project, ids } = script()
    const grouped = apply(project, [{ op: 'item.group', itemIds: [ids[0]!, ids[1]!] }])
    const source = grouped.items.filter((item) => item.id === ids[0] || item.id === ids[1])
    const pasted = apply(grouped, [{ op: 'item.paste', items: source, atMs: 20_000, tempIdPrefix: 'p' }])
    const originalGroup = source[0]!.groupId
    const copies = pasted.items.filter((item) => item.startMs >= 20_000)
    expect(copies).toHaveLength(2)
    expect(copies[0]!.groupId).toBeDefined()
    expect(copies[0]!.groupId).toBe(copies[1]!.groupId)
    expect(copies[0]!.groupId).not.toBe(originalGroup)
  })
})
