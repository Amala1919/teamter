import { entryTimelineMs } from '../../live/timing'
import type { LiveSession } from '../../project/types'
import { fail, requireFinite, type HandlerTable } from '../env'
import { voiceHandlers } from './voice'

type LiveHandlers = Pick<
  HandlerTable,
  'live.importSession' | 'live.setOffset' | 'live.linkRecording' | 'live.removeSession' | 'script.adoptLiveEntry'
>

function requireSession(draft: { liveSessions: Record<string, LiveSession> }, sessionId: string, op: Parameters<typeof fail>[0]): LiveSession {
  const session = draft.liveSessions[sessionId]
  if (!session) fail(op, `ライブの記録が見つかりません: ${sessionId}`)
  return session
}

export const liveHandlers: LiveHandlers = {
  'live.importSession': (draft, command) => {
    const incoming = command.session
    if (!/^ses_[A-Za-z0-9_-]{4,40}$/.test(incoming.id)) fail(command.op, `セッションIDが不正です: ${incoming.id}`)
    const existing = draft.liveSessions[incoming.id]
    if (!existing) {
      draft.liveSessions[incoming.id] = {
        ...incoming,
        recordingAssetId: incoming.recordingAssetId && draft.assets[incoming.recordingAssetId] ? incoming.recordingAssetId : null,
        entries: incoming.entries.map((entry) => ({ ...entry, adoptedItemId: null }))
      }
      return
    }
    // 取り込み直し: 新しい発言を足し、終了時刻と(手で直していなければ)ずれを更新する。採用済みの印は残す。
    const known = new Set(existing.entries.map((entry) => entry.id))
    for (const entry of incoming.entries) {
      if (!known.has(entry.id)) existing.entries.push({ ...entry, adoptedItemId: null })
    }
    existing.entries.sort((a, b) => a.atMs - b.atMs)
    existing.endedAt = incoming.endedAt
    if (existing.offsetSource !== 'manual') {
      existing.offsetMs = incoming.offsetMs
      existing.offsetSource = incoming.offsetSource
    }
  },

  'live.setOffset': (draft, command) => {
    const session = requireSession(draft, command.sessionId, command.op)
    requireFinite(command.offsetMs, command.op, 'ずれ')
    session.offsetMs = Math.round(command.offsetMs)
    session.offsetSource = 'manual'
  },

  'live.linkRecording': (draft, command, env) => {
    const session = requireSession(draft, command.sessionId, command.op)
    if (command.assetId === null) {
      session.recordingAssetId = null
      return
    }
    const assetId = env.resolve(command.assetId)
    const asset = draft.assets[assetId]
    if (!asset || asset.type !== 'video') fail(command.op, '録画(動画)の素材を指定してください')
    session.recordingAssetId = assetId
  },

  'live.removeSession': (draft, command) => {
    requireSession(draft, command.sessionId, command.op)
    delete draft.liveSessions[command.sessionId]
  },

  'script.adoptLiveEntry': (draft, command, env) => {
    const session = requireSession(draft, command.sessionId, command.op)
    const entry = session.entries.find((candidate) => candidate.id === command.entryId)
    if (!entry) fail(command.op, `発言が見つかりません: ${command.entryId}`)
    if (entry.kind === 'marker' && entry.text === '目印') fail(command.op, '言葉の無い目印は台本にできません')
    if (entry.adoptedItemId && draft.items.some((item) => item.id === entry.adoptedItemId)) fail(command.op, 'この発言は採用済みです')

    const role = entry.role === 'ai' ? 'ai' : 'user'
    const characterId =
      command.characterId !== undefined
        ? env.resolve(command.characterId)
        : Object.values(draft.characters).find((character) => character.authorRole === role)?.id
    if (!characterId || !draft.characters[characterId]) {
      fail(command.op, role === 'ai' ? '相方(AIの役)のキャラクターがいません' : '自分の役のキャラクターがいません')
    }
    const atMs = command.atMs ?? entryTimelineMs(draft, session, entry)
    if (atMs === null) fail(command.op, 'この発言は、タイムラインに置いた録画の範囲の外です。時刻を指定してください')

    const tempId = command.tempId ?? `__adopt_${entry.id}`
    voiceHandlers['voice.insert'](
      draft,
      {
        op: 'voice.insert',
        characterId,
        text: entry.text,
        atMs: Math.max(0, atMs),
        ...(entry.generatedBy ? { generatedBy: entry.generatedBy } : {}),
        tempId
      },
      env
    )
    entry.adoptedItemId = env.resolvedIds[tempId] ?? null
  }
}
