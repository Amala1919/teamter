import { runProcess } from '../../core/process'

/**
 * 映像のエンコーダ(CPU の libx264 と、GPU の NVENC・Quick Sync・AMF)と、音の大きさをそろえる(ラウドネス正規化)処理。
 */

export type EncoderChoice = 'auto' | 'cpu' | 'nvenc' | 'qsv' | 'amf'
export type EncoderKind = Exclude<EncoderChoice, 'auto'>

export const ENCODER_LABELS: Record<EncoderKind, string> = {
  cpu: 'CPU(x264)',
  nvenc: 'NVIDIA(NVENC)',
  qsv: 'Intel(Quick Sync)',
  amf: 'AMD(AMF)'
}

const FFMPEG_NAMES: Record<Exclude<EncoderKind, 'cpu'>, string> = {
  nvenc: 'h264_nvenc',
  qsv: 'h264_qsv',
  amf: 'h264_amf'
}

/** auto で試す順(速い順)。 */
const GPU_ORDER: Exclude<EncoderKind, 'cpu'>[] = ['nvenc', 'qsv', 'amf']

/** 使えるか調べた結果(ffmpeg の場所ごと)。調べるのは1回だけ。 */
const detected = new Map<string, Promise<Set<EncoderKind>>>()

/** GPU のエンコーダが実際に使えるか(一覧に載っていても、ドライバや機種で使えないことがあるので、短く試しに書き出す)。 */
export function availableEncoders(ffmpeg: string, env: NodeJS.ProcessEnv): Promise<Set<EncoderKind>> {
  let pending = detected.get(ffmpeg)
  if (!pending) {
    pending = (async () => {
      const result = new Set<EncoderKind>(['cpu'])
      const list = await runProcess({ command: ffmpeg, args: ['-hide_banner', '-encoders'], env, timeoutMs: 20_000 }).catch(() => null)
      if (!list || list.exitCode !== 0) return result
      for (const kind of GPU_ORDER) {
        if (!list.stdout.includes(FFMPEG_NAMES[kind])) continue
        const probe = await runProcess({
          command: ffmpeg,
          args: ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x144:r=30:d=0.2', '-pix_fmt', 'yuv420p', '-c:v', FFMPEG_NAMES[kind], '-f', 'null', '-'],
          env,
          timeoutMs: 20_000
        }).catch(() => null)
        if (probe && probe.exitCode === 0) result.add(kind)
      }
      return result
    })()
    detected.set(ffmpeg, pending)
  }
  return pending
}

/** 選んだエンコーダを、実際に使うものに決める(auto は使える GPU、無ければ CPU。選んだ GPU が使えなければ CPU)。 */
export async function resolveEncoder(choice: EncoderChoice, ffmpeg: string, env: NodeJS.ProcessEnv): Promise<EncoderKind> {
  if (choice === 'cpu') return 'cpu'
  const available = await availableEncoders(ffmpeg, env)
  if (choice !== 'auto') return available.has(choice) ? choice : 'cpu'
  return GPU_ORDER.find((kind) => available.has(kind)) ?? 'cpu'
}

/**
 * 映像のエンコードの引数。crf は libx264 の画質の値(小さいほど高画質)で、GPU では同じくらいの画質になる値に置き換える。
 */
export function videoCodecArgs(kind: EncoderKind, crf: number, preset: string): string[] {
  switch (kind) {
    case 'cpu':
      return ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf)]
    case 'nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', String(crf + 3), '-b:v', '0']
    case 'qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', String(crf + 3)]
    case 'amf':
      return ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', String(crf + 2), '-qp_p', String(crf + 4)]
  }
}

/** 音の大きさの測った値(ffmpeg の loudnorm の1回目)。 */
export interface LoudnessStats {
  inputI: number
  inputTp: number
  inputLra: number
  inputThresh: number
  targetOffset: number
}

/** 音の大きさを測る。無音(測れない)なら null。 */
export async function measureLoudness(ffmpeg: string, env: NodeJS.ProcessEnv, path: string, target: number, signal?: AbortSignal): Promise<LoudnessStats | null> {
  const result = await runProcess({
    command: ffmpeg,
    args: ['-hide_banner', '-nostats', '-i', path, '-af', `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-'],
    env,
    timeoutMs: 30 * 60 * 1000,
    ...(signal ? { signal } : {})
  })
  if (result.exitCode !== 0) return null
  const json = /\{[\s\S]*"input_i"[\s\S]*?\}/.exec(result.stderr)?.[0]
  if (!json) return null
  const raw = JSON.parse(json) as Record<string, string>
  const stats = {
    inputI: Number(raw['input_i']),
    inputTp: Number(raw['input_tp']),
    inputLra: Number(raw['input_lra']),
    inputThresh: Number(raw['input_thresh']),
    targetOffset: Number(raw['target_offset'])
  }
  // 無音だと -inf になる。そろえようがないので、そのままにする。
  if (!Object.values(stats).every(Number.isFinite) || stats.inputI < -70) return null
  return stats
}

/** 測った値を使って、目標の大きさにそろえるフィルタ(2回目。音の形を変えない一律の調整にする)。 */
export function loudnessFilter(stats: LoudnessStats, target: number): string {
  return [
    `loudnorm=I=${target}:TP=-1.5:LRA=11`,
    `measured_I=${stats.inputI}`,
    `measured_TP=${stats.inputTp}`,
    `measured_LRA=${stats.inputLra}`,
    `measured_thresh=${stats.inputThresh}`,
    `offset=${stats.targetOffset}`,
    'linear=true:print_format=none'
  ].join(':') + ',aresample=48000'
}
