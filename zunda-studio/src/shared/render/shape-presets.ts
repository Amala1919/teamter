/**
 * 装飾のひな形。選ぶと、形・色・縁取り・影・動きをまとめて付けた図形を置く。
 * 置いたあとはインスペクタで何でも変えられる(ひな形は出発点)。
 */

import type { Effect, Ms, ShapeKind, ShapeProps, SubtitleShadow } from '../project/types'

export type ShapePresetCategory = 'point' | 'bubble' | 'emphasis' | 'banner' | 'basic'

export const SHAPE_PRESET_CATEGORIES: { id: ShapePresetCategory; label: string }[] = [
  { id: 'point', label: '囲む・指す' },
  { id: 'bubble', label: '吹き出し' },
  { id: 'emphasis', label: '強調・演出' },
  { id: 'banner', label: '帯・枠・パネル' },
  { id: 'basic', label: '図形' }
]

export interface ShapePreset {
  id: string
  name: string
  category: ShapePresetCategory
  shape: ShapeKind
  fill: string
  props: ShapeProps
  effects?: Effect[]
  /** 置くときの長さ。 */
  durationMs: Ms
  /** 画面全体を覆うもの(置く位置は画面の中央)。 */
  fullScreen?: boolean
  /** テロップを重ねて使うもの(吹き出し・帯)。置いたあとテロップも足すか聞く。 */
  withText?: boolean
}

const WHITE_EDGE = { color: '#ffffff', widthPx: 6 }
const DARK_EDGE = { color: '#1b1b1b', widthPx: 6 }
const DROP = { color: '#00000088', offsetX: 6, offsetY: 8, blurPx: 10 }
const glow = (color: string): SubtitleShadow => ({ color, offsetX: 0, offsetY: 0, blurPx: 28 })

export const SHAPE_PRESETS: ShapePreset[] = [
  // ---------------------------------------------------------------- 囲む・指す
  {
    id: 'red-circle',
    name: '赤丸で囲む(手書き)',
    category: 'point',
    shape: 'handCircle',
    fill: '#ff2d2d',
    props: { width: 420, height: 300, thickness: 12, drawMs: 450, roughness: 0.45, outerStroke: null, stroke: { color: '#ffffff', widthPx: 3 }, shadow: DROP },
    durationMs: 3000
  },
  {
    id: 'yellow-circle-wiggle',
    name: '黄色の丸(ゆらゆら)',
    category: 'point',
    shape: 'handCircle',
    fill: '#ffe14d',
    props: { width: 380, height: 380, thickness: 14, drawMs: 400, roughness: 0.4, wiggle: true, stroke: { color: '#1b1b1b', widthPx: 4 } },
    durationMs: 3000
  },
  {
    id: 'arrow-red',
    name: '矢印(伸びる)',
    category: 'point',
    shape: 'arrow',
    fill: '#ff3b30',
    props: { width: 420, height: 150, drawMs: 300, stroke: WHITE_EDGE, gradient: { color: '#c1121f', angle: 90, radial: false }, shadow: DROP },
    durationMs: 3000
  },
  {
    id: 'arrow-yellow-pulse',
    name: '矢印(ドクンドクン)',
    category: 'point',
    shape: 'arrow',
    fill: '#ffd60a',
    props: { width: 360, height: 140, stroke: DARK_EDGE, outerStroke: { color: '#ffffff', widthPx: 4 }, shadow: DROP },
    effects: [{ type: 'pulse', amount: 0.08, periodMs: 600 }],
    durationMs: 3000
  },
  {
    id: 'curve-arrow',
    name: '曲がった矢印(手書き)',
    category: 'point',
    shape: 'curveArrow',
    fill: '#ff2d2d',
    props: { width: 460, height: 220, thickness: 14, bend: 0.5, drawMs: 450, roughness: 0.3, stroke: { color: '#ffffff', widthPx: 3 } },
    durationMs: 3000
  },
  {
    id: 'focus-frame',
    name: '注目の枠(点滅)',
    category: 'point',
    shape: 'roundRect',
    fill: '#ffe14d',
    props: { width: 520, height: 320, fillOpacity: 0, stroke: { color: '#ffe14d', widthPx: 10 }, cornerRadius: 24, shadow: glow('#ffd60a') },
    effects: [{ type: 'blink', periodMs: 500, minOpacity: 0.15 }],
    durationMs: 2500
  },
  {
    id: 'corners',
    name: 'カギ枠(ロックオン)',
    category: 'point',
    shape: 'corners',
    fill: '#00e5ff',
    props: { width: 520, height: 340, thickness: 10, shadow: glow('#00e5ff') },
    effects: [{ type: 'transition', in: { kind: 'zoom', durationMs: 300 }, out: { kind: 'fade', durationMs: 200 } }],
    durationMs: 2500
  },
  {
    id: 'marker',
    name: 'マーカー線',
    category: 'point',
    shape: 'line',
    fill: '#ffe14d',
    props: { width: 520, height: 40, thickness: 34, fillOpacity: 0.55, drawMs: 350 },
    effects: [],
    durationMs: 3000
  },
  {
    id: 'wave-underline',
    name: '波線の下線',
    category: 'point',
    shape: 'wave',
    fill: '#ff3b30',
    props: { width: 520, height: 50, thickness: 8, drawMs: 400 },
    durationMs: 3000
  },
  {
    id: 'check',
    name: 'チェック(正解)',
    category: 'point',
    shape: 'check',
    fill: '#2fbf71',
    props: { width: 260, height: 220, thickness: 28, drawMs: 350, stroke: WHITE_EDGE, shadow: DROP },
    durationMs: 2000
  },
  {
    id: 'big-o',
    name: '大きな◯',
    category: 'point',
    shape: 'ellipse',
    fill: '#ff2d2d',
    props: { width: 420, height: 420, fillOpacity: 0, stroke: { color: '#ff2d2d', widthPx: 34 }, drawMs: 400, shadow: DROP },
    durationMs: 2000
  },
  {
    id: 'big-x',
    name: '大きな✕',
    category: 'point',
    shape: 'cross',
    fill: '#1e5bd8',
    props: { width: 380, height: 380, thickness: 40, drawMs: 350, stroke: WHITE_EDGE, shadow: DROP },
    durationMs: 2000
  },

  // ---------------------------------------------------------------- 吹き出し
  {
    id: 'bubble-white',
    name: '吹き出し(白)',
    category: 'bubble',
    shape: 'bubble',
    fill: '#ffffff',
    props: { width: 560, height: 240, stroke: { color: '#222222', widthPx: 5 }, tail: { x: -140, y: 200 }, shadow: DROP },
    effects: [{ type: 'transition', in: { kind: 'pop', durationMs: 300 }, out: { kind: 'fade', durationMs: 200 } }],
    durationMs: 3000,
    withText: true
  },
  {
    id: 'shout-yellow',
    name: '叫び(ギザギザ)',
    category: 'bubble',
    shape: 'shout',
    fill: '#ffe14d',
    props: { width: 620, height: 340, stroke: { color: '#d62828', widthPx: 7 }, tail: { x: -180, y: 260 }, gradient: { color: '#ffb703', angle: 90, radial: false } },
    effects: [
      { type: 'transition', in: { kind: 'pop', durationMs: 250 }, out: null },
      { type: 'shake', amplitudePx: 10, frequencyHz: 20, durationMs: 400 }
    ],
    durationMs: 2500,
    withText: true
  },
  {
    id: 'cloud',
    name: '考え中(もくもく)',
    category: 'bubble',
    shape: 'cloud',
    fill: '#ffffff',
    props: { width: 560, height: 300, stroke: { color: '#555555', widthPx: 4 }, tail: { x: -200, y: 230 }, shadow: DROP },
    effects: [
      { type: 'transition', in: { kind: 'fade', durationMs: 300 }, out: { kind: 'fade', durationMs: 300 } },
      { type: 'float', amplitudePx: 6, periodMs: 2000 }
    ],
    durationMs: 3000,
    withText: true
  },
  {
    id: 'bubble-dark',
    name: '吹き出し(黒・半透明)',
    category: 'bubble',
    shape: 'bubble',
    fill: '#111111',
    props: { width: 560, height: 220, fillOpacity: 0.78, tail: { x: 160, y: 190 }, stroke: { color: '#ffffff', widthPx: 3 } },
    effects: [{ type: 'transition', in: { kind: 'zoom', durationMs: 250 }, out: { kind: 'fade', durationMs: 200 } }],
    durationMs: 3000,
    withText: true
  },

  // ---------------------------------------------------------------- 強調・演出
  {
    id: 'focus-lines',
    name: '集中線',
    category: 'emphasis',
    shape: 'focusLines',
    fill: '#000000',
    props: { width: 1100, height: 640, fillOpacity: 0.85 },
    durationMs: 1500,
    fullScreen: true
  },
  {
    id: 'focus-lines-white',
    name: '集中線(白)',
    category: 'emphasis',
    shape: 'focusLines',
    fill: '#ffffff',
    props: { width: 1100, height: 640, fillOpacity: 0.9, density: 1.3 },
    durationMs: 1500,
    fullScreen: true
  },
  {
    id: 'speed-lines',
    name: '流線(スピード感)',
    category: 'emphasis',
    shape: 'speedLines',
    fill: '#ffffff',
    props: { width: 1920, height: 1080, fillOpacity: 0.7, density: 1.2, speed: 1.2 },
    durationMs: 2000,
    fullScreen: true
  },
  {
    id: 'spotlight',
    name: 'スポットライト',
    category: 'emphasis',
    shape: 'spotlight',
    fill: '#000000',
    props: { width: 560, height: 420, fillOpacity: 0.72, innerRatio: 0.3 },
    effects: [{ type: 'transition', in: { kind: 'fade', durationMs: 300 }, out: { kind: 'fade', durationMs: 300 } }],
    durationMs: 3000
  },
  {
    id: 'explosion',
    name: '爆発(ドーン)',
    category: 'emphasis',
    shape: 'burst',
    fill: '#ffd60a',
    props: { width: 560, height: 440, gradient: { color: '#ff5400', angle: 0, radial: true }, stroke: { color: '#9d0208', widthPx: 6 }, points: 16, innerRatio: 0.62 },
    effects: [
      { type: 'transition', in: { kind: 'pop', durationMs: 220 }, out: { kind: 'zoom', durationMs: 250 } },
      { type: 'shake', amplitudePx: 14, frequencyHz: 22, durationMs: 500 }
    ],
    durationMs: 1500
  },
  {
    id: 'star-spin',
    name: 'キラッと星',
    category: 'emphasis',
    shape: 'star',
    fill: '#fff3b0',
    props: { width: 200, height: 200, points: 4, innerRatio: 0.22, shadow: glow('#ffd60a') },
    effects: [
      { type: 'transition', in: { kind: 'spin', durationMs: 350 }, out: { kind: 'fade', durationMs: 250 } },
      { type: 'pulse', amount: 0.12, periodMs: 800 }
    ],
    durationMs: 2000
  },
  {
    id: 'sparkles',
    name: 'キラキラ',
    category: 'emphasis',
    shape: 'sparkles',
    fill: '#fffbe6',
    props: { width: 700, height: 420, shadow: glow('#ffe066'), density: 1.2 },
    durationMs: 3000
  },
  {
    id: 'confetti',
    name: '紙吹雪(勝利!)',
    category: 'emphasis',
    shape: 'confetti',
    fill: '#ffd43b',
    props: { width: 1920, height: 1080, density: 1.2 },
    durationMs: 4000,
    fullScreen: true
  },
  {
    id: 'flash',
    name: 'フラッシュ(画面が光る)',
    category: 'emphasis',
    shape: 'rect',
    fill: '#ffffff',
    props: { width: 1920, height: 1080 },
    effects: [{ type: 'fade', inMs: 0, outMs: 400 }],
    durationMs: 450,
    fullScreen: true
  },
  {
    id: 'heart',
    name: 'ハート(ドキドキ)',
    category: 'emphasis',
    shape: 'heart',
    fill: '#ff4d6d',
    props: { width: 260, height: 240, stroke: WHITE_EDGE, gradient: { color: '#c9184a', angle: 90, radial: false }, shadow: DROP },
    effects: [
      { type: 'transition', in: { kind: 'pop', durationMs: 300 }, out: { kind: 'fade', durationMs: 200 } },
      { type: 'pulse', amount: 0.1, periodMs: 700 }
    ],
    durationMs: 2500
  },

  // ---------------------------------------------------------------- 帯・枠・パネル
  {
    id: 'lower-third',
    name: '下の帯(名前・説明)',
    category: 'banner',
    shape: 'band',
    fill: '#1e5bd8',
    props: { width: 960, height: 110, gradient: { color: '#00b4d8', angle: 0, radial: false }, shadow: DROP, drawMs: 350 },
    effects: [{ type: 'transition', in: null, out: { kind: 'wipeLeft', durationMs: 300 } }],
    durationMs: 4000,
    withText: true
  },
  {
    id: 'red-band',
    name: '赤い帯(速報風)',
    category: 'banner',
    shape: 'band',
    fill: '#d62828',
    props: { width: 1100, height: 120, stroke: { color: '#ffffff', widthPx: 4 }, drawMs: 300 },
    durationMs: 4000,
    withText: true
  },
  {
    id: 'glass-panel',
    name: '半透明のパネル',
    category: 'banner',
    shape: 'roundRect',
    fill: '#0b132b',
    props: { width: 760, height: 420, fillOpacity: 0.72, cornerRadius: 28, stroke: { color: '#ffffff55', widthPx: 2 }, shadow: DROP },
    effects: [{ type: 'transition', in: { kind: 'fade', durationMs: 250 }, out: { kind: 'fade', durationMs: 250 } }],
    durationMs: 4000,
    withText: true
  },
  {
    id: 'neon-frame',
    name: 'ネオンの枠',
    category: 'banner',
    shape: 'roundRect',
    fill: '#ff4dff',
    props: { width: 760, height: 430, fillOpacity: 0, stroke: { color: '#ff7bff', widthPx: 8 }, cornerRadius: 20, shadow: glow('#ff00ff') },
    effects: [{ type: 'blink', periodMs: 1600, minOpacity: 0.6 }],
    durationMs: 4000
  },
  {
    id: 'dotted-frame',
    name: '点線の枠',
    category: 'banner',
    shape: 'roundRect',
    fill: '#ffffff',
    props: { width: 600, height: 360, fillOpacity: 0, dash: 'dot', stroke: { color: '#ffffff', widthPx: 8 }, cornerRadius: 18 },
    durationMs: 3000
  },

  // ---------------------------------------------------------------- 図形
  { id: 'rect', name: '四角', category: 'basic', shape: 'rect', fill: '#3a86ff', props: { width: 400, height: 260, stroke: WHITE_EDGE, shadow: DROP }, durationMs: 3000 },
  { id: 'round-rect', name: '角丸の四角', category: 'basic', shape: 'roundRect', fill: '#8338ec', props: { width: 400, height: 260, cornerRadius: 40, shadow: DROP }, durationMs: 3000 },
  { id: 'circle', name: '円', category: 'basic', shape: 'ellipse', fill: '#ff006e', props: { width: 320, height: 320, gradient: { color: '#8338ec', angle: 45, radial: false }, shadow: DROP }, durationMs: 3000 },
  { id: 'triangle', name: '三角', category: 'basic', shape: 'triangle', fill: '#fb5607', props: { width: 300, height: 260, stroke: WHITE_EDGE }, durationMs: 3000 },
  { id: 'diamond', name: 'ひし形', category: 'basic', shape: 'diamond', fill: '#ffbe0b', props: { width: 280, height: 280, stroke: DARK_EDGE }, durationMs: 3000 },
  { id: 'star', name: '星', category: 'basic', shape: 'star', fill: '#ffd60a', props: { width: 300, height: 300, stroke: { color: '#e85d04', widthPx: 6 }, shadow: DROP }, durationMs: 3000 }
]

export function shapePreset(id: string): ShapePreset | undefined {
  return SHAPE_PRESETS.find((preset) => preset.id === id)
}
