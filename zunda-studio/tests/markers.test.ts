import { describe, expect, it } from 'vitest'

import { buildPublishPrompt } from '@shared/ai/publish'
import { applyCommands } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { createEmptyProject } from '@shared/project/factory'
import type { Project } from '@shared/project/types'

let counter = 0
const ctx = { newId: (prefix: string) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }

function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, ctx).project
}

describe('目印(編集中のメモ)', () => {
  it('置く・メモを書く・動かす・消すができ、時刻順に並ぶ', () => {
    let project = apply(createEmptyProject(), [
      { op: 'marker.add', atMs: 5000, text: 'ボス登場', tempId: 'a' },
      { op: 'marker.add', atMs: 1000, tempId: 'b' }
    ])
    expect(project.markers?.map((marker) => [marker.atMs, marker.text, marker.color])).toEqual([
      [1000, '', '#f5c518'],
      [5000, 'ボス登場', '#f5c518']
    ])
    const [first, second] = project.markers!
    project = apply(project, [{ op: 'marker.update', markerId: first!.id, atMs: 9000, text: 'BGMを変える', color: '#ff5c5c' }])
    expect(project.markers!.map((marker) => marker.id)).toEqual([second!.id, first!.id])
    expect(project.markers![1]).toMatchObject({ atMs: 9000, text: 'BGMを変える', color: '#ff5c5c' })
    project = apply(project, [{ op: 'marker.remove', markerId: second!.id }, { op: 'marker.remove', markerId: first!.id }])
    expect(project.markers).toBeUndefined()
    expect(() => apply(project, [{ op: 'marker.add', atMs: -1 }])).toThrow('負の値')
    expect(() => apply(project, [{ op: 'marker.remove', markerId: 'nope' }])).toThrow('目印が見つかりません')
  })

  it('メモのある目印は、投稿文の下書きの依頼に入る', () => {
    const project = apply(createEmptyProject(), [
      { op: 'marker.add', atMs: 65_000, text: 'ここで逆転' },
      { op: 'marker.add', atMs: 70_000 }
    ])
    const prompt = buildPublishPrompt(project).turns[0]!.content
    expect(prompt).toContain('## 編集中に置いた目印')
    expect(prompt).toContain('[1:05] ここで逆転')
  })
})
