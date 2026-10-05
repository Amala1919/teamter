import { nanoid } from 'nanoid'

import type { Command } from '@shared/commands/types'
import { detectFreeSource, licenseFromSource } from '@shared/media/free-sources'
import type { AssetLicense, AudioItem, Ms } from '@shared/project/types'
import type { SoundEntry } from '@shared/settings/schema'

import { api, toAppError } from '../api'
import { useSettingsStore } from './settings'
import { useEditorStore } from './store'

/** 効果音を置くレイヤーの名前(一番上に作る)。 */
export const SOUND_LAYER_NAME = '効果音'
/** パレットに登録できる数。 */
const MAX_ENTRIES = 60

function palette(): SoundEntry[] {
  return useSettingsStore.getState().settings?.sounds.palette ?? []
}

async function savePalette(entries: SoundEntry[]): Promise<void> {
  await useSettingsStore.getState().update({ sounds: { palette: entries.slice(0, MAX_ENTRIES) } })
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}

/** ファイルを選んで、パレットに足す(短い音声だけ。フリー素材サイトの音ならクレジットも埋める)。 */
export async function registerSoundFiles(): Promise<string | null> {
  const picked = await api.invoke('dialog:pick', { kind: 'audio', multiple: true })
  if (!picked || picked.length === 0) return null
  const added: SoundEntry[] = []
  const errors: string[] = []
  for (const path of picked) {
    try {
      const probe = await api.invoke('media:probe', path)
      if (probe.kind !== 'audio' && !probe.hasAudio) {
        errors.push(`${fileName(path)}: 音の入っていないファイルです`)
        continue
      }
      const name = fileName(path).replace(/\.[^.]+$/, '')
      const known = detectFreeSource(fileName(path))
      const license: AssetLicense = known ? licenseFromSource(known, fileName(path)) : { source: '', creditRequired: false, creditText: '' }
      added.push({ id: nanoid(10), name, path, volume: 1, license: { ...license } })
    } catch (error) {
      errors.push(`${fileName(path)}: ${toAppError(error).message}`)
    }
  }
  if (added.length > 0) await savePalette([...palette(), ...added])
  return errors.length > 0 ? errors.join('\n') : null
}

/** タイムラインの音声の素材を、パレットに足す(音量と入手元も引き継ぐ)。 */
export async function registerSoundFromItem(item: AudioItem): Promise<string | null> {
  const asset = useEditorStore.getState().project.assets[item.assetId]
  if (!asset || asset.type !== 'audio') return '音声の素材が見つかりません'
  if (palette().some((entry) => entry.path === asset.path.absolute)) return null
  const name = fileName(asset.path.absolute).replace(/\.[^.]+$/, '')
  const { source, creditRequired, creditText, sourceId } = asset.license
  await savePalette([
    ...palette(),
    { id: nanoid(10), name, path: asset.path.absolute, volume: item.volume, license: { source, creditRequired, ...(creditText ? { creditText } : {}), ...(sourceId ? { sourceId } : {}) } }
  ])
  return null
}

export async function updateSound(id: string, patch: Partial<Pick<SoundEntry, 'name' | 'volume'>>): Promise<void> {
  await savePalette(palette().map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))
}

export async function removeSound(id: string): Promise<void> {
  await savePalette(palette().filter((entry) => entry.id !== id))
}

/** 並びを動かす(数字キーの割り当ても変わる)。 */
export async function moveSound(id: string, direction: -1 | 1): Promise<void> {
  const entries = [...palette()]
  const index = entries.findIndex((entry) => entry.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= entries.length) return
  ;[entries[index], entries[target]] = [entries[target]!, entries[index]!]
  await savePalette(entries)
}

/** パレットの入手元を、素材の入手元の形にする(無い項目は持たない)。 */
function assetLicense(entry: SoundEntry): AssetLicense {
  const { source, creditRequired, creditText, sourceId } = entry.license
  return { source, creditRequired, ...(creditText ? { creditText } : {}), ...(sourceId ? { sourceId } : {}) }
}

let previewAudio: HTMLAudioElement | null = null

/** パレットの音を試しに鳴らす(動画には入らない)。 */
export function previewSound(entry: SoundEntry): void {
  previewAudio?.pause()
  previewAudio = new Audio(api.mediaUrl(entry.path))
  previewAudio.volume = Math.min(1, entry.volume)
  void previewAudio.play().catch(() => undefined)
}

/**
 * パレットの音を再生位置(atMs)に置く。プロジェクトにまだ無い音なら素材として登録する。
 * 効果音は「効果音」レイヤーに置き、セリフの間に音量を下げる対象にはしない。置いたものを選んだ状態にする。
 */
export async function placeSound(entry: SoundEntry, atMs?: Ms): Promise<string | null> {
  try {
    const state = useEditorStore.getState()
    const at = Math.max(0, Math.round(atMs ?? state.playheadMs))
    const existing = Object.entries(state.project.assets).find(([, asset]) => asset.type === 'audio' && asset.path.absolute === entry.path)
    const commands: Command[] = []
    let assetId = existing?.[0]
    if (!assetId) {
      const probe = await api.invoke('media:probe', entry.path)
      commands.push({
        op: 'asset.add',
        asset: {
          type: 'audio',
          path: { absolute: entry.path, relative: null },
          license: assetLicense(entry),
          durationMs: probe.durationMs,
          codecs: { video: probe.videoCodec, audio: probe.audioCodec, container: probe.container }
        },
        tempId: 'sound-asset'
      })
      assetId = 'sound-asset'
    }
    const { project } = useEditorStore.getState()
    const layer = project.layers.find((candidate) => candidate.name === SOUND_LAYER_NAME)
    if (!layer) {
      const top = Math.max(...project.layers.map((candidate) => candidate.index)) + 1
      commands.push({ op: 'layer.insert', name: SOUND_LAYER_NAME, index: top, tempId: 'sound-layer' })
    }
    commands.push({ op: 'media.placeAudio', assetId, atMs: at, layerId: layer?.id ?? 'sound-layer', volume: entry.volume, duckable: false, tempId: 'sound' })
    const result = useEditorStore.getState().dispatch(commands, `効果音「${entry.name}」を置く`)
    if (!result.ok) return result.message
    const id = result.resolvedIds['sound']
    if (id) useEditorStore.getState().setSelection([id])
    return null
  } catch (error) {
    return `${entry.name}: ${toAppError(error).message}`
  }
}

/** 数字キー(1〜9)に割り当てた音を置く。 */
export function placeSoundByKey(index: number): Promise<string | null> {
  const entry = palette()[index]
  return entry ? placeSound(entry) : Promise.resolve(null)
}
