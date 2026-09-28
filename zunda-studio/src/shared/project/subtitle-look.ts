import type { SubtitleStyle } from './types'

/**
 * 字幕の見た目(名前と ID を除いたスタイル)。アプリの既定として設定に保存し、新しいキャラクター・プロジェクトに使う。
 */
export type SubtitleLook = Omit<SubtitleStyle, 'id' | 'name'>

export function subtitleLook(style: SubtitleStyle): SubtitleLook {
  const { id: _id, name: _name, ...look } = style
  return JSON.parse(JSON.stringify(look)) as SubtitleLook
}

/**
 * 新しいキャラクターの字幕スタイル。
 * アプリの既定が無ければ、これまでどおり縁取りの色だけをキャラクターごとに変える。
 * 既定があればそれを使い、perCharacterOutline なら縁取りの色だけキャラクターの色にする(誰のセリフか見分けやすいように)。
 */
export function lookForCharacter(defaults: SubtitleLook | null, outlineColor: string, perCharacterOutline: boolean): Partial<SubtitleLook> {
  if (!defaults) return { outline: { color: outlineColor, widthPx: 8 } }
  const look = JSON.parse(JSON.stringify(defaults)) as SubtitleLook
  if (look.outline && perCharacterOutline) look.outline = { ...look.outline, color: outlineColor }
  return look
}

/**
 * 字幕の置き場所の定番。字幕は指定した点を最後の行の下端として上へ積むので、y は最後の行の下端。
 * 揃え方(anchor)は、左・中央・右のどこに点があるかを表す。
 */
export function subtitlePresets(width: number, height: number): { id: string; label: string; position: SubtitleStyle['position'] }[] {
  const margin = Math.round(width * 0.04)
  const bottom = Math.round(height * 0.91)
  return [
    { id: 'bottom-center', label: '下・中央', position: { anchor: 'bottom-center', x: Math.round(width / 2), y: bottom } },
    { id: 'bottom-left', label: '下・左', position: { anchor: 'bottom-left', x: margin, y: bottom } },
    { id: 'bottom-right', label: '下・右', position: { anchor: 'bottom-right', x: width - margin, y: bottom } },
    { id: 'top-center', label: '上・中央', position: { anchor: 'bottom-center', x: Math.round(width / 2), y: Math.round(height * 0.14) } },
    { id: 'center', label: '画面の中央', position: { anchor: 'bottom-center', x: Math.round(width / 2), y: Math.round(height * 0.55) } }
  ]
}
