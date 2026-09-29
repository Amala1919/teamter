import { PROJECT_FORMAT_VERSION, type Layer, type Project, type SubtitleStyle } from './types'

export const DEFAULT_LAYER_IDS = {
  background: 'lyr_bg',
  zoom: 'lyr_zoom',
  portrait: 'lyr_portrait',
  voice: 'lyr_voice',
  bgm: 'lyr_bgm'
} as const

export const DEFAULT_SUBTITLE_STYLE_ID = 'sty_default'

function defaultLayers(): Layer[] {
  return [
    { id: DEFAULT_LAYER_IDS.background, name: '背景', index: 0, visible: true, locked: false, muted: false },
    // ズームはこのレイヤーより下(ゲーム映像)だけを拡大するので、立ち絵と字幕は動かない。
    { id: DEFAULT_LAYER_IDS.zoom, name: 'ズーム', index: 1, visible: true, locked: false, muted: false },
    { id: DEFAULT_LAYER_IDS.portrait, name: '立ち絵', index: 2, visible: true, locked: false, muted: false },
    { id: DEFAULT_LAYER_IDS.voice, name: 'ボイス', index: 3, visible: true, locked: false, muted: false },
    { id: DEFAULT_LAYER_IDS.bgm, name: 'BGM', index: 4, visible: true, locked: false, muted: false }
  ]
}

function defaultSubtitleStyle(): SubtitleStyle {
  return {
    id: DEFAULT_SUBTITLE_STYLE_ID,
    name: '標準',
    fontFamily: 'Noto Sans JP',
    fontWeight: 700,
    fontSizePx: 64,
    color: '#ffffff',
    outline: { color: '#1b1b1b', widthPx: 8 },
    shadow: { color: '#00000080', offsetX: 4, offsetY: 4, blurPx: 4 },
    position: { anchor: 'bottom-center', x: 960, y: 980 },
    maxCharsPerLine: 22,
    lineHeight: 1.2
  }
}

export interface CreateProjectOptions {
  title?: string
  width?: number
  height?: number
  fps?: number
  renderSeed?: number
  now?: Date
}

export function createEmptyProject(options: CreateProjectOptions = {}): Project {
  const now = (options.now ?? new Date()).toISOString()
  const width = options.width ?? 1920
  const height = options.height ?? 1080
  const style = defaultSubtitleStyle()
  style.position = { anchor: 'bottom-center', x: Math.round(width / 2), y: height - 100 }

  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    meta: {
      title: options.title ?? '無題のプロジェクト',
      createdAt: now,
      updatedAt: now,
      renderSeed: options.renderSeed ?? Math.floor(Math.random() * 2 ** 31)
    },
    canvas: {
      width,
      height,
      fps: options.fps ?? 30,
      backgroundColor: '#000000'
    },
    characters: {},
    subtitleStyles: { [style.id]: style },
    assets: {},
    layers: defaultLayers(),
    items: [],
    liveSessions: {},
    credits: { generated: '', confirmedByUser: false },
    chat: { messages: [] },
    ai: { conversation: null },
    editing: { defaultGapMs: 200, duckVolume: 0.35, duckFadeMs: 200 }
  }
}
