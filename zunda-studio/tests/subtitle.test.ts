import { describe, expect, it } from 'vitest'

import { wrapSubtitle } from '@shared/project/subtitle'

describe('wrapSubtitle', () => {
  it('指定文字数で折り返す', () => {
    expect(wrapSubtitle('あいうえおかきくけこさしすせそ', 5)).toEqual([
      'あいうえお',
      'かきくけこ',
      'さしすせそ'
    ])
  })

  it('折り返す必要がなければそのまま返す', () => {
    expect(wrapSubtitle('みじかい', 22)).toEqual(['みじかい'])
  })

  it('明示的な改行を尊重する', () => {
    expect(wrapSubtitle('いちぎょうめ\nにぎょうめ', 22)).toEqual(['いちぎょうめ', 'にぎょうめ'])
  })

  it('句点だけが行頭に残らないようにする', () => {
    // 5文字で折り返すと最後の行が「。」だけになるため、前の行に付ける
    expect(wrapSubtitle('あいうえおかきくけこ。', 5)).toEqual(['あいうえお', 'かきくけこ。'])
  })

  it('開き括弧が行末に残らないようにする', () => {
    const lines = wrapSubtitle('あいうえ「かきくけこ', 5)
    expect(lines[0]).toBe('あいうえ')
    expect(lines[1]).toBe('「かきくけこ')
  })

  it('行の途中の折り返しでも、小さい「ょ」や句読点を行頭に置かない', () => {
    expect(wrapSubtitle('いちぎょうめ', 3)).toEqual(['いちぎょ', 'うめ'])
    expect(wrapSubtitle('あいう、えおかきく', 3)).toEqual(['あいう、', 'えおか', 'きく'])
  })

  it('1文字だけの行を作らない(1文字の超過を許す)', () => {
    expect(wrapSubtitle('あいうえおか', 5)).toEqual(['あいうえおか'])
  })

  it('折り返し幅が不正なら分割しない', () => {
    expect(wrapSubtitle('あいうえお', 0)).toEqual(['あいうえお'])
  })
})

describe('全角の記号', () => {
  it('全角の「！」「？」も行頭に置かない', () => {
    expect(wrapSubtitle('すごいのだ！？', 5)).toEqual(['すごいのだ！？'])
    expect(wrapSubtitle('いくのだ！ほんとに', 4)).toEqual(['いくのだ！', 'ほんとに'])
  })
})
