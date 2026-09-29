import { describe, expect, it } from 'vitest'

import { applyCommands } from '@shared/commands/apply'
import { voiceItemsInOrder } from '@shared/project/queries'
import { createEmptyProject } from '@shared/project/factory'
import { findLines, matchPositions, replaceCommands, replaceInText } from '@shared/script/find'

const ctx = (() => {
  let counter = 0
  return { newId: (prefix: string) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }
})()

describe('台本の検索・置換', () => {
  it('大文字・小文字と全角・半角の英数字を区別せずに探す', () => {
    expect(matchPositions('ＨＰが減ったのだ。hpを回復', 'HP')).toEqual([0, 9])
    expect(matchPositions('なにもない', '')).toEqual([])
    expect(replaceInText('ＨＰが減った。HPを回復', 'hp', '体力')).toBe('体力が減った。体力を回復')
  })

  it('話者で絞り込み、まとめて置換すると1回の操作で書き換わる', () => {
    let project = applyCommands(
      createEmptyProject(),
      [
        { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん', tempId: 'z' },
        { op: 'character.create', name: 'めたん', engineId: 'voicevox', speakerId: 2, speakerName: 'めたん', tempId: 'm' },
        { op: 'voice.insert', characterId: 'z', text: 'ボスのHPが多いのだ', atMs: 0, tempId: 'l1' },
        { op: 'voice.insert', characterId: 'm', text: 'HPより攻撃力よ', afterItemId: 'l1', tempId: 'l2' },
        { op: 'voice.insert', characterId: 'z', text: 'HP', afterItemId: 'l2' }
      ],
      ctx
    ).project
    const lines = voiceItemsInOrder(project)
    const zunda = lines[0]!.characterId
    expect(findLines(lines, { query: 'hp' })).toHaveLength(3)
    expect(findLines(lines, { query: 'hp', characterId: zunda })).toHaveLength(2)

    const commands = replaceCommands(lines, { query: 'HP', characterId: zunda }, '体力')
    expect(commands).toHaveLength(2)
    project = applyCommands(project, commands, ctx).project
    expect(voiceItemsInOrder(project).map((line) => line.text)).toEqual(['ボスの体力が多いのだ', 'HPより攻撃力よ', '体力'])
    // 空になる置換はしない
    expect(replaceCommands(voiceItemsInOrder(project), { query: '体力' }, '')).toHaveLength(1)
  })
})
