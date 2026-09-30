import { useState } from 'react'

import type { Ctx2D } from '@shared/render/types'

/** よく使われる日本語フォント。入っていないフォントは、見本で代わりのフォントになる。 */
export const COMMON_FONTS = [
  'Noto Sans JP',
  'M PLUS Rounded 1c',
  'BIZ UDPゴシック',
  'UD デジタル 教科書体 N-B',
  'Yu Gothic UI',
  '游ゴシック',
  'メイリオ',
  'MS Pゴシック',
  'Hiragino Sans',
  'けいふぉんと',
  'コーポレート・ロゴ',
  'やさしさゴシック',
  '源ノ角ゴシック'
]

/** 文字の太さの選択肢。 */
export const FONT_WEIGHTS: [number, string][] = [
  [400, '標準'],
  [700, '太字'],
  [900, '極太']
]

/** フォントの候補。load を呼ぶと PC に入っているフォントも足す(使える環境だけ)。 */
export function useFontList(): { fonts: string[]; load: () => void } {
  const [fonts, setFonts] = useState<string[]>(COMMON_FONTS)
  const load = (): void => {
    const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
    if (!query) return
    query()
      .then((list) => setFonts([...new Set([...COMMON_FONTS, ...list.map((font) => font.family)])].sort((a, b) => a.localeCompare(b, 'ja'))))
      .catch(() => undefined)
  }
  return { fonts, load }
}

let measure: Ctx2D | null = null

/** 文字の幅を測るための描画先(画面には出さない)。 */
export function measureContext(): Ctx2D {
  measure ??= document.createElement('canvas').getContext('2d') as unknown as Ctx2D
  return measure
}
