import type { LiveProfile } from '@shared/live/types'
import type { Project } from '@shared/project/types'

import { api } from '../api'
import { useEditorStore } from './store'

/** 今のプロジェクトから、ライブの相手(相方)の設定を作る。 */
export function liveProfileFrom(project: Project): LiveProfile | null {
  const characters = Object.values(project.characters)
  const ai = characters.find((character) => character.authorRole === 'ai')
  const user = characters.find((character) => character.authorRole === 'user')
  if (!ai) return null
  const voice = ai.voice
  return {
    aiName: ai.name,
    persona: ai.persona,
    userName: user?.name ?? 'あなた',
    model: project.ai.conversation,
    voice: {
      engineId: voice.engineId,
      speakerId: voice.speakerId,
      params: {
        speedScale: voice.speedScale,
        pitchScale: voice.pitchScale,
        intonationScale: voice.intonationScale,
        volumeScale: voice.volumeScale,
        prePhonemeLength: voice.prePhonemeLength,
        postPhonemeLength: voice.postPhonemeLength
      }
    },
    projectTitle: project.meta.title
  }
}

/**
 * ライブ用のウィンドウを開く。相方の設定を先に main へ渡しておき、ウィンドウはそれを受け取って始める。
 * Electron では最前面の小さなウィンドウ、それ以外ではブラウザの別ウィンドウで開く。
 */
export async function openLiveWindow(): Promise<string | null> {
  const profile = liveProfileFrom(useEditorStore.getState().project)
  if (!profile) return '相方(AIの役)のキャラクターがいません。キャラクター画面で「AI(相方)」の役を作ってください'
  await api.invoke('live:setProfile', profile)
  const opened = await api.invoke('live:openWindow')
  if (!opened) window.open(`${window.location.pathname}#live`, 'zunda-live', 'width=420,height=620')
  return null
}
