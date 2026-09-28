import { describe, expect, it } from 'vitest'

import { createEmptyProject, DEFAULT_SUBTITLE_STYLE_ID } from '@shared/project/factory'
import { lookForCharacter, subtitleLook, subtitlePresets } from '@shared/project/subtitle-look'
import { applySettingsPatch, defaultSettings, parseSettings } from '@shared/settings/schema'

const standard = createEmptyProject().subtitleStyles[DEFAULT_SUBTITLE_STYLE_ID]!

describe('字幕の見た目の既定', () => {
  it('既定が無ければ、これまでどおり縁取りの色だけキャラクターごとにする', () => {
    expect(lookForCharacter(null, '#2b7a0b', true)).toEqual({ outline: { color: '#2b7a0b', widthPx: 8 } })
  })

  it('既定があればそれを使い、縁取りの色はキャラクターごと(切れば既定の色)', () => {
    const look = { ...subtitleLook(standard), fontFamily: 'BIZ UDPゴシック', fontSizePx: 72, outline: { color: '#000000', widthPx: 10 } }
    expect(lookForCharacter(look, '#a0306a', true)).toMatchObject({ fontFamily: 'BIZ UDPゴシック', fontSizePx: 72, outline: { color: '#a0306a', widthPx: 10 } })
    expect(lookForCharacter(look, '#a0306a', false)).toMatchObject({ outline: { color: '#000000', widthPx: 10 } })
    // 縁取り無しの既定なら、キャラクターの色があっても縁取り無し
    expect(lookForCharacter({ ...look, outline: null }, '#a0306a', true).outline).toBeNull()
    // 元の既定は書き換えない
    expect(look.outline.color).toBe('#000000')
  })

  it('見た目には名前と ID を含めない', () => {
    const look = subtitleLook(standard)
    expect(look).not.toHaveProperty('id')
    expect(look).not.toHaveProperty('name')
    expect(look.fontSizePx).toBe(standard.fontSizePx)
  })

  it('設定に保存でき、壊れた既定は読み込み時に捨てる', () => {
    expect(defaultSettings().subtitle).toEqual({ defaults: null, characterOutlineColors: true })
    const look = { ...subtitleLook(standard), fontSizePx: 80 }
    const { settings, rejected } = applySettingsPatch(defaultSettings(), { subtitle: { defaults: look } })
    expect(rejected).toEqual([])
    expect(settings.subtitle.defaults).toMatchObject({ fontSizePx: 80 })
    // null で消せる
    expect(applySettingsPatch(settings, { subtitle: { defaults: null } }).settings.subtitle.defaults).toBeNull()
    // 大きさが範囲外の既定は受け付けない(更新前の値を保つ)
    expect(applySettingsPatch(settings, { subtitle: { defaults: { ...look, fontSizePx: 9999 } } }).rejected).toEqual(['subtitle'])
    expect(parseSettings({ subtitle: { defaults: { fontFamily: '' } } }).subtitle.defaults).toBeNull()
  })

  it('置き場所の定番は画面の中に収まる', () => {
    for (const preset of subtitlePresets(1920, 1080)) {
      expect(preset.position.x).toBeGreaterThanOrEqual(0)
      expect(preset.position.x).toBeLessThanOrEqual(1920)
      expect(preset.position.y).toBeGreaterThan(0)
      expect(preset.position.y).toBeLessThanOrEqual(1080)
    }
  })
})
