import type { Command } from '../commands/types'
import { formatDurationJa, formatMs } from '../lib/time'
import { recordingTimeMs } from '../live/timing'
import type { CandidateSegment } from '../media/analysis'
import { projectDurationMs } from '../project/queries'
import type { AssetId, Ms, Project } from '../project/types'
import { MAX_AI_COMMANDS } from './edit-commands'
import type { GenerateRequest } from './types'

/**
 * 録画とライブの記録から、台本とタイムラインの下書きを作らせる依頼文(AI_EDIT_PROTOCOL.md 8章)。
 * 出てくるのは編集チャットと同じコマンド列で、差分を見てから適用する。
 */

export interface DraftRequest {
  recordingAssetId: AssetId
  /** 目安の長さ。 */
  targetMs: Ms
  instruction?: string
}

/** 録画上の時刻に対応する、ライブの発言と目印。 */
export function liveMomentsFor(project: Project, recordingAssetId: AssetId): { atMs: Ms; role: 'user' | 'ai'; kind: string; text: string }[] {
  const moments: { atMs: Ms; role: 'user' | 'ai'; kind: string; text: string }[] = []
  for (const session of Object.values(project.liveSessions)) {
    // 結び付けていない記録は、この録画のものかもしれないので使う(ずれは 0 とみなされる)。
    if (session.recordingAssetId && session.recordingAssetId !== recordingAssetId) continue
    for (const entry of session.entries) {
      const atMs = recordingTimeMs(session, entry)
      if (atMs >= 0) moments.push({ atMs, role: entry.role, kind: entry.kind, text: entry.text })
    }
  }
  return moments.sort((a, b) => a.atMs - b.atMs)
}

export function buildDraftPrompt(project: Project, request: DraftRequest, candidates: CandidateSegment[]): Omit<GenerateRequest, 'jsonSchema'> {
  const asset = project.assets[request.recordingAssetId]
  const characters = Object.values(project.characters)
  const user = characters.find((character) => character.authorRole === 'user')
  const ai = characters.find((character) => character.authorRole === 'ai')
  const startAtMs = projectDurationMs(project)
  const moments = liveMomentsFor(project, request.recordingAssetId)

  const system = [
    'あなたはゲーム実況動画(VOICEVOX の合成音声とキャラクターで作る動画)の構成作家です。',
    '長い録画から見どころの区間を選んでつなぎ、その上に掛け合いのセリフを乗せた「下書き」を、編集コマンドの列として作ります。',
    '投稿者が差分を確かめてから適用し、そのあと手で仕上げます。',
    '',
    '## 決まりごと',
    '- 出力は指定のJSONだけ。reply にどんな構成にしたかを短く書き、commands にコマンドを並べる',
    `- 録画は media.placeVideo(assetId は "${request.recordingAssetId}")で置く。inMs と outMs は候補の区間の中から選ぶ(区間を短く切ってよい)`,
    `- 置く位置 atMs は ${startAtMs} ミリ秒から始め、前の区間の終わりに続けて隙間なく並べる`,
    '- それぞれの区間の上に、その場面について話すセリフを voice.insert で置く。atMs はその区間がタイムライン上にある範囲の中',
    '- セリフは録画中の実際の会話を土台にする。会話が無い区間は、映像の状況(盛り上がり・目印)から自然に話す',
    user ? `- 投稿者の役は ${user.id}(${user.name})` : '',
    ai ? `- 相方の役は ${ai.id}(${ai.name})。人物像: ${ai.persona?.personality || '指定なし'} / 口調: ${ai.persona?.speechStyle || '指定なし'}` : '',
    '- セリフ1つは短く(字幕2行以内)。1つの区間に2〜6個が目安',
    `- 全体の長さは ${formatDurationJa(request.targetMs)}前後にする`,
    `- コマンドは${MAX_AI_COMMANDS}個まで`
  ]
    .filter(Boolean)
    .join('\n')

  const table = candidates
    .map(
      (candidate) =>
        `${candidate.id} ${formatMs(candidate.inMs)}-${formatMs(candidate.outMs)} 点数${candidate.score} 盛り上がり${candidate.loudness} 目印${candidate.markers} 会話${candidate.talks}`
    )
    .join('\n')
  const transcript = moments
    .map((moment) => `[${formatMs(moment.atMs)}] ${moment.kind === 'marker' ? `★目印: ${moment.text}` : `${moment.role === 'ai' ? (ai?.name ?? '相方') : (user?.name ?? '投稿者')}: ${moment.text}`}`)
    .join('\n')

  const content = [
    `## 録画\n${asset?.path.absolute.split(/[\\/]/).at(-1) ?? request.recordingAssetId}(長さ ${asset && asset.type === 'video' ? formatDurationJa(asset.durationMs) : '不明'})`,
    project.meta.synopsis?.trim() ? `## 企画メモ\n${project.meta.synopsis.trim()}` : '',
    `## 使えそうな区間の候補(録画上の時刻)\n${table || '(候補なし)'}`,
    transcript ? `## 録画中の会話と目印(録画上の時刻)\n${transcript}` : '## 録画中の会話\n(記録なし)',
    request.instruction?.trim() ? `## 投稿者からの指示\n${request.instruction.trim()}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')

  return { system, turns: [{ role: 'user', content }] }
}

/**
 * 下書きのコマンドを、置いた位置どおりに並ぶよう包む。
 * セリフを挿入すると後ろのアイテムがずれる設定(リップル)だと、AI が決めた位置からずれてしまうので、その間だけ止める。
 */
export function wrapDraftCommands(project: Project, commands: Command[]): Command[] {
  if (!project.editing.rippleOnVoiceChange) return commands
  return [{ op: 'project.setEditing', rippleOnVoiceChange: false }, ...commands, { op: 'project.setEditing', rippleOnVoiceChange: true }]
}
