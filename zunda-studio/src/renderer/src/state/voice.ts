import { create } from 'zustand'

import { effectiveVoice, synthesisSignature, isVoiceItem } from '@shared/project/queries'
import type { Project, VoiceItem } from '@shared/project/types'
import type { EngineStatus, SpeakerInfo } from '@shared/voice/types'

import { api, toAppError } from '../api'
import { useEditorStore } from './store'

export type LineStatus =
  | { state: 'queued'; signature: string }
  | { state: 'running'; signature: string }
  | { state: 'error'; signature: string; message: string; guidance: string }

interface VoiceState {
  engines: EngineStatus[]
  speakers: Record<string, SpeakerInfo[]>
  /** セリフごとの合成の進み具合。プロジェクトには保存しない一時的な状態。 */
  lines: Record<string, LineStatus>
  /** 合成済み音声のキャッシュキー → ファイルの場所。 */
  wavPaths: Record<string, string>

  refreshEngines: () => Promise<void>
  ensureEngine: (engineId: string) => Promise<EngineStatus>
  loadSpeakers: (engineId: string, force?: boolean) => Promise<SpeakerInfo[]>
  retry: (itemId?: string) => void
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  engines: [],
  speakers: {},
  lines: {},
  wavPaths: {},

  refreshEngines: async () => {
    set({ engines: await api.invoke('voice:engines') })
  },

  ensureEngine: async (engineId) => {
    const status = await api.invoke('voice:ensure', engineId)
    upsertEngine(status)
    return status
  },

  loadSpeakers: async (engineId, force = false) => {
    const cached = get().speakers[engineId]
    if (cached && !force) return cached
    const speakers = await api.invoke('voice:speakers', engineId)
    set({ speakers: { ...get().speakers, [engineId]: speakers } })
    return speakers
  },

  retry: (itemId) => {
    const lines = { ...get().lines }
    for (const [id, status] of Object.entries(lines)) {
      if (status.state === 'error' && (itemId === undefined || itemId === id)) delete lines[id]
    }
    set({ lines })
    scheduleSynthesis()
  }
}))

function upsertEngine(status: EngineStatus): void {
  const engines = useVoiceStore.getState().engines
  const index = engines.findIndex((engine) => engine.id === status.id)
  useVoiceStore.setState({
    engines: index < 0 ? [...engines, status] : engines.map((engine, i) => (i === index ? status : engine))
  })
}

api.subscribe('voice:engine-status', (status) => {
  upsertEngine(status)
  // エンジンが使えるようになったら、失敗していたセリフを自動で合成し直す。
  if (status.state === 'ready') useVoiceStore.getState().retry()
})

// ------------------------------------------------------------------ 自動合成

/**
 * 未合成のセリフを見つけて順に合成し、結果をプロジェクトに反映する。
 * セリフを入力するだけで音声・尺・口パクが揃う(YMM と同じ感覚)ようにするための仕組み。
 */
const MAX_PARALLEL = 2
let running = 0
let scheduled = false

export function scheduleSynthesis(): void {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    pump()
  })
}

function pump(): void {
  const project = useEditorStore.getState().project
  const lines = { ...useVoiceStore.getState().lines }
  let changed = false

  for (const item of project.items) {
    if (!isVoiceItem(item) || item.synthesis !== null) continue
    const signature = synthesisSignature(project, item)
    if (!signature) continue
    const status = lines[item.id]
    if (status && status.signature === signature) continue
    lines[item.id] = { state: 'queued', signature }
    changed = true
  }
  // 消えたセリフの状態は捨てる。
  for (const id of Object.keys(lines)) {
    if (!project.items.some((item) => item.id === id)) {
      delete lines[id]
      changed = true
    }
  }
  if (changed) useVoiceStore.setState({ lines })

  while (running < MAX_PARALLEL) {
    const next = Object.entries(useVoiceStore.getState().lines).find(([, status]) => status.state === 'queued')
    if (!next) break
    const [itemId, status] = next
    running++
    setLine(itemId, { state: 'running', signature: status.signature })
    void synthesizeOne(itemId, status.signature).finally(() => {
      running--
      pump()
    })
  }
}

function setLine(itemId: string, status: LineStatus | null): void {
  const lines = { ...useVoiceStore.getState().lines }
  if (status) lines[itemId] = status
  else delete lines[itemId]
  useVoiceStore.setState({ lines })
}

/** 自分が担当した依頼(同じ署名)の状態だけを更新する。後から来た新しい依頼の状態を消さないため。 */
function settleLine(itemId: string, signature: string, status: LineStatus | null): void {
  if (useVoiceStore.getState().lines[itemId]?.signature !== signature) return
  setLine(itemId, status)
}

function currentLine(itemId: string): { project: Project; item: VoiceItem } | null {
  const project = useEditorStore.getState().project
  const item = project.items.find((candidate) => candidate.id === itemId)
  return item && isVoiceItem(item) ? { project, item } : null
}

async function synthesizeOne(itemId: string, signature: string): Promise<void> {
  const current = currentLine(itemId)
  if (!current || synthesisSignature(current.project, current.item) !== signature) {
    settleLine(itemId, signature, null)
    return
  }
  const voice = effectiveVoice(current.project, current.item)!
  const text = current.item.text
  try {
    const outcome = await api.invoke('voice:synthesize', {
      engineId: voice.engineId,
      speakerId: voice.speakerId,
      text,
      params: voice.params
    })
    useVoiceStore.setState({ wavPaths: { ...useVoiceStore.getState().wavPaths, [outcome.cacheKey]: outcome.wavPath } })

    // 合成している間にセリフや声が変わっていたら、この結果は使わない(新しい内容で合成し直す)。
    const latest = currentLine(itemId)
    if (!latest || synthesisSignature(latest.project, latest.item) !== signature) {
      settleLine(itemId, signature, null)
      return
    }
    useEditorStore.getState().dispatch(
      [
        {
          op: 'voice.applySynthesis',
          itemId,
          expectedText: text,
          synthesis: {
            cacheKey: outcome.cacheKey,
            audioDurationMs: outcome.audioDurationMs,
            lipSync: outcome.lipSync,
            accentPhrases: outcome.accentPhrases
          }
        }
      ],
      '音声の合成',
      { history: 'skip' }
    )
    settleLine(itemId, signature, null)
  } catch (error) {
    const appError = toAppError(error)
    settleLine(itemId, signature, { state: 'error', signature, message: appError.message, guidance: appError.guidance })
  }
}

// プロジェクトが変わるたびに、合成が必要なセリフを探す。
useEditorStore.subscribe((state, previous) => {
  if (state.project !== previous.project) scheduleSynthesis()
})

// ------------------------------------------------------------------ 音声ファイルの場所

/**
 * 合成済み音声の場所を返す。別のマシンで開いてキャッシュが無い場合は、
 * 保存済みのアクセント句から同じ音声を作り直す(キャッシュのキーも一致する)。
 */
export async function resolveWavPath(project: Project, item: VoiceItem): Promise<string | null> {
  const synthesis = item.synthesis
  if (!synthesis) return null
  const known = useVoiceStore.getState().wavPaths[synthesis.cacheKey]
  if (known) return known
  let path = await api.invoke('voice:resolve', synthesis.cacheKey)
  if (!path) {
    const voice = effectiveVoice(project, item)
    if (!voice) return null
    const outcome = await api.invoke('voice:synthesize', {
      engineId: voice.engineId,
      speakerId: voice.speakerId,
      text: item.text,
      params: voice.params,
      accentPhrases: synthesis.accentPhrases
    })
    path = outcome.wavPath
  }
  useVoiceStore.setState({ wavPaths: { ...useVoiceStore.getState().wavPaths, [synthesis.cacheKey]: path } })
  return path
}
