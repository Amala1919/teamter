import type { LiveProfile } from '../live/types'
import type { BanterRole, LiveEntry } from '../project/types'
import { cleanLine } from './cohost'
import type { ChatTurn, GenerateRequest } from './types'

/**
 * ライブモード(録画中の相談)の依頼文。相方と同じ人物として、短く速く答えさせる(R-3, R-11)。
 */

/** 直近の何発言を会話として渡すか。 */
const LIVE_HISTORY = 20

const ROLE_HINT: Record<BanterRole, string> = {
  tsukkomi: 'ツッコミ役',
  boke: 'ボケ役',
  navigator: '解説役',
  free: '自由な立ち位置'
}

export function buildLivePrompt(profile: LiveProfile, entries: readonly LiveEntry[], maxChars: number): Omit<GenerateRequest, 'jsonSchema'> {
  const persona = profile.persona
  const limit = Math.min(maxChars, Math.max(10, (persona?.targetLengthChars ?? maxChars) * 2))
  const system = [
    `あなたは「${profile.aiName}」です。${profile.userName}(投稿者)がゲームを録画しながらプレイしていて、横で一緒に見ながら話しています。`,
    persona?.personality ? `性格: ${persona.personality}` : null,
    persona?.speechStyle ? `口調: ${persona.speechStyle}` : null,
    persona ? `立ち位置: ${ROLE_HINT[persona.banterRole]}` : null,
    persona && persona.forbidden.length > 0 ? `使ってはいけない表現: ${persona.forbidden.join(' / ')}` : null,
    '',
    '## 守ること',
    `- プレイの邪魔をしないよう、${limit}文字以内で短く答える`,
    '- 質問には要点だけ答える。分からないことは分からないと言う',
    '- 話者名・かっこ・絵文字・改行を入れない。セリフだけを書く',
    '- この会話はあとで動画の台本の素材になる。人物像を崩さない'
  ]
    .filter((line) => line !== null)
    .join('\n')

  const turns: ChatTurn[] = []
  for (const entry of entries.filter((candidate) => candidate.kind !== 'marker').slice(-LIVE_HISTORY)) {
    const role = entry.role === 'ai' ? 'assistant' : 'user'
    const last = turns.at(-1)
    // 同じ側の発言が続いたら1つにまとめる(交互でないと受け付けないAIがあるため)。
    if (last && last.role === role) last.content += `\n${entry.text}`
    else turns.push({ role, content: entry.text })
  }
  if (turns.length === 0 || turns.at(-1)!.role !== 'user') turns.push({ role: 'user', content: '(何か一言どうぞ)' })
  return { system, turns }
}

/** 返答を記録に向く形に整える(飾りを外し、長すぎれば文の切れ目で切る)。 */
export function tidyLiveReply(text: string, aiName: string, maxChars: number): string {
  const cleaned = cleanLine(text, aiName)
  if (cleaned.length <= maxChars * 1.5) return cleaned
  const cut = cleaned.slice(0, Math.round(maxChars * 1.5))
  const lastStop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('!'), cut.lastIndexOf('?'), cut.lastIndexOf('！'), cut.lastIndexOf('？'))
  return lastStop > maxChars / 2 ? cut.slice(0, lastStop + 1) : `${cut}…`
}
