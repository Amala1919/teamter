import type { LiveEntry, LiveSession, Ms, Project, VideoItem } from '../project/types'

/**
 * ライブの記録と、録画・タイムラインの時刻の対応(PROJECT_FORMAT.md 9章)。
 *
 *   録画上の時刻       = session.offsetMs + entry.atMs
 *   タイムライン上の時刻 = 録画を置いた動画アイテムの開始 + (録画上の時刻 - 切り出しの開始) ÷ 再生速度
 *
 * 録画の素材と結び付いていなければ、録画をタイムラインの 0 秒から置いたものとみなす。
 */

export function recordingTimeMs(session: Pick<LiveSession, 'offsetMs'>, entry: Pick<LiveEntry, 'atMs'>): Ms {
  return session.offsetMs + entry.atMs
}

function recordingItems(project: Project, session: Pick<LiveSession, 'recordingAssetId'>): VideoItem[] {
  if (!session.recordingAssetId) return []
  return project.items.filter((item): item is VideoItem => item.type === 'video' && item.assetId === session.recordingAssetId)
}

/** 発言がタイムラインのどこにあたるか。録画のうちタイムラインに置いていない部分なら null。 */
export function entryTimelineMs(project: Project, session: LiveSession, entry: Pick<LiveEntry, 'atMs'>): Ms | null {
  const recording = recordingTimeMs(session, entry)
  if (!session.recordingAssetId) return recording >= 0 ? recording : null
  for (const item of recordingItems(project, session)) {
    if (recording >= item.inMs && recording < item.outMs) {
      return Math.round(item.startMs + (recording - item.inMs) / item.playbackRate)
    }
  }
  return null
}

/** タイムライン上のこの時刻は、録画の何ミリ秒目か(ずれの調整に使う)。録画が映っていなければ null。 */
export function timelineToRecordingMs(project: Project, session: Pick<LiveSession, 'recordingAssetId'>, timelineMs: Ms): Ms | null {
  if (!session.recordingAssetId) return timelineMs
  for (const item of recordingItems(project, session)) {
    if (timelineMs >= item.startMs && timelineMs < item.startMs + item.durationMs) {
      return Math.round(item.inMs + (timelineMs - item.startMs) * item.playbackRate)
    }
  }
  return null
}

/**
 * 「この発言は、いま再生位置にある瞬間の話だ」と合わせたときの offsetMs(R-6)。
 * 録画上の時刻 = offsetMs + atMs なので、offsetMs = 録画上の時刻 - atMs。
 */
export function offsetForAlignment(project: Project, session: LiveSession, entry: Pick<LiveEntry, 'atMs'>, timelineMs: Ms): Ms | null {
  const recording = timelineToRecordingMs(project, session, timelineMs)
  return recording === null ? null : recording - entry.atMs
}
