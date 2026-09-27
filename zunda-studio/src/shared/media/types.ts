import type { Ms } from '../project/types'

/** ffprobe で調べた素材の情報。素材の登録(asset.add)に使う。 */
export interface MediaProbe {
  kind: 'video' | 'audio' | 'image'
  durationMs: Ms
  width: number
  height: number
  fps: number
  hasAudio: boolean
  /** 映像の符号化方式(h264, hevc, vp9 など)。プレビューでそのまま再生できるかの判断に使う。 */
  videoCodec: string | null
  audioCodec: string | null
  /** 入れ物の形式(mov,mp4,m4a... / matroska,webm など)。 */
  container: string
}

/** 編集用の軽い動画(プロキシ)の形式。プレビューで再生できる形式を選ぶ。 */
export type ProxyFormat = 'mp4' | 'webm'

/** 波形の表示用データ。1秒あたり samplesPerSecond 個の 0〜255 の振幅(base64)。 */
export interface WaveformPeaks {
  samplesPerSecond: number
  data: string
}

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']
