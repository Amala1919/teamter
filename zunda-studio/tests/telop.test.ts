import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'

import { NodeRenderResources } from '../src/main/render/node-resources'
import { aiCommandSchema } from '@shared/ai/edit-commands'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { createEmptyProject } from '@shared/project/factory'
import type { Project, TextItem, TextLook } from '@shared/project/types'
import { renderFrame } from '@shared/render/compositor'
import { telopSize, telopStyle, TELOP_PRESETS, visibleCharacters } from '@shared/render/telop'
import type { Ctx2D } from '@shared/render/types'

let counter = 0
const context = (): CommandContext => ({ newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') })
const run = (project: Project, commands: Command[]): ReturnType<typeof applyCommands> => applyCommands(project, commands, context())
const apply = (project: Project, commands: Command[]): Project => run(project, commands).project

/** 画面の真ん中(0〜3秒)にテロップを1つ、4〜6秒にもう1つ置いたプロジェクト。 */
function withTelops(text = 'テロップ'): { project: Project; first: string; second: string } {
  const result = run(createEmptyProject(), [
    { op: 'media.placeText', text, atMs: 0, durationMs: 3000, tempId: 'a' },
    { op: 'media.placeText', text: 'ふたつめ', atMs: 4000, durationMs: 2000, tempId: 'b' }
  ])
  return { project: result.project, first: result.resolvedIds['a']!, second: result.resolvedIds['b']! }
}

const telop = (project: Project, id: string): TextItem => project.items.find((item) => item.id === id) as TextItem

describe('テロップだけの見た目(item.setTextLook)', () => {
  it('足すと重なり、null でスタイルに戻り、replace で入れ替わる。複数のテロップにまとめて使える', () => {
    const { project, first, second } = withTelops()
    let next = apply(project, [{ op: 'item.setTextLook', itemIds: [first, second], look: { color: '#ffe14d', fontWeight: 900 } }])
    next = apply(next, [{ op: 'item.setTextLook', itemIds: [first], look: { outline: 'none', typewriterMs: 800 } }])
    expect(telop(next, first).look).toEqual({ color: '#ffe14d', fontWeight: 900, outline: 'none', typewriterMs: 800 })
    expect(telop(next, second).look).toEqual({ color: '#ffe14d', fontWeight: 900 })

    // null はスタイルに戻す。文字送り 0 は「しない」
    next = apply(next, [{ op: 'item.setTextLook', itemIds: [first], look: { color: null, typewriterMs: 0 } }])
    expect(telop(next, first).look).toEqual({ fontWeight: 900, outline: 'none' })

    // replace は今の見た目を捨てる。空になれば look ごと消える
    next = apply(next, [{ op: 'item.setTextLook', itemIds: [first, second], look: {}, replace: true }])
    expect(telop(next, first).look).toBeUndefined()
    expect(telop(next, second).look).toBeUndefined()
  })

  it('範囲外の値やテロップ以外は断る', () => {
    const { project, first } = withTelops()
    expect(() => apply(project, [{ op: 'item.setTextLook', itemIds: [first], look: { color: 'red' } }])).toThrow('文字の色')
    expect(() => apply(project, [{ op: 'item.setTextLook', itemIds: [first], look: { fontSizePx: 1000 } }])).toThrow('文字の大きさ')
    expect(() =>
      apply(project, [{ op: 'item.setTextLook', itemIds: [first], look: { background: { color: '#000000', opacity: 2, paddingPx: 10, radiusPx: 0 } } }])
    ).toThrow('帯の濃さ')
    const withShape = run(project, [{ op: 'media.placeShape', shape: 'rect', fill: '#ffffff', atMs: 0, durationMs: 1000, tempId: 's' }])
    expect(() => apply(withShape.project, [{ op: 'item.setTextLook', itemIds: [withShape.resolvedIds['s']!], look: { color: '#ffffff' } }])).toThrow(
      'テロップではありません'
    )
  })

  it('スタイルに上書きを重ねた見た目になる(縁取り・影の none は付けない)', () => {
    const { project, first } = withTelops()
    const style = project.subtitleStyles[telop(project, first).styleId]!
    expect(telopStyle(style, undefined)).toMatchObject({ color: style.color, align: 'center', background: null, typewriterMs: 0 })
    const look: TextLook = { color: '#123456', align: 'left', outline: 'none', shadow: 'none', fontSizePx: 80 }
    expect(telopStyle(style, look)).toMatchObject({ color: '#123456', align: 'left', outline: null, shadow: null, fontSizePx: 80 })
    // ひな形はどれも検証を通る
    for (const preset of TELOP_PRESETS) {
      expect(() => apply(project, [{ op: 'item.setTextLook', itemIds: [first], look: preset.look, replace: true }])).not.toThrow()
    }
  })

  it('文字送りは、時間に合わせて出す文字数が増える(改行は数えない)', () => {
    expect(visibleCharacters('あいう\nえお', 0, 0)).toBe(5)
    expect(visibleCharacters('あいう\nえお', 1000, 0)).toBe(0)
    expect(visibleCharacters('あいう\nえお', 1000, 400)).toBe(2)
    expect(visibleCharacters('あいう\nえお', 1000, 5000)).toBe(5)
  })

  it('編集AIも見た目を変えられる', () => {
    expect(aiCommandSchema.safeParse({ op: 'item.setTextLook', itemIds: ['itm_1'], look: { color: '#ffffff', outline: 'none', align: null } }).success).toBe(true)
    expect(aiCommandSchema.safeParse({ op: 'item.setTextLook', itemIds: ['itm_1'], look: { align: 'middle' } }).success).toBe(false)
  })
})

describe('テロップの描画', () => {
  const resources = new NodeRenderResources()

  function frame(project: Project, timeMs: number): { read: (x: number, y: number) => number[]; lit: (x0: number, x1: number) => number } {
    const canvas = createCanvas(project.canvas.width, project.canvas.height)
    const ctx = canvas.getContext('2d')
    renderFrame(ctx as unknown as Ctx2D, project, timeMs, resources)
    const read = (x: number, y: number): number[] => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3))
    /** 画面の真ん中の帯(縦 ±60px)のうち、x0〜x1 で黒でない点の数。 */
    const lit = (x0: number, x1: number): number => {
      const data = ctx.getImageData(x0, 480, x1 - x0, 120).data
      let count = 0
      for (let index = 0; index < data.length; index += 4) if (data[index]! + data[index + 1]! + data[index + 2]! > 60) count++
      return count
    }
    return { read, lit }
  }

  it('背景の帯を文字の周りに敷く', () => {
    const { project, first } = withTelops('あいう')
    const plain = apply(project, [{ op: 'item.setTextLook', itemIds: [first], look: { outline: 'none', shadow: 'none' } }])
    const banded = apply(plain, [
      { op: 'item.setTextLook', itemIds: [first], look: { background: { color: '#ff0000', opacity: 1, paddingPx: 40, radiusPx: 0 } } }
    ])
    const style = project.subtitleStyles[telop(project, first).styleId]!
    const measure = createCanvas(10, 10).getContext('2d') as unknown as Ctx2D
    const size = telopSize(measure, telop(banded, first), style)
    const { width, height } = project.canvas
    // 帯の内側で、文字より外(左の余白)
    const x = Math.round(width / 2 - size.width / 2 + 10)
    expect(frame(banded, 100).read(x, height / 2)).toEqual([255, 0, 0])
    expect(frame(plain, 100).read(x, height / 2)).toEqual([0, 0, 0])
    // 帯の外は何も描かない
    expect(frame(banded, 100).read(Math.round(width / 2 - size.width / 2 - 10), height / 2)).toEqual([0, 0, 0])
  })

  it('文字送りは左から順に出て、行の位置は動かない', () => {
    const { project, first } = withTelops('■■■■')
    const typed = apply(project, [
      { op: 'item.setTextLook', itemIds: [first], look: { outline: 'none', shadow: 'none', color: '#ffffff', typewriterMs: 1000 } }
    ])
    const center = project.canvas.width / 2
    const left = (timeMs: number): number => frame(typed, timeMs).lit(center - 400, center)
    const right = (timeMs: number): number => frame(typed, timeMs).lit(center, center + 400)
    expect(left(0) + right(0)).toBe(0)
    // 半分の時間では左の2文字だけ
    expect(left(500)).toBeGreaterThan(0)
    expect(right(500)).toBe(0)
    // 出し終わると全部。左側は途中と同じ(位置が動かない)
    expect(right(1200)).toBeGreaterThan(0)
    expect(left(1200)).toBe(left(500))
  })

  it('色を変えるとその色で描く', () => {
    const { project, first } = withTelops('■■■■')
    const green = apply(project, [{ op: 'item.setTextLook', itemIds: [first], look: { outline: 'none', shadow: 'none', color: '#00ff00' } }])
    const { read } = frame(green, 100)
    const center = project.canvas.width / 2
    const samples = [-60, -30, 30, 60].map((dx) => read(center + dx, project.canvas.height / 2 - 20))
    expect(samples.some(([r, g, b]) => g! > 200 && r! < 60 && b! < 60)).toBe(true)
  })
})
