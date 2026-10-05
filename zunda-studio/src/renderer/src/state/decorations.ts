import type { Command } from '@shared/commands/types'
import { DEFAULT_LAYER_IDS } from '@shared/project/factory'
import type { Ms, Project, ShapeProps, TextLook } from '@shared/project/types'
import type { ShapePreset } from '@shared/render/shape-presets'

import { useEditorStore } from './store'

/** 装飾を置くレイヤーの名前。ゲーム映像と一緒に拡大されるよう、ズームのレイヤーより下に作る。 */
export const DECORATION_LAYER_NAME = '装飾'

/** ひな形の大きさは 1920×1080 の画面を基準に決めてある。今の画面の大きさに合わせる倍率。 */
function presetScale(project: Project): number {
  return project.canvas.width / 1920
}

/** 吹き出し・帯に重ねる文字のレイヤーの名前(装飾のすぐ上)。 */
export const DECORATION_TEXT_LAYER_NAME = '装飾の文字'

/**
 * 装飾のレイヤーと、重ねる文字のレイヤー(無ければ作るコマンド)。
 * 文字を同じレイヤーに置くと重なりの振り分けでどちらが上に行くか決まらないので、文字は専用のレイヤーにする。
 */
function decorationLayers(project: Project, withText: boolean): { layerId: string; textLayerId: string; commands: Command[] } {
  const commands: Command[] = []
  const existing = project.layers.find((layer) => layer.name === DECORATION_LAYER_NAME)
  const background = project.layers.find((layer) => layer.id === DEFAULT_LAYER_IDS.background)
  const zoom = project.layers.find((layer) => layer.id === DEFAULT_LAYER_IDS.zoom)
  // 背景のすぐ上(ズームがあればその下)。
  const index = existing ? existing.index : zoom ? zoom.index : (background?.index ?? 0) + 1
  if (!existing) commands.push({ op: 'layer.insert', name: DECORATION_LAYER_NAME, index, tempId: 'deco-layer' })
  const textLayer = project.layers.find((layer) => layer.name === DECORATION_TEXT_LAYER_NAME)
  if (withText && !textLayer) commands.push({ op: 'layer.insert', name: DECORATION_TEXT_LAYER_NAME, index: index + 1, tempId: 'deco-text-layer' })
  return { layerId: existing?.id ?? 'deco-layer', textLayerId: textLayer?.id ?? 'deco-text-layer', commands }
}

/** 色の明るさ(0〜1)。吹き出しの文字の色を決めるのに使う。 */
function luminance(color: string): number {
  const hex = color.replace('#', '').slice(0, 6)
  const value = Number.parseInt(hex, 16)
  if (!Number.isFinite(value)) return 0
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** 吹き出し・帯の上に重ねるテロップの見た目(下地が明るければ黒い文字、暗ければ白い文字)。 */
function textLookOn(preset: ShapePreset, scale: number): TextLook {
  const light = luminance(preset.fill) > 0.6 && (preset.props.fillOpacity ?? 1) > 0.5
  return {
    color: light ? '#222222' : '#ffffff',
    fontWeight: 800,
    fontSizePx: Math.round((preset.shape === 'band' ? 56 : 52) * scale),
    outline: 'none',
    shadow: 'none',
    align: preset.shape === 'band' ? 'left' : 'center'
  }
}

/** ひな形の見た目を、画面の大きさに合わせて縮める(大きさ・太さ・しっぽの位置など)。 */
export function scaledPresetProps(preset: ShapePreset, project: Project): ShapeProps {
  const scale = preset.fullScreen ? 1 : presetScale(project)
  const props: ShapeProps = JSON.parse(JSON.stringify(preset.props)) as ShapeProps
  if (preset.fullScreen) {
    props.width = project.canvas.width
    props.height = project.canvas.height
    // 集中線などは、空ける真ん中の大きさを画面に合わせる。
    if (preset.props.width !== undefined && preset.props.width < 1920) {
      props.width = Math.round((preset.props.width * project.canvas.width) / 1920)
      props.height = Math.round(((preset.props.height ?? 0) * project.canvas.height) / 1080)
    }
    return props
  }
  if (scale === 1) return props
  if (props.width !== undefined) props.width = Math.round(props.width * scale)
  if (props.height !== undefined) props.height = Math.round(props.height * scale)
  if (props.thickness !== undefined) props.thickness = props.thickness * scale
  if (props.cornerRadius !== undefined) props.cornerRadius = props.cornerRadius * scale
  if (props.tail) props.tail = { x: props.tail.x * scale, y: props.tail.y * scale }
  for (const key of ['stroke', 'outerStroke'] as const) {
    const stroke = props[key]
    if (stroke) props[key] = { ...stroke, widthPx: Math.max(1, stroke.widthPx * scale) }
  }
  return props
}

/** 置いてから出きるまでの時間(登場の動き・描いていく時間)。 */
function settleMs(preset: ShapePreset): Ms {
  const entrance = (preset.effects ?? []).reduce((longest, effect) => (effect.type === 'transition' && effect.in ? Math.max(longest, effect.in.durationMs) : longest), 0)
  return Math.max(entrance, preset.props.drawMs ?? 0)
}

/**
 * 装飾を置く。point を渡すとそこを中心に、無ければ画面の中央に置く。置いたものを選んだ状態にする。
 * 吹き出し・帯はテロップも重ねて置き、一緒に動くようグループにする。
 */
export function placeDecoration(preset: ShapePreset, options: { atMs?: Ms; point?: { x: number; y: number } } = {}): string | null {
  const { project, playheadMs, dispatch, setSelection } = useEditorStore.getState()
  const atMs = Math.max(0, Math.round(options.atMs ?? playheadMs))
  const layer = decorationLayers(project, preset.withText === true)
  const center = preset.fullScreen || !options.point ? { x: project.canvas.width / 2, y: project.canvas.height / 2 } : options.point
  const props = scaledPresetProps(preset, project)
  const commands: Command[] = [
    ...layer.commands,
    {
      op: 'media.placeShape',
      shape: preset.shape,
      fill: preset.fill,
      atMs,
      durationMs: preset.durationMs,
      layerId: layer.layerId,
      transform: { x: Math.round(center.x), y: Math.round(center.y) },
      props,
      effects: preset.effects ?? [],
      tempId: 'deco'
    }
  ]
  if (preset.withText) {
    const scale = presetScale(project)
    const width = props.width ?? project.canvas.width
    // 帯は左寄せの文字を帯の左の方に置く。
    const textX = preset.shape === 'band' ? center.x - width * 0.18 : center.x
    commands.push(
      {
        op: 'media.placeText',
        text: preset.shape === 'band' ? '名前・説明' : 'セリフ',
        atMs,
        durationMs: preset.durationMs,
        layerId: layer.textLayerId,
        transform: { x: Math.round(textX), y: Math.round(center.y) },
        tempId: 'deco-text'
      },
      { op: 'item.setTextLook', itemIds: ['deco-text'], look: textLookOn(preset, scale), replace: true },
      // テロップも同じ出方にする(吹き出しだけ先に出て、文字が遅れて出ないように)。
      ...(preset.effects ?? [])
        .filter((effect) => effect.type === 'transition' || effect.type === 'fade' || effect.type === 'float' || effect.type === 'shake')
        .map((effect): Command => ({ op: 'item.addEffect', itemId: 'deco-text', effect })),
      { op: 'item.group', itemIds: ['deco', 'deco-text'] }
    )
  }
  const result = dispatch(commands, `装飾「${preset.name}」を置く`)
  if (!result.ok) return result.message
  const placed = [result.resolvedIds['deco'], result.resolvedIds['deco-text']].filter((id): id is string => id !== undefined)
  setSelection(placed.slice(0, 1))
  // 登場の動きや描いていく途中だと、置いた時刻ではまだ見えない。出きったところへ再生位置を動かして見せる。
  const settle = settleMs(preset)
  if (settle > 0) useEditorStore.getState().setPlayhead(atMs + Math.min(settle, preset.durationMs - 1))
  return null
}
