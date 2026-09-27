import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EventBus } from '../src/main/core/events'
import type { AiService } from '../src/main/services/ai/ai-service'
import { FfmpegLocator } from '../src/main/services/media/ffmpeg'
import { LiveService } from '../src/main/services/live/live-service'
import type { ObsConnection } from '../src/main/services/live/obs-link'
import { Transcriber } from '../src/main/services/live/transcriber'
import { buildLivePrompt, tidyLiveReply } from '@shared/ai/live'
import type { GenerateRequest } from '@shared/ai/types'
import { applyCommands, type CommandContext } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import type { LiveProfile } from '@shared/live/types'
import { entryTimelineMs, offsetForAlignment } from '@shared/live/timing'
import { createEmptyProject } from '@shared/project/factory'
import type { LiveSession, Project } from '@shared/project/types'
import { defaultSettings } from '@shared/settings/schema'

const FIXTURE_BIN = resolve('tests/fixtures/bin')

const profile: LiveProfile = {
  aiName: '四国めたん',
  persona: { personality: '冷静で毒舌', speechStyle: '語尾は「〜わ」', banterRole: 'tsukkomi', forbidden: ['やばい'], targetLengthChars: 20 },
  userName: 'ずんだもん',
  model: { providerId: 'opencode', model: 'opencode-go/fast-model' },
  voice: null,
  projectTitle: 'ホラー回'
}

class FakeObs implements ObsConnection {
  private listener: ((event: { active: boolean; state: string; outputPath: string | null }) => void) | null = null
  constructor(private readonly status: { active: boolean; durationMs: number }) {}
  recordStatus(): Promise<{ active: boolean; durationMs: number }> {
    return Promise.resolve(this.status)
  }
  onRecordState(listener: (event: { active: boolean; state: string; outputPath: string | null }) => void): void {
    this.listener = listener
  }
  onClose(): void {}
  disconnect(): Promise<void> {
    return Promise.resolve()
  }
  fire(state: string, outputPath: string | null = null): void {
    this.listener?.({ active: state === 'OBS_WEBSOCKET_OUTPUT_STARTED', state, outputPath })
  }
}

function setup(options: { obs?: FakeObs; reply?: string } = {}): {
  service: LiveService
  directory: string
  clock: { now: number }
  requests: { request: GenerateRequest; options: unknown }[]
  events: EventBus
} {
  const directory = mkdtempSync(join(tmpdir(), 'zunda-live-'))
  const clock = { now: Date.parse('2026-09-27T20:00:00Z') }
  const requests: { request: GenerateRequest; options: unknown }[] = []
  const ai = {
    generate: (_role: string, request: GenerateRequest, resolveOptions: unknown) => {
      requests.push({ request, options: resolveOptions })
      return Promise.resolve({
        text: options.reply ?? '四国めたん: 足元をよく見ることね',
        generatedBy: { providerId: 'opencode', model: 'opencode-go/fast-model', at: '2026-09-27T20:00:02Z' },
        durationMs: 800
      })
    }
  } as unknown as AiService
  const settings = defaultSettings()
  if (options.obs) settings.obs.enabled = true
  const events = new EventBus()
  const service = new LiveService(
    directory,
    ai,
    () => settings,
    events,
    () => Promise.resolve(options.obs ?? new FakeObs({ active: false, durationMs: 0 })),
    new Transcriber(() => settings, new FfmpegLocator(() => settings), join(directory, 'tmp')),
    () => clock.now
  )
  service.setProfile(profile)
  return { service, directory, clock, requests, events }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

describe('ライブの記録(LiveService)', () => {
  it('発言は相方の人物像で返事をもらい、時刻付きで1件ずつファイルに追記される', async () => {
    const { service, directory, clock, requests } = setup()
    const started = await service.start()
    const id = started.session!.id

    clock.now += 5000
    const [user, ai] = await service.say('このボスのパターンある?', 'question')
    expect(user).toMatchObject({ role: 'user', atMs: 5000, kind: 'question', text: 'このボスのパターンある?' })
    expect(ai).toMatchObject({ role: 'ai', atMs: 5000, kind: 'question', text: '足元をよく見ることね' })
    expect(ai!.generatedBy?.model).toBe('opencode-go/fast-model')
    // 相方と同じ人物像・同じ会話AIで返事をする
    expect(requests[0]!.request.system).toContain('四国めたん')
    expect(requests[0]!.request.system).toContain('冷静で毒舌')
    expect(requests[0]!.options).toEqual({ projectConversation: profile.model })

    clock.now += 60_000
    const marker = await service.mark('いまのは奇跡')
    expect(marker).toMatchObject({ kind: 'marker', bookmarked: true, atMs: 65_000 })
    const note = await service.say('あとでここ使う', 'note')
    expect(note).toHaveLength(1)
    expect(requests).toHaveLength(1)

    await service.stop()
    const lines = readFileSync(join(directory, `${id}.jsonl`), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { type: string })
    expect(lines.map((line) => line.type)).toEqual(['session', 'entry', 'entry', 'entry', 'entry', 'end'])

    const summaries = await service.list()
    expect(summaries).toEqual([
      expect.objectContaining({ id, entryCount: 4, markerCount: 1, aiName: '四国めたん', projectTitle: 'ホラー回', endedAt: expect.any(String) })
    ])
  })

  it('途中で落ちて最後の行が壊れていても、読めた分は取り込める', async () => {
    const { service, directory } = setup()
    const id = (await service.start()).session!.id
    await service.say('一言目', 'chat')
    appendFileSync(join(directory, `${id}.jsonl`), '{"type":"entry","entry":{"id":"ent_bro')
    const session = await service.read(id)
    expect(session.entries).toHaveLength(2)
    expect(session.endedAt).toBeNull()
  })

  it('OBS が録画中なら、その経過時間をずれにし、途中で録画が始まればそこを録画の 0 秒にする', async () => {
    const obs = new FakeObs({ active: true, durationMs: 12_000 })
    const { service, clock } = setup({ obs })
    const id = (await service.start()).session!.id
    await flush()
    expect(service.state().session).toMatchObject({ offsetMs: 12_000, offsetSource: 'obs' })
    expect(service.state().obs).toEqual({ state: 'connected', recording: true })

    clock.now += 5000
    obs.fire('OBS_WEBSOCKET_OUTPUT_STARTED')
    expect(service.state().session!.offsetMs).toBe(-5000)
    obs.fire('OBS_WEBSOCKET_OUTPUT_STOPPED', 'C:/Videos/2026-09-27 20-00-05.mkv')
    await flush()
    await service.stop()
    const session = await service.read(id)
    expect(session).toMatchObject({ offsetMs: -5000, offsetSource: 'obs', recordingPath: 'C:/Videos/2026-09-27 20-00-05.mkv' })
  })

  it('始める前・終わった後は話せない。記録の ID は決まった形だけ受け付ける', async () => {
    const { service } = setup()
    await expect(service.say('まだ', 'chat')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(service.read('../../etc/passwd')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})

describe('ライブの依頼文', () => {
  it('短く答えるよう指示し、直近の会話を交互の発言として渡す(目印は渡さない)', () => {
    const entries = [
      { id: 'a', atMs: 0, role: 'user', text: 'ボス強い', kind: 'chat', bookmarked: false, adoptedItemId: null, generatedBy: null },
      { id: 'b', atMs: 1, role: 'user', text: 'どうしよう', kind: 'chat', bookmarked: false, adoptedItemId: null, generatedBy: null },
      { id: 'c', atMs: 2, role: 'user', text: '目印', kind: 'marker', bookmarked: true, adoptedItemId: null, generatedBy: null }
    ] as const
    const prompt = buildLivePrompt(profile, [...entries], 80)
    expect(prompt.system).toContain('40文字以内')
    expect(prompt.system).toContain('やばい')
    expect(prompt.turns).toEqual([{ role: 'user', content: 'ボス強い\nどうしよう' }])
  })

  it('返事の飾りを外し、長すぎれば文の切れ目で切る', () => {
    expect(tidyLiveReply('四国めたん: 落ち着きなさい', '四国めたん', 80)).toBe('落ち着きなさい')
    const long = 'まずは落ち着きなさい。'.repeat(20)
    const tidy = tidyLiveReply(long, '四国めたん', 40)
    expect(tidy.length).toBeLessThanOrEqual(60)
    expect(tidy.endsWith('。')).toBe(true)
  })
})

describe('文字起こし(模擬の whisper.cpp)', () => {
  it('録音を 16kHz モノラルにして whisper に渡し、文字を返す', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zunda-stt-'))
    const settings = defaultSettings()
    const model = join(directory, 'ggml-small.bin')
    writeFileSync(model, 'model')
    settings.speech.whisperPath = join(FIXTURE_BIN, 'whisper-cli')
    settings.speech.whisperModelPath = model
    const recorded = join(directory, 'talk.ogg')
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', '-ac', '2', '-ar', '48000', '-c:a', 'libopus', recorded])
    const transcriber = new Transcriber(() => settings, new FfmpegLocator(() => settings), directory)
    expect(await transcriber.transcribe(readFileSync(recorded).toString('base64'))).toBe('ボスの弱点はどこなのだ')

    settings.speech.whisperModelPath = null
    await expect(transcriber.transcribe(readFileSync(recorded).toString('base64'))).rejects.toMatchObject({ code: 'STT_UNAVAILABLE' })
  })
})

// ---------------------------------------------------------------- 編集画面での扱い

let counter = 0
const context = (): CommandContext => ({ newId: (prefix) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') })
const apply = (project: Project, commands: Command[]): Project => applyCommands(project, commands, context()).project

function sessionFixture(): LiveSession {
  return {
    id: 'ses_abcdef',
    startedAt: '2026-09-27T20:00:00Z',
    endedAt: '2026-09-27T21:00:00Z',
    recordingAssetId: null,
    offsetMs: 12_000,
    offsetSource: 'obs',
    entries: [
      { id: 'ent_1', atMs: 3000, role: 'user', text: 'このボス強いのだ', kind: 'chat', bookmarked: false, adoptedItemId: null, generatedBy: null },
      {
        id: 'ent_2',
        atMs: 5000,
        role: 'ai',
        text: '足元を見ることね',
        kind: 'chat',
        bookmarked: false,
        adoptedItemId: null,
        generatedBy: { providerId: 'opencode', model: 'opencode-go/fast', at: 'x' }
      },
      { id: 'ent_3', atMs: 60_000, role: 'user', text: '目印', kind: 'marker', bookmarked: true, adoptedItemId: null, generatedBy: null }
    ]
  }
}

function projectWithRecording(): Project {
  return apply(createEmptyProject(), [
    { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん', tempId: 'z' },
    {
      op: 'character.create',
      name: '四国めたん',
      engineId: 'voicevox',
      speakerId: 2,
      speakerName: '四国めたん',
      authorRole: 'ai',
      persona: { personality: '', speechStyle: '', banterRole: 'tsukkomi', forbidden: [], targetLengthChars: 30 },
      tempId: 'm'
    },
    {
      op: 'asset.add',
      asset: {
        type: 'video',
        path: { absolute: '/rec/2026-09-27.mkv', relative: null },
        license: { source: '自分で録画', creditRequired: false },
        durationMs: 3_600_000,
        width: 1920,
        height: 1080,
        fps: 60,
        hasAudio: true
      },
      tempId: 'rec'
    },
    // 録画の 10秒目〜70秒目を、タイムラインの 2秒目から置く
    { op: 'media.placeVideo', assetId: 'rec', atMs: 2000, inMs: 10_000, outMs: 70_000 }
  ])
}

describe('ライブの記録と録画・タイムラインの時刻', () => {
  it('録画に結び付けると、発言はその録画を置いた位置に対応する', () => {
    const project = projectWithRecording()
    const assetId = Object.keys(project.assets)[0]!
    const session = { ...sessionFixture(), recordingAssetId: assetId }
    // 録画上 12000+3000=15000ms → 切り出し開始 10000ms から 5000ms 後 → タイムライン 7000ms
    expect(entryTimelineMs(project, session, session.entries[0]!)).toBe(7000)
    // 録画上 72000ms は置いた範囲の外
    expect(entryTimelineMs(project, session, session.entries[2]!)).toBeNull()
    // 結び付けていなければ、録画を 0 秒から置いたものとみなす
    expect(entryTimelineMs(project, sessionFixture(), sessionFixture().entries[0]!)).toBe(15_000)
    // ずれの調整: 「この発言はタイムラインの 9 秒目の話」→ 録画上 17000ms → offset 14000
    expect(offsetForAlignment(project, session, session.entries[0]!, 9000)).toBe(14_000)
  })

  it('取り込み・結び付け・採用。採用すると役に合うキャラクターのセリフになり、二重には採用できない', () => {
    let project = projectWithRecording()
    const assetId = Object.keys(project.assets)[0]!
    project = apply(project, [
      { op: 'live.importSession', session: sessionFixture() },
      { op: 'live.linkRecording', sessionId: 'ses_abcdef', assetId },
      { op: 'script.adoptLiveEntry', sessionId: 'ses_abcdef', entryId: 'ent_2' }
    ])
    const line = project.items.find((item) => item.type === 'voice')!
    expect(line).toMatchObject({ text: '足元を見ることね', startMs: 9000, generatedBy: { model: 'opencode-go/fast' } })
    expect(project.characters[(line as { characterId: string }).characterId]!.name).toBe('四国めたん')
    expect(project.liveSessions['ses_abcdef']!.entries[1]!.adoptedItemId).toBe(line.id)
    expect(() => apply(project, [{ op: 'script.adoptLiveEntry', sessionId: 'ses_abcdef', entryId: 'ent_2' }])).toThrow('採用済み')
    expect(() => apply(project, [{ op: 'script.adoptLiveEntry', sessionId: 'ses_abcdef', entryId: 'ent_3' }])).toThrow('目印')

    // 採用したセリフを消せば、もう一度採用できる
    const removed = apply(project, [{ op: 'item.delete', itemId: line.id }])
    expect(removed.liveSessions['ses_abcdef']!.entries[1]!.adoptedItemId).toBeNull()
  })

  it('手で直したずれは、取り込み直しても残り、新しい発言だけが足される', () => {
    let project = apply(projectWithRecording(), [{ op: 'live.importSession', session: sessionFixture() }])
    project = apply(project, [{ op: 'live.setOffset', sessionId: 'ses_abcdef', offsetMs: 8000 }])
    const updated = sessionFixture()
    updated.entries.push({ id: 'ent_4', atMs: 90_000, role: 'user', text: '追加', kind: 'chat', bookmarked: false, adoptedItemId: null, generatedBy: null })
    project = apply(project, [{ op: 'live.importSession', session: updated }])
    expect(project.liveSessions['ses_abcdef']).toMatchObject({ offsetMs: 8000, offsetSource: 'manual' })
    expect(project.liveSessions['ses_abcdef']!.entries).toHaveLength(4)
    project = apply(project, [{ op: 'live.removeSession', sessionId: 'ses_abcdef' }])
    expect(project.liveSessions).toEqual({})
  })
})
