import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createCanvas } from '@napi-rs/canvas'

/**
 * テスト用の素材を本物の ffmpeg で作る。
 * 動画は左半分が赤・右半分が青の単色(コマの位置を画素で確かめられる)に、フレーム番号を焼き込まない代わりに
 * 1秒ごとに色が変わる帯を下に付ける。音声は指定の周波数の正弦波。
 */
export function makeTestVideo(
  directory: string,
  options: { name?: string; seconds?: number; width?: number; height?: number; fps?: number; frequency?: number } = {}
): string {
  const { name = 'game.mp4', seconds = 4, width = 320, height = 180, fps = 30, frequency = 440 } = options
  const path = join(directory, name)
  const half = Math.floor(width / 2)
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=red:s=${width}x${height}:r=${fps}:d=${seconds}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${frequency}:sample_rate=48000:duration=${seconds}`,
      '-filter_complex',
      `[0:v]drawbox=x=${half}:y=0:w=${width - half}:h=${height}:color=blue:t=fill[v]`,
      '-map',
      '[v]',
      '-map',
      '1:a',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-g',
      String(fps),
      '-c:a',
      'aac',
      '-shortest',
      path
    ],
    { stdio: 'pipe' }
  )
  return path
}

export function makeTestAudio(directory: string, options: { name?: string; seconds?: number; frequency?: number } = {}): string {
  const { name = 'bgm.wav', seconds = 3, frequency = 220 } = options
  const path = join(directory, name)
  execFileSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=${seconds}`, path],
    { stdio: 'pipe' }
  )
  return path
}

export async function makeTestImage(
  directory: string,
  options: { name?: string; width?: number; height?: number; color?: string } = {}
): Promise<string> {
  const { name = 'cutin.png', width = 64, height = 48, color = '#ffcc00' } = options
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = color
  context.fillRect(0, 0, width, height)
  const path = join(directory, name)
  await writeFile(path, canvas.toBuffer('image/png'))
  return path
}
