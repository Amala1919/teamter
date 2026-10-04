import { writeFileSync } from 'node:fs'

import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'

import { applyCommands } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { createEmptyProject } from '@shared/project/factory'
import type { Project, ShapeItem } from '@shared/project/types'
import { renderFrame } from '@shared/render/compositor'
import { effectStateAt } from '@shared/render/effects'
import { SHAPE_PRESETS } from '@shared/render/shape-presets'
import type { Ctx2D, RenderResources } from '@shared/render/types'

let counter = 0
const ctx = { newId: (prefix: string) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }

function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, ctx).project
}

const resources: RenderResources = {
  psd: () => null,
  image: () => null,
  video: () => null,
  createCanvas: (width, height) => createCanvas(width, height) as unknown as ReturnType<RenderResources['createCanvas']>
}

function render(project: Project, timeMs: number): Uint8ClampedArray {
  const canvas = createCanvas(project.canvas.width, project.canvas.height)
  renderFrame(canvas.getContext('2d') as unknown as Ctx2D, project, timeMs, resources)
  return canvas.getContext('2d').getImageData(0, 0, project.canvas.width, project.canvas.height).data
}

function pixel(data: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number] {
  const index = (Math.round(y) * width + Math.round(x)) * 4
  return [data[index]!, data[index + 1]!, data[index + 2]!]
}

/** 背景(黒)と違う画素の数。 */
function painted(data: Uint8ClampedArray): number {
  let count = 0
  for (let index = 0; index < data.length; index += 4) if (data[index]! + data[index + 1]! + data[index + 2]! > 30) count++
  return count
}

describe('装飾(図形のひな形)', () => {
  it('どのひな形も置けて、何かが描かれる(描いていく途中も、終わった後も)', () => {
    for (const preset of SHAPE_PRESETS) {
      const project = apply(createEmptyProject({ width: 640, height: 360, renderSeed: 7 }), [
        // 黒い装飾(集中線など)も見えるよう、背景を灰色にする
        { op: 'media.placeShape', shape: 'rect', fill: '#808080', atMs: 0, durationMs: 9000 },
        { op: 'media.placeShape', shape: preset.shape, fill: preset.fill, atMs: 0, durationMs: preset.durationMs, props: preset.props, effects: preset.effects ?? [], transform: { scale: 0.5 } }
      ])
      const settled = render(project, Math.min(preset.durationMs - 50, 1200))
      expect(differs(settled), preset.id).toBeGreaterThan(50)
    }
  })

  it('描いていく図形は、途中では一部だけが描かれている', () => {
    const project = apply(createEmptyProject({ width: 640, height: 360 }), [
      { op: 'media.placeShape', shape: 'line', fill: '#ffffff', atMs: 0, durationMs: 2000, props: { width: 600, height: 40, thickness: 30, drawMs: 1000 } }
    ])
    const early = render(project, 500)
    const late = render(project, 1500)
    // 線は左から右へ伸びる。途中では右の端はまだ描かれていない。
    expect(pixel(early, 640, 60, 180)[0]).toBeGreaterThan(200)
    expect(pixel(early, 640, 580, 180)[0]).toBeLessThan(30)
    expect(pixel(late, 640, 580, 180)[0]).toBeGreaterThan(200)
  })

  it('スポットライトは枠の外を暗くし、中は暗くしない', () => {
    const project = apply(createEmptyProject({ width: 640, height: 360 }), [
      { op: 'media.placeShape', shape: 'rect', fill: '#ffffff', atMs: 0, durationMs: 2000, props: { width: 640, height: 360 } },
      { op: 'media.placeShape', shape: 'spotlight', fill: '#000000', atMs: 0, durationMs: 2000, props: { width: 200, height: 160, fillOpacity: 0.8 } }
    ])
    const data = render(project, 500)
    expect(pixel(data, 640, 320, 180)[0]).toBeGreaterThan(240)
    expect(pixel(data, 640, 20, 20)[0]).toBeLessThan(80)
  })

  it('以前の図形(大きさを持たない)は、これまでどおり画面いっぱいに描く', () => {
    const project = apply(createEmptyProject({ width: 320, height: 180 }), [{ op: 'media.placeShape', shape: 'rect', fill: '#ff0000', atMs: 0, durationMs: 1000 }])
    const data = render(project, 100)
    expect(pixel(data, 320, 2, 2)).toEqual([255, 0, 0])
    expect(pixel(data, 320, 317, 177)).toEqual([255, 0, 0])
  })

  it('図形の形・見た目はまとめて変えられ、null で既定に戻り、取り消せる値は検証される', () => {
    let project = apply(createEmptyProject(), [
      { op: 'media.placeShape', shape: 'rect', fill: '#ff0000', atMs: 0, durationMs: 1000, props: { width: 100, height: 100 }, tempId: 'a' },
      { op: 'media.placeShape', shape: 'rect', fill: '#ff0000', atMs: 0, durationMs: 1000, props: { width: 100, height: 100 }, tempId: 'b' }
    ])
    const ids = project.items.map((item) => item.id)
    project = apply(project, [{ op: 'item.setShape', itemIds: ids, shape: 'star', fill: '#00ff00', props: { stroke: { color: '#ffffff', widthPx: 4 }, points: 6 } }])
    for (const item of project.items as ShapeItem[]) {
      expect(item).toMatchObject({ shape: 'star', fill: '#00ff00', points: 6, stroke: { color: '#ffffff', widthPx: 4 }, width: 100 })
    }
    project = apply(project, [{ op: 'item.setShape', itemIds: [ids[0]!], props: { points: null } }])
    expect((project.items[0] as ShapeItem).points).toBeUndefined()
    // ひな形を当てる(replace)と、大きさを残して見た目の調整は入れ替わる。
    project = apply(project, [{ op: 'item.setShape', itemIds: [ids[1]!], props: { drawMs: 300 }, replace: true }])
    expect(project.items[1]).toMatchObject({ width: 100, drawMs: 300 })
    expect((project.items[1] as ShapeItem).stroke).toBeUndefined()
    expect(() => apply(project, [{ op: 'item.setShape', itemIds: ids, shape: 'hexagon' as never }])).toThrow('図形の形の指定が不正です')
    expect(() => apply(project, [{ op: 'item.setShape', itemIds: ids, props: { fillOpacity: 2 } }])).toThrow('塗りの濃さ')
  })
})

describe('動き・切り替えのエフェクト', () => {
  const item = (effects: ShapeItem['effects']) => ({ id: 'x', durationMs: 2000, effects })

  it('繰り返しの動き(ドクンドクン・点滅・回転・傾き・浮く)', () => {
    expect(effectStateAt(item([{ type: 'pulse', amount: 0.1, periodMs: 1000 }]), 250, 1).scale).toBeCloseTo(1.1)
    expect(effectStateAt(item([{ type: 'blink', periodMs: 1000, minOpacity: 0 }]), 500, 1).alpha).toBeCloseTo(0)
    expect(effectStateAt(item([{ type: 'blink', periodMs: 1000, minOpacity: 0 }]), 0, 1).alpha).toBeCloseTo(1)
    expect(effectStateAt(item([{ type: 'spin', degreesPerSecond: 90 }]), 1000, 1).rotation).toBeCloseTo(90)
    expect(effectStateAt(item([{ type: 'swing', degrees: 10, periodMs: 1000 }]), 250, 1).rotation).toBeCloseTo(10)
    expect(effectStateAt(item([{ type: 'float', amplitudePx: 12, periodMs: 1000 }]), 250, 1).dy).toBeCloseTo(12)
  })

  it('登場・退場の切り替えは、始まりと終わりの間だけ掛かる', () => {
    const wipe = item([{ type: 'transition', in: { kind: 'wipeRight', durationMs: 400 }, out: { kind: 'slideLeft', durationMs: 400 } }])
    expect(effectStateAt(wipe, 0, 1).clips[0]).toMatchObject({ kind: 'edge', from: 'left', visible: 0 })
    expect(effectStateAt(wipe, 1000, 1).clips).toEqual([])
    expect(effectStateAt(wipe, 1000, 1).dx).toBe(0)
    // 退場の最後は画面の外(左)へ抜けている。
    expect(effectStateAt(wipe, 2000, 1, { width: 1920, height: 1080 }).dx).toBeCloseTo(-1920)
  })

  it('ワイプで出てくる画像は、左から見えていく', () => {
    const project = apply(createEmptyProject({ width: 400, height: 200 }), [
      {
        op: 'media.placeShape',
        shape: 'rect',
        fill: '#ffffff',
        atMs: 0,
        durationMs: 2000,
        props: { width: 400, height: 200 },
        effects: [{ type: 'transition', in: { kind: 'wipeRight', durationMs: 1000 }, out: null }]
      }
    ])
    const data = render(project, 300)
    expect(pixel(data, 400, 20, 100)[0]).toBeGreaterThan(200)
    expect(pixel(data, 400, 380, 100)[0]).toBeLessThan(30)
  })

  it('不正なエフェクトは拒否する', () => {
    const project = apply(createEmptyProject(), [{ op: 'media.placeShape', shape: 'rect', fill: '#ff0000', atMs: 0, durationMs: 1000, tempId: 's' }])
    const itemId = project.items[0]!.id
    expect(() => apply(project, [{ op: 'item.addEffect', itemId, effect: { type: 'blink', periodMs: 10, minOpacity: 0 } }])).toThrow('周期')
    expect(() => apply(project, [{ op: 'item.addEffect', itemId, effect: { type: 'transition', in: null, out: null } }])).toThrow('登場か退場')
    expect(() => apply(project, [{ op: 'item.addEffect', itemId, effect: { type: 'transition', in: { kind: 'warp' as never, durationMs: 100 }, out: null } }])).toThrow('切り替え方')
  })
})

// 目で確かめる用: ZS_GALLERY=出力先.png を付けて実行すると、ひな形を並べた画像を書き出す。
if (process.env['ZS_GALLERY']) {
  describe('ひな形の一覧の画像', () => {
    it('書き出す', () => {
      const columns = 6
      const cell = { width: 480, height: 300 }
      const rows = Math.ceil(SHAPE_PRESETS.length / columns)
      const sheet = createCanvas(cell.width * columns, cell.height * rows)
      const sheetContext = sheet.getContext('2d')
      sheetContext.fillStyle = '#3c4a5c'
      sheetContext.fillRect(0, 0, sheet.width, sheet.height)
      SHAPE_PRESETS.forEach((preset, index) => {
        const project = apply(createEmptyProject({ width: 1920, height: 1080, renderSeed: 3 }), [
          { op: 'media.placeShape', shape: 'rect', fill: '#56708f', atMs: 0, durationMs: 9000, props: { width: 1920, height: 1080 } },
          { op: 'media.placeShape', shape: preset.shape, fill: preset.fill, atMs: 0, durationMs: preset.durationMs, props: preset.props, effects: preset.effects ?? [] }
        ])
        const canvas = createCanvas(1920, 1080)
        renderFrame(canvas.getContext('2d') as unknown as Ctx2D, project, Math.min(preset.durationMs * 0.6, 1400), resources)
        const x = (index % columns) * cell.width
        const y = Math.floor(index / columns) * cell.height
        sheetContext.drawImage(canvas, x, y, cell.width, (cell.width * 1080) / 1920)
        sheetContext.fillStyle = '#ffffff'
        sheetContext.font = '22px sans-serif'
        sheetContext.fillText(preset.name, x + 8, y + cell.height - 14)
      })
      writeFileSync(process.env['ZS_GALLERY']!, sheet.toBuffer('image/png'))
    })
  })
}

/** 灰色の背景と違う画素の数。 */
function differs(data: Uint8ClampedArray): number {
  let count = 0
  for (let index = 0; index < data.length; index += 4) {
    if (Math.abs(data[index]! - 128) + Math.abs(data[index + 1]! - 128) + Math.abs(data[index + 2]! - 128) > 30) count++
  }
  return count
}
