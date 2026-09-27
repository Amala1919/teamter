import type { AccentPhrase } from '../project/types'

/**
 * アクセント句を AquesTalk 風のカタカナ表記にする(VOICEVOX の kana と同じ書き方)。
 * 読み方を直すとき、今の読みを出発点として見せるために使う。
 *
 *   コンニチワ'/ズンダモン'デス    … / は区切り(間を空けない)、' はアクセントの位置
 *   ソ'レデ、ハジメマ'ス          … 、 は間を空ける区切り
 *   _キ は無声化、末尾の ？ は疑問の上げ調子
 */
export function accentPhrasesToKana(phrases: readonly AccentPhrase[]): string {
  return phrases
    .map((phrase, index) => {
      const body = phrase.moras
        .map((mora, position) => `${isUnvoiced(mora.vowel) ? '_' : ''}${mora.text}${position + 1 === phrase.accent ? "'" : ''}`)
        .join('')
      const question = phrase.isInterrogative ? '？' : ''
      const separator = index === phrases.length - 1 ? '' : phrase.pauseMora ? '、' : '/'
      return `${body}${question}${separator}`
    })
    .join('')
}

function isUnvoiced(vowel: string): boolean {
  return ['A', 'I', 'U', 'E', 'O'].includes(vowel)
}
