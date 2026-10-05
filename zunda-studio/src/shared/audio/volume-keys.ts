import type { Ms, VolumeKey } from '../project/types'

/**
 * 音量の折れ点(アイテムごとの音量の時間変化)。素材の音量に掛ける倍率で、点の間はまっすぐつなぐ。
 * 最初の点より前は最初の点の値、最後の点より後は最後の点の値のまま。点が無ければ 1。
 */

/** 音量の折れ点の上限(倍率)。 */
export const MAX_KEY_GAIN = 4

export function keyGainAt(keys: readonly VolumeKey[] | undefined, relMs: Ms): number {
  if (!keys || keys.length === 0) return 1
  if (relMs <= keys[0]!.atMs) return keys[0]!.gain
  for (let index = 1; index < keys.length; index++) {
    const next = keys[index]!
    if (relMs <= next.atMs) {
      const previous = keys[index - 1]!
      const span = next.atMs - previous.atMs
      return span <= 0 ? next.gain : previous.gain + ((next.gain - previous.gain) * (relMs - previous.atMs)) / span
    }
  }
  return keys.at(-1)!.gain
}

/** 時刻順に並べ、同じ時刻の点は後のものを残す。 */
export function normalizeKeys(keys: readonly VolumeKey[]): VolumeKey[] {
  const sorted = [...keys].map((key) => ({ atMs: Math.round(key.atMs), gain: Math.round(key.gain * 1000) / 1000 })).sort((a, b) => a.atMs - b.atMs)
  const result: VolumeKey[] = []
  for (const key of sorted) {
    if (result.length > 0 && result.at(-1)!.atMs === key.atMs) result[result.length - 1] = key
    else result.push(key)
  }
  return result
}

/**
 * アイテムの頭を delta だけ後ろへ詰めた(左端を切った)ときの点。新しい長さ duration の外の点は落とし、
 * 端での値が変わらないよう、端に点を足す。
 */
export function shiftKeys(keys: readonly VolumeKey[] | undefined, delta: Ms, duration: Ms): VolumeKey[] | undefined {
  if (!keys || keys.length === 0) return undefined
  const inside = keys.map((key) => ({ atMs: key.atMs - delta, gain: key.gain })).filter((key) => key.atMs > 0 && key.atMs < duration)
  const result = [{ atMs: 0, gain: keyGainAt(keys, delta) }, ...inside]
  if (keys.some((key) => key.atMs - delta >= duration)) result.push({ atMs: duration, gain: keyGainAt(keys, delta + duration) })
  return normalizeKeys(result)
}

/** at(アイテム内の時刻)で2つに分けたときの、前半と後半の点。 */
export function splitKeys(keys: readonly VolumeKey[] | undefined, at: Ms, duration: Ms): { first: VolumeKey[] | undefined; second: VolumeKey[] | undefined } {
  if (!keys || keys.length === 0) return { first: undefined, second: undefined }
  const boundary = keyGainAt(keys, at)
  const first = normalizeKeys([...keys.filter((key) => key.atMs < at), { atMs: at, gain: boundary }])
  return { first, second: shiftKeys(keys, at, duration - at) }
}

/** 長さが ratio 倍になったとき(速度を変えたとき)の点。 */
export function scaleKeys(keys: readonly VolumeKey[] | undefined, ratio: number): VolumeKey[] | undefined {
  if (!keys || keys.length === 0) return undefined
  return normalizeKeys(keys.map((key) => ({ atMs: key.atMs * ratio, gain: key.gain })))
}
