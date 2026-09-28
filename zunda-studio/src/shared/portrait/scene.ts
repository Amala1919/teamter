import type { Character, LayerId, Ms, PortraitItem, PortraitTransform, Project } from '../project/types'
import { speakingLine } from './animation'

/**
 * ある時刻に、各キャラクターの立ち絵をどう出すかを決める(PROJECT_FORMAT.md 6.2)。
 * - hide の区間では出さない。
 * - show を1つでも置いたキャラクターは、show の区間でだけ出す(置いていなければ動画全体で出す)。
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
  /** 位置・表情を変えている区間(プレビューで動かすときの対象)。無ければ全体の設定を動かす。 */
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
      .filter((item) => item.startMs <= timeMs && timeMs < item.startMs + item.durationMs)
      .sort((a, b) => a.startMs - b.startMs)
    if (active.some((item) => portraitKind(item) === 'hide')) continue
    const hasShow = items.some((item) => portraitKind(item) === 'show')
    const show = active.filter((item) => portraitKind(item) === 'show').at(-1) ?? null
    if (hasShow && !show) continue
    const adjust = active.filter((item) => portraitKind(item) === 'adjust').at(-1) ?? null

    const controllingItem = adjust ?? show
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
