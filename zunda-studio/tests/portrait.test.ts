import { beforeAll, describe, expect, it } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'

import { NodeRenderResources } from '@main/render/node-resources'
import { PsdService } from '@main/services/psd/psd-service'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { blinkPartAt, mouthPartFor, portraitSelections } from '@shared/portrait/animation'
import { cleanLayerName, inferPortraitConfig, roleForName } from '@shared/portrait/infer'
import { createEmptyProject } from '@shared/project/factory'
import type { PortraitConfig, Project, SynthesisResult } from '@shared/project/types'
import { findLayer, type PsdManifest } from '@shared/psd/types'
import { renderFrame } from '@shared/render/compositor'
import type { Ctx2D } from '@shared/render/types'

import { COLORS, POINTS, writePortraitPsd } from './fixtures/portrait-psd'
import { tempDir } from './helpers/env'

let manifest: PsdManifest
let psdPath: string

beforeAll(async () => {
  const directory = await tempDir('zs-psd-')
  psdPath = await writePortraitPsd(directory)
  manifest = await new PsdService(await tempDir('zs-psd-cache-')).load(psdPath)
})

const ctx: CommandContext = (() => {
  let counter = 0
  return { newId: (prefix: string) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }
})()

function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, ctx).project
}

describe('PSD の解析', () => {
  it('レイヤーを下から上の順に、グループ・非表示・クリッピングを保って読む', () => {
    expect(manifest.width).toBe(200)
    expect(manifest.layers.map((layer) => layer.name)).toEqual(['からだ', '影', '!目', '!口', '!眉', 'ほっぺ', 'メガネ'])
    expect(manifest.layers[1]).toMatchObject({ clipping: true, blend: 'multiply' })
    expect(manifest.layers[1]!.opacity).toBeCloseTo(0.5, 1)
    expect(manifest.layers[2]).toMatchObject({ kind: 'group', blend: 'pass-through' })
    expect(manifest.layers[6]!.hidden).toBe(true)
    expect(findLayer(manifest.layers, '!目/*開き')?.image).toMatch(/\.png$/)
  })

  it('レイヤーマスクを不透明度に焼き込む', async () => {
    const cheek = findLayer(manifest.layers, 'ほっぺ')!
    const image = await loadImage(cheek.image!)
    const canvas = createCanvas(cheek.width, cheek.height)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    expect(context.getImageData(2, 5, 1, 1).data[3]).toBe(255)
    expect(context.getImageData(35, 5, 1, 1).data[3]).toBe(0)
  })

  it('同じ PSD は二度解析しない', async () => {
    const service = new PsdService(await tempDir('zs-psd-cache2-'))
    const first = await service.load(psdPath)
    const second = await service.load(psdPath)
    expect(second.layers[0]!.image).toBe(first.layers[0]!.image)
  })
})

describe('パーツの推定', () => {
  it('名前から役割を推定する', () => {
    expect(roleForName('!目')).toBe('eye')
    expect(roleForName('*口パク')).toBe('mouth')
    expect(roleForName('眉毛')).toBe('eyebrow')
    expect(roleForName('服')).toBe('body')
    expect(roleForName('背景')).toBe('other')
    expect(cleanLayerName('*あ#2')).toBe('あ')
  })

  it('目・口・眉のグループ、まばたきの順序、母音の対応、通常の表情を推定する', () => {
    const { config, notes } = inferPortraitConfig(manifest, 'ast_psd', { width: 1920, height: 1080 }, 0)
    expect(notes).toEqual([])
    const groups = Object.values(config.partGroups)
    expect(groups.map((group) => group.role).sort()).toEqual(['eye', 'eyebrow', 'mouth'])

    const eye = groups.find((group) => group.role === 'eye')!
    const nameOf = (id: string): string => eye.items.find((item) => item.id === id)!.name
    expect(eye.blinkSequence!.map(nameOf)).toEqual(['開き', '半目', '閉じ'])

    const mouth = groups.find((group) => group.role === 'mouth')!
    const mouthName = (id: string | undefined): string => mouth.items.find((item) => item.id === id)!.name
    expect(config.lipSync).toEqual({ mode: 'vowel', partGroupId: mouth.id })
    expect(mouthName(mouth.vowelMap!.a)).toBe('あ')
    expect(mouthName(mouth.vowelMap!.pau)).toBe('ん')

    const brow = groups.find((group) => group.role === 'eyebrow')!
    const normal = config.expressions[config.defaultExpressionId!]!
    expect(brow.items.find((item) => item.id === normal.selections[brow.id])!.name).toBe('通常')
    // 1体目は画面の右側、下端に揃える
    expect(config.transform).toMatchObject({ anchor: 'bottom-center', x: Math.round(1920 * 0.82), y: 1080 })
  })

  it('母音のパーツが無い口は、開閉の段階で口パクする', () => {
    const group = {
      id: 'g',
      role: 'mouth' as const,
      layerPath: ['口'],
      selection: 'exclusive' as const,
      items: [],
      openSequence: ['closed', 'half', 'open']
    }
    expect(mouthPartFor(group, 'amplitude', 'a')).toBe('open')
    expect(mouthPartFor(group, 'amplitude', 'i')).toBe('half')
    expect(mouthPartFor(group, 'amplitude', 'pau')).toBe('closed')
    expect(mouthPartFor({ ...group, openSequence: ['closed', 'open'] }, 'amplitude', 'i')).toBe('open')
  })
})

describe('まばたき', () => {
  const blink = { partGroupId: 'g', intervalMs: 4000, jitterMs: 1500, closeDurationMs: 150 }
  const sequence = ['open', 'half', 'closed']

  it('同じシードなら同じ瞬間にまばたきし、シードが違えばずれる', () => {
    const sample = (seed: number): (string | null)[] =>
      Array.from({ length: 2000 }, (_, index) => blinkPartAt(seed, 'chr_1', blink, sequence, index * 10))
    expect(sample(1)).toEqual(sample(1))
    expect(sample(1)).not.toEqual(sample(2))
  })

  it('開 → 半目 → 閉 → 半目 の順に動き、まばたきの間隔はおおむね設定どおり', () => {
    const states = Array.from({ length: 60_000 }, (_, time) => blinkPartAt(7, 'chr_1', blink, sequence, time))
    const starts = states.flatMap((state, time) => (state !== null && states[time - 1] === null ? [time] : []))
    expect(starts.length).toBeGreaterThan(10)
    const gaps = starts.slice(1).map((start, index) => start - starts[index]!)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(4000 - 1500 - 1)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(4000 + 1500 + 1)
    const first = starts[0]!
    const order = states.slice(first, first + 150).filter((state, index, all) => state !== all[index - 1])
    expect(order).toEqual(['half', 'closed', 'half'])
  })
})

describe('立ち絵の描画', () => {
  const canvasSize = { width: 200, height: 300 }

  function projectWithPortrait(): { project: Project; characterId: string; config: PortraitConfig } {
    let project = createEmptyProject({ renderSeed: 42 })
    project = { ...project, canvas: { ...project.canvas, ...canvasSize } }
    const { config } = inferPortraitConfig(manifest, 'ast_psd', canvasSize, 0)
    const placed: PortraitConfig = { ...config, transform: { x: 0, y: 0, scale: 1, flipX: false, anchor: 'top-left' } }
    project = apply(project, [
      {
        op: 'asset.add',
        asset: {
          type: 'psd',
          path: { absolute: psdPath, relative: null },
          license: { source: 'テスト', creditRequired: false }
        },
        tempId: 'psd'
      },
      { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん', tempId: 'chr' }
    ])
    const assetId = Object.keys(project.assets)[0]!
    const characterId = Object.keys(project.characters)[0]!
    const portrait = { ...placed, assetId }
    project = apply(project, [{ op: 'character.setPortrait', characterId, portrait }])
    return { project, characterId, config: portrait }
  }

  async function render(project: Project, timeMs: number): Promise<(point: readonly [number, number]) => number[]> {
    const resources = new NodeRenderResources()
    await resources.addPsd(Object.keys(project.assets)[0]!, manifest)
    const canvas = createCanvas(project.canvas.width, project.canvas.height)
    const context = canvas.getContext('2d')
    renderFrame(context as unknown as Ctx2D, project, timeMs, resources)
    return ([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3))
  }

  function speaking(project: Project, characterId: string, expressionId: string | null = null): Project {
    const synthesis: SynthesisResult = {
      cacheKey: 'k',
      audioDurationMs: 1000,
      accentPhrases: [],
      lipSync: [
        { atMs: 0, vowel: 'pau' },
        { atMs: 100, vowel: 'a' },
        { atMs: 300, vowel: 'i' },
        { atMs: 500, vowel: 'pau' }
      ]
    }
    let next = apply(project, [
      { op: 'voice.insert', characterId, text: 'あい', atMs: 10_000, tempId: 'line', ...(expressionId ? { expressionId } : {}) }
    ])
    const lineId = next.items.find((item) => item.type === 'voice')!.id
    next = apply(next, [{ op: 'voice.applySynthesis', itemId: lineId, expectedText: 'あい', synthesis }])
    return next
  }

  /** まばたきしていない時刻を探す(色の確認がまばたきと重ならないように)。 */
  function openEyeTime(project: Project, config: PortraitConfig, characterId: string, around: number): number {
    const eye = config.partGroups[config.blink!.partGroupId]!
    for (let time = around; time < around + 10_000; time += 10) {
      const selections = portraitSelections(project, project.characters[characterId]!, config, time)
      if (selections[eye.id] === eye.blinkSequence![0]) return time
    }
    throw new Error('まばたきしていない時刻が見つかりません')
  }

  it('既定の表情で、口を閉じ、目を開いて描く', async () => {
    const { project, characterId, config } = projectWithPortrait()
    const pixel = await render(project, openEyeTime(project, config, characterId, 0))
    expect(pixel(POINTS.body)).toEqual([...COLORS.body])
    expect(pixel(POINTS.eye)).toEqual([...COLORS.eyeOpen])
    expect(pixel(POINTS.mouth)).toEqual([...COLORS.mouth.n])
    expect(pixel(POINTS.brow)).toEqual([...COLORS.browNormal])
    // 非表示のメガネは描かない
    expect(pixel(POINTS.glasses)).toEqual([...COLORS.body])
  })

  it('クリッピングされた乗算の影は、からだの上にだけ暗く重なる', async () => {
    const { project, characterId, config } = projectWithPortrait()
    const pixel = await render(project, openEyeTime(project, config, characterId, 0))
    const shadow = pixel(POINTS.shadow)
    expect(shadow[0]).toBeGreaterThan(40)
    expect(shadow[0]).toBeLessThan(60)
  })

  it('マスクで隠れた部分は描かない', async () => {
    const { project, characterId, config } = projectWithPortrait()
    const pixel = await render(project, openEyeTime(project, config, characterId, 0))
    expect(pixel(POINTS.cheekLeft)).toEqual([...COLORS.cheek])
    expect(pixel(POINTS.cheekRight)).toEqual([...COLORS.body])
  })

  it('しゃべっている間は母音に合わせて口が動く', async () => {
    const { project, characterId } = projectWithPortrait()
    const talking = speaking(project, characterId)
    expect((await render(talking, 10_150))(POINTS.mouth)).toEqual([...COLORS.mouth.a])
    expect((await render(talking, 10_350))(POINTS.mouth)).toEqual([...COLORS.mouth.i])
    expect((await render(talking, 10_600))(POINTS.mouth)).toEqual([...COLORS.mouth.n])
  })

  it('セリフに表情を付けると、その間だけ眉が変わる', async () => {
    const { project, characterId, config } = projectWithPortrait()
    const brow = Object.values(config.partGroups).find((group) => group.role === 'eyebrow')!
    const angryId = brow.items.find((item) => item.name === '怒り')!.id
    const withAngry: PortraitConfig = {
      ...config,
      expressions: {
        ...config.expressions,
        exp_angry: { id: 'exp_angry', name: '怒り', selections: { ...config.expressions['exp_normal']!.selections, [brow.id]: angryId } }
      }
    }
    let next = apply(project, [{ op: 'character.setPortrait', characterId, portrait: withAngry }])
    next = speaking(next, characterId, 'exp_angry')
    expect((await render(next, 10_150))(POINTS.brow)).toEqual([...COLORS.browAngry])
    expect((await render(next, 12_000))(POINTS.brow)).toEqual([...COLORS.browNormal])
  })

  it('まばたきの瞬間は閉じた目を描き、同じ時刻なら何度描いても同じ', async () => {
    const { project, characterId, config } = projectWithPortrait()
    const eye = config.partGroups[config.blink!.partGroupId]!
    const closedId = eye.blinkSequence!.at(-1)
    let closedAt = -1
    for (let time = 0; time < 20_000; time += 5) {
      if (portraitSelections(project, project.characters[characterId]!, config, time)[eye.id] === closedId) {
        closedAt = time
        break
      }
    }
    expect(closedAt).toBeGreaterThan(0)
    const first = await render(project, closedAt)
    const second = await render(project, closedAt)
    expect(first(POINTS.eye)).toEqual([...COLORS.eyeClosed])
    expect(second(POINTS.eye)).toEqual(first(POINTS.eye))
  })

  it('非表示のレイヤーも、設定で表示にできる', async () => {
    const { project, characterId, config } = projectWithPortrait()
    const next = apply(project, [
      { op: 'character.setPortrait', characterId, portrait: { ...config, layerVisibility: { メガネ: true } } }
    ])
    const pixel = await render(next, openEyeTime(next, config, characterId, 0))
    expect(pixel(POINTS.glasses)).toEqual([...COLORS.glasses])
  })

  it('使われている PSD の素材は外せない', () => {
    const { project } = projectWithPortrait()
    expect(() => apply(project, [{ op: 'asset.remove', assetId: Object.keys(project.assets)[0]! }])).toThrow(/使われている/)
  })
})
