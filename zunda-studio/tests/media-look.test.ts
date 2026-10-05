import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'

import { applyCommands } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { createEmptyProject } from '@shared/project/factory'
import type { Project, VideoItem } from '@shared/project/types'
import { filterOf, renderFrame } from '@shared/render/compositor'
import { centerForCrop, itemBox, uncroppedPlacement } from '@shared/render/item-box'
import type { Ctx2D, RenderResources } from '@shared/render/types'

let counter = 0
const ctx = { newId: (prefix: string) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }

function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, ctx).project
}

/** 左半分が赤、右半分が青の画像。 */
function splitImage(): unknown {
  const canvas = createCanvas(200, 100)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ff0000'
  context.fillRect(0, 0, 100, 100)
  context.fillStyle = '#0000ff'
  context.fillRect(100, 0, 100, 100)
  return canvas
}

const image = splitImage()
const resources: RenderResources = {
  psd: () => null,
  image: () => image,
  video: () => null,
  createCanvas: (width, height) => createCanvas(width, height) as unknown as ReturnType<RenderResources['createCanvas']>
}

function withImage(): Project {
  return apply(createEmptyProject({ width: 400, height: 200 }), [
    {
      op: 'asset.add',
      asset: { type: 'image', path: { absolute: '/x/split.png', relative: null }, width: 200, height: 100, license: { source: '自作', creditRequired: false } },
      tempId: 'img'
    },
    { op: 'media.placeImage', assetId: 'img', atMs: 0, durationMs: 2000, transform: { x: 200, y: 100 }, tempId: 'item' }
  ])
}

function pixelAt(project: Project, x: number, y: number): number[] {
  const canvas = createCanvas(project.canvas.width, project.canvas.height)
  renderFrame(canvas.getContext('2d') as unknown as Ctx2D, project, 500, resources)
  return Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3))
}

describe('切り抜き・枠・色の調整', () => {
  it('左を半分切り抜くと、残った右半分(青)が置いた位置に出て、大きさも半分になる', () => {
    let project = withImage()
    const itemId = project.items[0]!.id
    expect(pixelAt(project, 150, 100)).toEqual([255, 0, 0])
    project = apply(project, [{ op: 'item.setMediaLook', itemIds: [itemId], crop: { left: 0.5, top: 0, right: 0, bottom: 0 } }])
    expect(pixelAt(project, 200, 100)).toEqual([0, 0, 255])
    // 残った部分は 100×100。その外は何も描かれない。
    expect(pixelAt(project, 140, 100)).toEqual([0, 0, 0])
    const box = itemBox(project, project.items[0] as never, createCanvas(1, 1).getContext('2d') as unknown as Ctx2D)
    expect(box).toMatchObject({ width: 100, height: 100 })
  })

  it('切り抜きを変えても、残る部分が同じ場所に残る位置を求められる', () => {
    let project = withImage()
    const item = project.items[0]!
    const whole = uncroppedPlacement(project, item as never, createCanvas(1, 1).getContext('2d') as unknown as Ctx2D)!
    expect(whole).toMatchObject({ center: { x: 200, y: 100 }, size: { width: 200, height: 100 } })
    const crop = { left: 0.5, top: 0, right: 0, bottom: 0 }
    const center = centerForCrop(whole, 0, crop)
    expect(center).toEqual({ x: 250, y: 100 })
    project = apply(project, [
      { op: 'item.setMediaLook', itemIds: [item.id], crop },
      { op: 'item.setTransform', itemId: item.id, ...center }
    ])
    // 青い右半分は、切り抜く前と同じ場所(右側)にある。
    expect(pixelAt(project, 250, 100)).toEqual([0, 0, 255])
    expect(pixelAt(project, 150, 100)).toEqual([0, 0, 0])
  })

  it('丸い枠で切り抜くと角は描かれず、縁が付く', () => {
    let project = withImage()
    project = apply(project, [
      { op: 'item.setMediaLook', itemIds: [project.items[0]!.id], frame: { shape: 'circle', radiusPx: 0, border: { color: '#00ff00', widthPx: 6 }, shadow: null } }
    ])
    expect(pixelAt(project, 102, 52)).toEqual([0, 0, 0])
    expect(pixelAt(project, 200, 52)[1]).toBeGreaterThan(200)
  })

  it('色の調整はキャンバスのフィルタになり、元のままなら持たない', () => {
    expect(filterOf({ brightness: 1.2, contrast: 1, saturation: 0, hue: 0, sepia: 0, blurPx: 0 })).toBe('brightness(120%) saturate(0%)')
    expect(filterOf(undefined, 4)).toBe('blur(4.0px)')
    let project = withImage()
    const itemId = project.items[0]!.id
    project = apply(project, [{ op: 'item.setMediaLook', itemIds: [itemId], adjust: { brightness: 1, contrast: 1, saturation: 0, hue: 0, sepia: 0, blurPx: 0 } }])
    // 白黒にすると、赤は灰色になる。
    const [r, g, b] = pixelAt(project, 150, 100)
    expect(Math.abs(r! - g!)).toBeLessThan(3)
    expect(Math.abs(g! - b!)).toBeLessThan(3)
    project = apply(project, [{ op: 'item.setMediaLook', itemIds: [itemId], adjust: { brightness: 1, contrast: 1, saturation: 1, hue: 0, sepia: 0, blurPx: 0 } }])
    expect(project.items[0]).not.toHaveProperty('adjust')
    expect(() => apply(project, [{ op: 'item.setMediaLook', itemIds: [itemId], crop: { left: 0.6, right: 0.6, top: 0, bottom: 0 } }])).toThrow('切り抜きすぎ')
  })
})

describe('前の素材から切り替える', () => {
  function twoClips(options: { firstOut?: number } = {}): Project {
    return apply(createEmptyProject(), [
      {
        op: 'asset.add',
        asset: {
          type: 'video',
          path: { absolute: '/x/game.mp4', relative: null },
          durationMs: 20_000,
          width: 1920,
          height: 1080,
          fps: 30,
          hasAudio: true,
          license: { source: '自分で録画', creditRequired: false }
        },
        tempId: 'v'
      },
      { op: 'media.placeVideo', assetId: 'v', atMs: 0, inMs: 0, outMs: options.firstOut ?? 4000, tempId: 'a' },
      { op: 'media.placeVideo', assetId: 'v', atMs: options.firstOut ?? 4000, inMs: 10_000, outMs: 14_000, tempId: 'b' }
    ])
  }

  it('前の動画の続きを使って重ね、後の動画を上のレイヤーに移して登場の切り替えを付ける', () => {
    let project = twoClips()
    const [a, b] = project.items as VideoItem[]
    project = apply(project, [{ op: 'timeline.crossTransition', itemId: b!.id, kind: 'fade', durationMs: 500 }])
    const after = new Map(project.items.map((item) => [item.id, item as VideoItem]))
    expect(after.get(a!.id)).toMatchObject({ durationMs: 4500, outMs: 4500 })
    // 後の動画の始まりは動かさない(セリフとの合わせがずれないように)。
    expect(after.get(b!.id)).toMatchObject({ startMs: 4000, inMs: 10_000 })
    const layerIndex = (id: string): number => project.layers.find((layer) => layer.id === id)!.index
    expect(layerIndex(after.get(b!.id)!.layerId)).toBeGreaterThan(layerIndex(after.get(a!.id)!.layerId))
    expect(after.get(b!.id)!.effects).toContainEqual({ type: 'transition', in: { kind: 'fade', durationMs: 500 }, out: null })
  })

  it('前の動画の続きが足りなければ、後の動画の手前を使う', () => {
    let project = twoClips({ firstOut: 20_000 })
    const b = project.items[1] as VideoItem
    project = apply(project, [{ op: 'timeline.crossTransition', itemId: b.id, kind: 'wipeRight', durationMs: 400 }])
    expect(project.items.find((item) => item.id === b.id)).toMatchObject({ startMs: 19_600, inMs: 9600, durationMs: 4400 })
  })

  it('直前に素材が無ければ、登場の切り替えだけを付ける', () => {
    let project = twoClips()
    const a = project.items[0] as VideoItem
    project = apply(project, [{ op: 'timeline.crossTransition', itemId: a.id, kind: 'iris', durationMs: 600 }])
    expect(project.items.find((item) => item.id === a.id)).toMatchObject({ startMs: 0, durationMs: 4000 })
    expect(project.items.find((item) => item.id === a.id)!.effects.at(-1)).toEqual({ type: 'transition', in: { kind: 'iris', durationMs: 600 }, out: null })
  })
})

describe('字幕の帯と出方', () => {
  function withLine(style: Partial<import('@shared/project/types').SubtitleStyle>): Project {
    let project = createEmptyProject({ width: 640, height: 360 })
    project = apply(project, [
      { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん', tempId: 'c' },
      { op: 'style.upsertSubtitle', styleId: Object.keys(project.subtitleStyles)[0]!, props: { ...style, fontSizePx: 40, position: { anchor: 'bottom-center', x: 320, y: 300 } } }
    ])
    const characterId = Object.keys(project.characters)[0]!
    const styleId = Object.keys(project.subtitleStyles)[0]!
    project = apply(project, [{ op: 'character.update', characterId, subtitleStyleId: styleId }])
    return apply(project, [{ op: 'voice.insert', characterId, text: 'ABCDEFGHIJKLMN', atMs: 0 }])
  }

  it('帯を画面の横幅いっぱいに敷ける', () => {
    const project = withLine({ background: { color: '#ff0000', opacity: 1, paddingPx: 10, radiusPx: 0, fullWidth: true } })
    // 字幕から離れた左端にも、帯の色が出る(文字は書き出し環境に日本語のフォントが無くても測れるよう英字にする)。
    expect(pixelAt(project, 4, 290)).toEqual([255, 0, 0])
    expect(pixelAt(project, 4, 100)).toEqual([0, 0, 0])
  })

  it('1文字ずつ出すと、始めは前の方の文字だけが出る', () => {
    const project = withLine({ appear: { kind: 'typewriter', durationMs: 1000 }, outline: null, shadow: null, color: '#ffffff' })
    const canvas = createCanvas(640, 360)
    const context = canvas.getContext('2d')
    const whiteIn = (fromX: number, toX: number): number => {
      const data = context.getImageData(fromX, 260, toX - fromX, 50).data
      let count = 0
      for (let index = 0; index < data.length; index += 4) if (data[index]! > 200) count++
      return count
    }
    renderFrame(context as unknown as Ctx2D, project, 200, resources)
    const earlyRight = whiteIn(330, 540)
    expect(whiteIn(100, 300)).toBeGreaterThan(0)
    renderFrame(context as unknown as Ctx2D, project, 1500, resources)
    expect(earlyRight).toBe(0)
    expect(whiteIn(330, 540)).toBeGreaterThan(0)
    expect(() => apply(project, [{ op: 'style.upsertSubtitle', styleId: Object.keys(project.subtitleStyles)[0]!, props: { appear: { kind: 'warp' as never, durationMs: 100 } } }])).toThrow('字幕の出方')
  })
})

describe('前の素材から切り替える(重ねられないとき)', () => {
  it('どちらにも続きが無ければ、前の素材を消してからこの素材を出す', () => {
    let project = apply(createEmptyProject(), [
      {
        op: 'asset.add',
        asset: { type: 'video', path: { absolute: '/x/clip.mp4', relative: null }, durationMs: 4000, width: 1920, height: 1080, fps: 30, hasAudio: true, license: { source: '録画', creditRequired: false } },
        tempId: 'v'
      },
      { op: 'media.placeVideo', assetId: 'v', atMs: 0 },
      { op: 'media.placeVideo', assetId: 'v', atMs: 4000 }
    ])
    const [a, b] = project.items
    project = apply(project, [{ op: 'timeline.crossTransition', itemId: b!.id, kind: 'fade', durationMs: 600 }])
    const after = new Map(project.items.map((item) => [item.id, item]))
    expect(after.get(a!.id)).toMatchObject({ startMs: 0, durationMs: 4000 })
    expect(after.get(b!.id)).toMatchObject({ startMs: 4000, durationMs: 4000 })
    expect(after.get(a!.id)!.effects).toContainEqual({ type: 'transition', in: null, out: { kind: 'fade', durationMs: 300 } })
    expect(after.get(b!.id)!.effects).toContainEqual({ type: 'transition', in: { kind: 'fade', durationMs: 300 }, out: null })
  })
})
