import type { AppErrorShape } from '../errors'
import type { Ms, Project } from '../project/types'

export interface ExportRequest {
  project: Project
  outputPath: string
  /** 部分書き出し(E-5)。省略すると全体。 */
  startMs?: Ms
  endMs?: Ms
  /** 省略するとプロジェクトのフレームレート。 */
  fps?: number
  /** 出力の縦の画素数。省略するとプロジェクトの大きさ。 */
  height?: number
  /** 画質(小さいほど高画質)。省略すると設定の値。 */
  crf?: number
}

export type ExportPhase = 'prepare' | 'audio' | 'video' | 'done' | 'error' | 'cancelled'

export interface ExportProgress {
  jobId: string
  phase: ExportPhase
  /** その工程の進み具合(0〜1)。 */
  ratio: number
  /** 映像の書き出しの速さ(コマ/秒)。 */
  fps?: number
  outputPath?: string
  error?: AppErrorShape
}
