import type { Character, LayerId, Ms, PortraitItem, PortraitTransform, Project } from '../project/types'
import { speakingLine } from './animation'

/**
 * ある時刻に、各キャラクターの立ち絵をどう出すかを決める(PROJECT_FORMAT.md 6.2)。
 * - hide の区間では出さない。
 * - show の区間でだけ出す。立ち絵を付けると動画全体の show の区間が置かれる(shared/portrait/tracks.ts)。
 *   以前のプロジェクト(show を置かずに動画全体で出していた)は、開くときに同じ見た目の区間を足す。
 * - 位置・表情は adjust > show > キャラクターの設定 の順に決める。
 */
export interface PortraitScene {
  character: Character
  layerId: LayerId
  transform: PortraitTransform
  /** 区間で決めた表情。undefined ならセリフの表情に従う。 */
  expressionId: string | undefined
  /** エフェクト(登場・退場の動きなど)を持つ区間。 */
  effectItems: PortraitItem[]
  /**
   * 位置・表情を変えている区間(プレビューで動かすときの対象)。無ければ全体の設定を動かす。
   * 「動画の最後まで」の表示の区間で、区間だけの位置を持たないものは全体の設定として扱う。
   */
  controllingItem: PortraitItem | null
  /** 話し手の強調。0〜1 の暗くする度合いと、跳ねる高さ(立ち絵の高さに対する割合)。 */
  dim: number
  hop: number
}

const HOP_MS = 220
const HOP_RATIO = 0.025

export function portraitKind(item: PortraitItem): NonNullable<PortraitItem['kind']> {
  return item.kind ?? 'show'
}

/**
 * 「動画の最後まで」の表示の区間は、区間の終わりを過ぎても出し続ける。
 * 区間の長さは動画の長さに合わせて伸ばすが、書き出しの終わりや、最後の素材の後ろでも消えないように。
 */
function isUntilEnd(item: PortraitItem): boolean {
  return item.untilEnd === true && portraitKind(item) === 'show'
}

export function defaultPortraitLayerId(project: Project): LayerId {
  return (
    project.layers.find((layer) => layer.id === 'lyr_portrait')?.id ??
    project.layers.find((layer) => layer.name === '立ち絵')?.id ??
    project.layers[project.layers.length - 1]?.id ??
    ''
  )
}

export function portraitScenes(project: Project, timeMs: Ms): PortraitScene[] {
  const byCharacter = new Map<string, PortraitItem[]>()
  for (const item of project.items) {
    if (item.type !== 'portrait') continue
    byCharacter.set(item.characterId, [...(byCharacter.get(item.characterId) ?? []), item])
  }
  const dimLevel = Math.min(0.8, Math.max(0, project.editing.portraitDim ?? 0))
  const anyoneSpeaking =
    dimLevel > 0 &&
    project.items.some((item) => item.type === 'voice' && item.startMs <= timeMs && timeMs < item.startMs + item.durationMs)

  const scenes: PortraitScene[] = []
  for (const character of Object.values(project.characters)) {
    const portrait = character.portrait
    if (!portrait) continue
    const items = byCharacter.get(character.id) ?? []
    const active = items
      .filter((item) => item.startMs <= timeMs && (isUntilEnd(item) || timeMs < item.startMs + item.durationMs))
      .sort((a, b) => a.startMs - b.startMs)
    if (active.some((item) => portraitKind(item) === 'hide')) continue
    const show = active.filter((item) => portraitKind(item) === 'show').at(-1) ?? null
    if (!show) continue
    const adjust = active.filter((item) => portraitKind(item) === 'adjust').at(-1) ?? null

    // 「動画の最後まで」の区間で位置を変えていなければ、動かすのはキャラクター全体の配置(区間を分けていないときの配置)。
    const controllingItem = adjust ?? (isUntilEnd(show) && !show.transformOverride ? null : show)
    const line = speakingLine(project, character.id, timeMs)
    const sinceStart = line ? timeMs - line.startMs : Number.POSITIVE_INFINITY
    scenes.push({
      character,
      layerId: show?.layerId ?? adjust?.layerId ?? defaultPortraitLayerId(project),
      transform: adjust?.transformOverride ?? show?.transformOverride ?? portrait.transform,
      expressionId: adjust?.expressionId ?? show?.expressionId ?? undefined,
      effectItems: [show, adjust].filter((item): item is PortraitItem => item !== null && item.effects.length > 0),
      controllingItem,
      dim: anyoneSpeaking && !line ? dimLevel : 0,
      hop: project.editing.portraitHop && sinceStart < HOP_MS ? Math.sin((Math.PI * sinceStart) / HOP_MS) * HOP_RATIO : 0
    })
  }
  return scenes
}
