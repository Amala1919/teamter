import { mkdtempSync } from 'node:fs'
import { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EventBus } from '@main/core/events'
import { encodeFailure, ExportService } from '@main/services/export/export-service'
import { FfmpegLocator } from '@main/services/media/ffmpeg'
import { PsdService } from '@main/services/psd/psd-service'
import type { SynthesisService } from '@main/services/voice/synthesis-service'
import { applyCommands } from '@shared/commands/apply'
import { createEmptyProject } from '@shared/project/factory'
import { defaultSettings } from '@shared/settings/schema'

describe('書き出しのメモリ', () => {
  it('書き込みがその場で終わる環境(Windows のパイプなど)でも、コマの画素を溜め込まない', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zunda-export-memory-'))
    let counter = 0
    // 1920x1080 で 10 秒(300コマ)。溜め込むと 1コマ 8MB ずつ増え、2GB を超える
    const project = applyCommands(createEmptyProject(), [{ op: 'media.placeText', text: 'メモリ', atMs: 0, durationMs: 10_000 }], {
      newId: (prefix) => `${prefix}_${++counter}`,
      now: () => new Date('2026-01-01T00:00:00Z')
    }).project
    const settings = defaultSettings()
    const events = new EventBus()
    const baseline = process.memoryUsage().rss
    let peak = baseline
    events.listen(() => {
      peak = Math.max(peak, process.memoryUsage().rss)
    })
    const synthesis = { resolve: () => Promise.resolve(null) } as unknown as SynthesisService
    const exporter = new ExportService(new FfmpegLocator(() => settings), () => settings, events, new PsdService(join(directory, 'psd')), synthesis, join(directory, 'temp'))

    // ffmpeg への書き込みが同期で終わったように振る舞わせる(データは捨て、drain は nextTick で出す)。
    // このときイベントループが回らないと、@napi-rs/canvas の画素が解放されずに溜まる。
    const original = Socket.prototype.write
    Socket.prototype.write = function (this: Socket, ...args: unknown[]) {
      const callback = args.find((arg) => typeof arg === 'function') as ((error?: Error | null) => void) | undefined
      process.nextTick(() => {
        callback?.(null)
        this.emit('drain')
      })
      return false
    } as Socket['write']
    try {
      // 映像を捨てているので ffmpeg は最後に失敗するが、ここで見たいのは途中のメモリ
      await exporter.run('memory', { project, outputPath: join(directory, 'out.mp4') }).catch(() => undefined)
    } finally {
      Socket.prototype.write = original
    }
    expect(peak - baseline).toBeLessThan(800 * 1024 * 1024)
  }, 120_000)

  it('ffmpeg がメモリ不足で止まったら、その旨と対処を伝える', () => {
    expect(encodeFailure('[out#0/mp4] Task finished with error code: -12 (Cannot allocate memory)')).toContain('メモリが足りなくなりました')
    expect(encodeFailure('Unknown encoder')).toBe('動画のエンコードに失敗しました')
  })
})
