import { DEFAULT_LAYER_IDS } from '../project/factory'
import { projectDurationMs } from '../project/queries'
import type { CharacterId, Item, PortraitItem, Project } from '../project/types'
import { defaultPortraitLayerId, portraitKind } from './scene'

/**
 * 立ち絵の「表示」の区間をタイムラインに置く。立ち絵は表示の区間でだけ出るので、立ち絵を付けたら区間を1つ置き、
 * タイムラインで選んで位置・大きさ・表情を直せるようにする。
 *
 * 自動で置いた区間は untilEnd(動画の最後まで)で、セリフや素材が増えると最後まで伸びる。
 * 利用者が長さを変えたら、その長さに固定する(untilEnd を外す)。
 */

/** 動画に何も無いときの、表示の区間の長さ。 */
export const MIN_TRACK_MS = 5000

function hasShow(project: Project, characterId: CharacterId): boolean {
  return project.items.some((item) => item.type === 'portrait' && item.characterId === characterId && portraitKind(item) === 'show')
}

/** 表示の区間が無ければ、動画の頭から最後までの区間を置く。置いたら true。 */
export function ensurePortraitTrack(draft: Project, characterId: CharacterId, id: string): boolean {
  if (!draft.characters[characterId]?.portrait || hasShow(draft, characterId)) return false
  const item: PortraitItem = {
    id,
    type: 'portrait',
    layerId: draft.layers.some((layer) => layer.id === DEFAULT_LAYER_IDS.portrait) ? DEFAULT_LAYER_IDS.portrait : defaultPortraitLayerId(draft),
    startMs: 0,
    durationMs: Math.max(MIN_TRACK_MS, projectDurationMs(draft)),
    effects: [],
    locked: false,
    characterId,
    transformOverride: null,
    kind: 'show',
    expressionId: null,
    untilEnd: true
  }
  draft.items.push(item)
  return true
}

/** 「動画の最後まで」の表示の区間(立ち絵を付けたときに自動で置いたもの)を取り除く。 */
export function removeAutoPortraitTracks(draft: Project, characterId: CharacterId): void {
  draft.items = draft.items.filter((item) => !(item.type === 'portrait' && item.characterId === characterId && item.untilEnd))
}

/** 「動画の最後まで」の区間を、今の動画の長さに合わせる。 */
export function extendPortraitTracks(draft: Project): void {
  const end = projectDurationMs(draft)
  for (const item of draft.items) {
    if (item.type !== 'portrait' || !item.untilEnd) continue
    const length = Math.max(MIN_TRACK_MS, end - item.startMs)
    if (item.durationMs !== length) item.durationMs = length
  }
}

/**
 * 以前のプロジェクト(表示の区間を置かずに、動画全体で立ち絵を出していた)を開いたときに、同じ見た目になる区間を足す。
 * ID は決まった形にし、何度読み込んでも同じ結果にする。
 */
export function migratePortraitTracks(project: Project): Project {
  const missing = Object.values(project.characters).filter((character) => character.portrait && !hasShow(project, character.id))
  if (missing.length === 0) return project
  const next: Project = { ...project, items: [...project.items] as Item[] }
  for (const character of missing) ensurePortraitTrack(next, character.id, `itm_portrait_${character.id}`)
  return next
}
