import { describe, expect, it } from 'vitest'

import { applyCommands } from '@shared/commands/apply'
import { previewPlan } from '@shared/media/preview'
import { createEmptyProject } from '@shared/project/factory'
import type { Project, VideoAsset } from '@shared/project/types'
import { defaultSettings, mergeSettings } from '@shared/settings/schema'


const ctx = (() => {
  let counter = 0
  return { newId: (prefix: string) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }
})()

describe('プレビューの画質', () => {
  it('自動・元の画質・高さの上限で、元のファイルを使うか軽い動画を作るかを決める', () => {
    // 自動: そのまま再生できれば元のファイル、できなければ設定の高さ
    expect(previewPlan('auto', 1080, true)).toEqual({ direct: true })
    expect(previewPlan('auto', 1080, false)).toEqual({ direct: false })
    // 元の画質: 再生できなければ元の大きさのまま変換
    expect(previewPlan('original', 1440, true)).toEqual({ direct: true })
    expect(previewPlan('original', 1440, false)).toEqual({ direct: false, maxHeight: 0 })
    // 高さ: 元がそれ以下で再生できれば元のまま、大きければその高さに下げる
    expect(previewPlan(720, 720, true)).toEqual({ direct: true })
    expect(previewPlan(720, 2160, true)).toEqual({ direct: false, maxHeight: 720 })
    expect(previewPlan(1080, 720, false)).toEqual({ direct: false, maxHeight: 1080 })
  })

  it('動画ごとに変えられ、自動に戻すと項目が消える(以前のプロジェクトと同じ形)', () => {
    let project: Project = applyCommands(
      createEmptyProject(),
      [
        {
          op: 'asset.add',
          asset: { type: 'video', path: { absolute: '/rec/a.mkv', relative: null }, license: { source: '自分で録画', creditRequired: false }, durationMs: 10_000, width: 1920, height: 1080, fps: 60, hasAudio: true, preview: 720 },
          tempId: 'v'
        },
        { op: 'asset.add', asset: { type: 'audio', path: { absolute: '/bgm.mp3', relative: null }, license: { source: 'x', creditRequired: false }, durationMs: 1000 }, tempId: 'a' }
      ],
      ctx
    ).project
    const [videoId, audioId] = Object.keys(project.assets)
    expect((project.assets[videoId!] as VideoAsset).preview).toBe(720)
    project = applyCommands(project, [{ op: 'asset.setPreview', assetId: videoId!, preview: 'original' }], ctx).project
    expect((project.assets[videoId!] as VideoAsset).preview).toBe('original')
    project = applyCommands(project, [{ op: 'asset.setPreview', assetId: videoId!, preview: 'auto' }], ctx).project
    expect('preview' in project.assets[videoId!]!).toBe(false)
    expect(() => applyCommands(project, [{ op: 'asset.setPreview', assetId: audioId!, preview: 720 }], ctx)).toThrow('動画の素材にだけ')
    expect(() => applyCommands(project, [{ op: 'asset.setPreview', assetId: videoId!, preview: 999 as 720 }], ctx)).toThrow('画質が不正')
  })

  it('読み込むときの既定の画質は設定に残る', () => {
    expect(defaultSettings().media.previewResolution).toBe('auto')
    expect(mergeSettings(defaultSettings(), { media: { previewResolution: 1080 } }).media.previewResolution).toBe(1080)
  })
})
