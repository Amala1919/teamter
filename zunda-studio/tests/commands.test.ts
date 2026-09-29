import { describe, expect, it } from 'vitest'

import { applyCommands, estimateSpeechDurationMs, type CommandContext } from '@shared/commands/apply'
import { CommandError, type Command } from '@shared/commands/types'
import { createEmptyProject, DEFAULT_LAYER_IDS } from '@shared/project/factory'
import { voiceItemsInOrder } from '@shared/project/queries'
import type { Project } from '@shared/project/types'

function testContext(): CommandContext {
  let counter = 0
  return {
    newId: (prefix) => `${prefix}_${++counter}`,
    now: () => new Date('2026-01-01T00:00:00Z')
  }
}

function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, testContext()).project
}

function projectWithCharacter(): { project: Project; characterId: string } {
  const project = apply(createEmptyProject({ renderSeed: 1 }), [
    {
      op: 'character.create',
      name: 'ずんだもん',
      engineId: 'voicevox',
      speakerId: 3,
      speakerName: 'ずんだもん(ノーマル)',
      creditText: 'VOICEVOX:ずんだもん'
    }
  ])
  const characterId = Object.keys(project.characters)[0]!
  return { project, characterId }
}

describe('character.create', () => {
  it('既定の字幕スタイルを引き継ぎ、クレジットを必要とする', () => {
    const { project, characterId } = projectWithCharacter()
    const character = project.characters[characterId]!
    expect(character.name).toBe('ずんだもん')
    expect(character.subtitleStyleId).toBe(Object.keys(project.subtitleStyles)[0])
    expect(character.creditRequired).toBe(true)
    expect(character.creditText).toBe('VOICEVOX:ずんだもん')
  })
})

describe('voice.insert', () => {
  it('ボイスアイテムを作り、尺は文字数からの暫定値になる', () => {
    const { project, characterId } = projectWithCharacter()
    const next = apply(project, [
      { op: 'voice.insert', characterId, text: 'こんにちはなのだ', atMs: 0 }
    ])

    const lines = voiceItemsInOrder(next)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.text).toBe('こんにちはなのだ')
    expect(lines[0]!.layerId).toBe(DEFAULT_LAYER_IDS.voice)
    expect(lines[0]!.durationMs).toBe(estimateSpeechDurationMs('こんにちはなのだ'))
    expect(lines[0]!.synthesis).toBeNull()
  })

  it('存在しないキャラクターを指定すると失敗し、プロジェクトは変わらない', () => {
    const project = createEmptyProject()
    expect(() =>
      apply(project, [{ op: 'voice.insert', characterId: 'chr_unknown', text: 'あ', atMs: 0 }])
    ).toThrow(CommandError)
    expect(project.items).toHaveLength(0)
  })

  it('空のセリフは拒否する', () => {
    const { project, characterId } = projectWithCharacter()
    expect(() => apply(project, [{ op: 'voice.insert', characterId, text: '  ', atMs: 0 }])).toThrow(
      CommandError
    )
  })

  it('一時IDを後続のコマンドから参照できる', () => {
    const { project, characterId } = projectWithCharacter()
    const next = apply(project, [
      { op: 'voice.insert', characterId, text: 'ひとつめ', atMs: 0, tempId: 'tmp_1' },
      { op: 'voice.setText', itemId: 'tmp_1', text: '書き換えた' }
    ])
    expect(voiceItemsInOrder(next)[0]!.text).toBe('書き換えた')
  })
})

describe('セリフの操作で動くのはセリフだけ', () => {
  it('間にセリフを足す・消す・尺が変わっても、録画・BGM・テロップ・ズームは置いた場所から動かない', () => {
    const { project, characterId } = projectWithCharacter()
    let next = apply(project, [
      {
        op: 'asset.add',
        asset: { type: 'video', path: { absolute: '/rec/game.mp4', relative: null }, license: { source: '自分で録画', creditRequired: false }, durationMs: 60_000, width: 1280, height: 720, fps: 30, hasAudio: true },
        tempId: 'v'
      },
      {
        op: 'asset.add',
        asset: { type: 'audio', path: { absolute: '/bgm/a.mp3', relative: null }, license: { source: 'x', creditRequired: false }, durationMs: 60_000 },
        tempId: 'a'
      },
      { op: 'voice.insert', characterId, text: 'ひとつめ', atMs: 0, tempId: 'l1' },
      { op: 'voice.insert', characterId, text: 'ふたつめ', afterItemId: 'l1', tempId: 'l2' },
      { op: 'media.placeVideo', assetId: 'v', atMs: 5000, inMs: 0, outMs: 20_000 },
      { op: 'media.placeAudio', assetId: 'a', atMs: 3000, durationMs: 30_000 },
      { op: 'media.placeText', text: 'テロップ', atMs: 4000, durationMs: 2000 },
      { op: 'zoom.insert', atMs: 6000, durationMs: 2000, region: { x: 0, y: 0, width: 960 } }
    ])
    const others = (p: Project): number[] =>
      p.items.filter((item) => item.type !== 'voice').sort((a, b) => a.type.localeCompare(b.type)).map((item) => item.startMs)
    const before = others(next)
    const [first, second] = voiceItemsInOrder(next)

    // 1つめの後ろに足す → 2つめのセリフは後ろへずれるが、ほかの素材はそのまま
    next = apply(next, [{ op: 'voice.insert', characterId, text: '間に足したセリフなのだ', afterItemId: first!.id }])
    expect(others(next)).toEqual(before)
    const lines = voiceItemsInOrder(next)
    expect(lines.map((line) => line.text)).toEqual(['ひとつめ', '間に足したセリフなのだ', 'ふたつめ'])
    expect(lines[2]!.startMs).toBeGreaterThan(second!.startMs)

    // 消して詰めても、ほかの素材はそのまま
    next = apply(next, [{ op: 'project.setEditing', closeGapOnVoiceDelete: true }, { op: 'voice.delete', itemId: lines[1]!.id }])
    expect(others(next)).toEqual(before)
    expect(voiceItemsInOrder(next)[1]!.startMs).toBe(second!.startMs)

    // 合成で尺が伸びても、ほかの素材はそのまま
    next = apply(next, [
      {
        op: 'voice.applySynthesis',
        itemId: first!.id,
        expectedText: 'ひとつめ',
        synthesis: { cacheKey: 'k', audioDurationMs: 4000, accentPhrases: [], lipSync: [] }
      }
    ])
    expect(others(next)).toEqual(before)
  })
})

describe('voice.setText', () => {
  it('テキストを変えると合成結果が無効化されるが、尺は新しい合成結果が届くまで変えない', () => {
    const { project, characterId } = projectWithCharacter()
    const inserted = apply(project, [{ op: 'voice.insert', characterId, text: '短い', atMs: 0 }])
    const before = voiceItemsInOrder(inserted)[0]!
    const next = apply(inserted, [
      { op: 'voice.setText', itemId: before.id, text: 'こちらはずっと長いセリフなのだ' }
    ])
    const line = voiceItemsInOrder(next)[0]!
    expect(line.synthesis).toBeNull()
    // 尺をここで暫定値に変えると、合成結果が届いたときに後ろをずらす量が狂う
    expect(line.durationMs).toBe(before.durationMs)
  })
})

describe('item.setTimeRange', () => {
  it('ボイスアイテムの尺は直接変更できない', () => {
    const { project, characterId } = projectWithCharacter()
    const inserted = apply(project, [{ op: 'voice.insert', characterId, text: 'あ', atMs: 0 }])
    const itemId = inserted.items[0]!.id
    expect(() => apply(inserted, [{ op: 'item.setTimeRange', itemId, durationMs: 9999 }])).toThrow(
      /合成結果から決まる/
    )
  })

  it('開始時刻は変更できる', () => {
    const { project, characterId } = projectWithCharacter()
    const inserted = apply(project, [{ op: 'voice.insert', characterId, text: 'あ', atMs: 0 }])
    const itemId = inserted.items[0]!.id
    const next = apply(inserted, [{ op: 'item.setTimeRange', itemId, startMs: 1500 }])
    expect(next.items[0]!.startMs).toBe(1500)
  })
})

describe('applyCommands', () => {
  it('1件でも失敗したら全件を適用しない', () => {
    const { project, characterId } = projectWithCharacter()
    expect(() =>
      apply(project, [
        { op: 'voice.insert', characterId, text: '成功する', atMs: 0 },
        { op: 'item.delete', itemId: 'itm_missing' }
      ])
    ).toThrow(CommandError)
    expect(project.items).toHaveLength(0)
  })

  it('元のプロジェクトを書き換えない(undo のスナップショットが壊れない)', () => {
    const { project, characterId } = projectWithCharacter()
    const next = apply(project, [{ op: 'voice.insert', characterId, text: 'あ', atMs: 0 }])
    expect(project.items).toHaveLength(0)
    expect(next.items).toHaveLength(1)
  })

  it('更新時刻を記録する', () => {
    const { project, characterId } = projectWithCharacter()
    const next = apply(project, [{ op: 'voice.insert', characterId, text: 'あ', atMs: 0 }])
    expect(next.meta.updatedAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('layer.insert', () => {
  it('挿入位置以降のレイヤーを押し下げる', () => {
    const project = createEmptyProject()
    const next = apply(project, [{ op: 'layer.insert', name: 'テロップ', index: 2 }])
    const inserted = next.layers.find((layer) => layer.name === 'テロップ')!
    expect(inserted.index).toBe(2)
    expect(next.layers.find((layer) => layer.id === DEFAULT_LAYER_IDS.zoom)!.index).toBe(1)
    expect(next.layers.find((layer) => layer.id === DEFAULT_LAYER_IDS.portrait)!.index).toBe(3)
    expect(next.layers.map((layer) => layer.index).sort()).toEqual([0, 1, 2, 3, 4, 5])
  })
})

describe('project.setConversationAi', () => {
  it('この動画の相方を演じるAIを設定・解除できる', () => {
    const project = createEmptyProject()
    const set = apply(project, [
      { op: 'project.setConversationAi', model: { providerId: 'opencode', model: 'opencode-go/kimi-k3' } }
    ])
    expect(set.ai.conversation).toEqual({ providerId: 'opencode', model: 'opencode-go/kimi-k3' })
    const cleared = apply(set, [{ op: 'project.setConversationAi', model: null }])
    expect(cleared.ai.conversation).toBeNull()
  })

  it('CLIに渡せない文字を含むモデルIDは拒否する', () => {
    expect(() =>
      apply(createEmptyProject(), [
        { op: 'project.setConversationAi', model: { providerId: 'claude-code', model: 'x; rm -rf /' } }
      ])
    ).toThrow(CommandError)
  })
})

describe('voice.insert の生成元', () => {
  it('AIが書いたセリフには生成元を記録し、人間のセリフは null', () => {
    const { project, characterId } = projectWithCharacter()
    const generatedBy = { providerId: 'claude-code' as const, model: 'opus', at: '2026-01-01T00:00:00Z' }
    const next = apply(project, [
      { op: 'voice.insert', characterId, text: '人間が書いた', atMs: 0 },
      { op: 'voice.insert', characterId, text: 'AIが書いた', atMs: 1000, generatedBy }
    ])
    const [human, ai] = voiceItemsInOrder(next)
    expect(human!.generatedBy).toBeNull()
    expect(ai!.generatedBy).toEqual(generatedBy)
  })
})
