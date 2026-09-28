import { lookForCharacter, type SubtitleLook } from '@shared/project/subtitle-look'

import { useSettingsStore } from './settings'

/**
 * 字幕の見た目のアプリの既定(設定 → subtitle)を、新しいキャラクター・プロジェクトに当てるための入口。
 * 設定がまだ読み込まれていなければ、組み込みの既定のまま(縁取りの色だけキャラクターごと)にする。
 */
export function characterLook(outlineColor: string): Partial<SubtitleLook> {
  const subtitle = useSettingsStore.getState().settings?.subtitle
  return lookForCharacter(subtitle?.defaults ?? null, outlineColor, subtitle?.characterOutlineColors ?? true)
}

/** 新しいプロジェクトの「標準」の字幕スタイルに使う見た目。既定が無ければ null。 */
export function projectLook(): SubtitleLook | null {
  return useSettingsStore.getState().settings?.subtitle.defaults ?? null
}
