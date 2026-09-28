import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { nanoid } from 'nanoid'

import { buildLivePrompt, tidyLiveReply } from '@shared/ai/live'
import type { LiveLogLine, LiveProfile, LiveSessionSummary, LiveState, ObsStatus } from '@shared/live/types'
import type { LiveEntry, LiveSession, Ms } from '@shared/project/types'
import type { AppSettings } from '@shared/settings/schema'

import { AppError } from '../../core/errors'
import type { EventBus } from '../../core/events'
import type { AiService } from '../ai/ai-service'
import type { ObsConnection, ObsConnector } from './obs-link'
import type { Transcriber } from './transcriber'

type ActiveSession = LiveSession & { recordingPath: string | null; startedAtMs: number }

const SESSION_ID_PATTERN = /^ses_[A-Za-z0-9_-]{4,40}$/

/**
 * 録画中の会話(ライブモード)。発言は1件ごとに JSONL へ追記し、途中でアプリが落ちても失わない。
 * 録画上の時刻は offsetMs + atMs。offsetMs は OBS から自動で、または編集時に手で決める。
 */
export class LiveService {
  private profile: LiveProfile | null = null
  private session: ActiveSession | null = null
  private thinking = false
  private obs: ObsConnection | null = null
  private obsStatus: ObsStatus = { state: 'disabled' }
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly directory: string,
    private readonly ai: AiService,
    private readonly getSettings: () => AppSettings,
    private readonly events: EventBus,
    private readonly connectObs: ObsConnector,
    private readonly transcriber: Transcriber,
    private readonly now: () => number = () => Date.now()
  ) {}

  state(): LiveState {
    const session = this.session
    return {
      profile: this.profile,
      session: session ? { ...stripInternal(session), entries: [...session.entries] } : null,
      obs: this.obsStatus,
      thinking: this.thinking
    }
  }

  setProfile(profile: LiveProfile): LiveState {
    this.profile = profile
    this.emit()
    return this.state()
  }

  async start(): Promise<LiveState> {
    if (!this.profile) throw new AppError('INVALID_ARGUMENT', '相方の設定がありません。編集画面の「ライブ」から開いてください')
    if (this.session) return this.state()
    const startedAtMs = this.now()
    const id = `ses_${nanoid(12)}`
    this.session = {
      id,
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: null,
      recordingAssetId: null,
      offsetMs: 0,
      offsetSource: 'unknown',
      entries: [],
      recordingPath: null,
      startedAtMs
    }
    await mkdir(this.directory, { recursive: true })
    await this.write({ type: 'session', id, startedAt: this.session.startedAt, profile: this.profile })
    this.emit()
    void this.connectToObs()
    return this.state()
  }

  /** 発言を記録し、相方の返答をもらう。メモなら返答はもらわない。 */
  async say(text: string, kind: 'chat' | 'question' | 'note' = 'chat'): Promise<LiveEntry[]> {
    const session = this.requireSession()
    const trimmed = text.trim()
    if (trimmed === '') throw new AppError('INVALID_ARGUMENT', '発言が空です')
    const userEntry = await this.append({ role: 'user', text: trimmed, kind, bookmarked: false, generatedBy: null })
    if (kind === 'note') return [userEntry]

    this.thinking = true
    this.emit()
    try {
      const maxChars = this.getSettings().ai.liveMaxChars
      const prompt = { ...buildLivePrompt(this.profile!, session.entries, maxChars), session: `live:${session.id}` }
      const result = await this.ai.generate('conversation', prompt, {
        projectConversation: this.profile!.model
      })
      const reply = tidyLiveReply(result.text, this.profile!.aiName, maxChars)
      const aiEntry = await this.append({
        role: 'ai',
        text: reply === '' ? '(返答が空でした)' : reply,
        kind: kind === 'question' ? 'question' : 'chat',
        bookmarked: false,
        generatedBy: result.generatedBy
      })
      return [userEntry, aiEntry]
    } finally {
      this.thinking = false
      this.emit()
    }
  }

  /** 目印を打つ(R-9)。「ここ面白かった」のように一言添えられる。 */
  async mark(text = ''): Promise<LiveEntry> {
    this.requireSession()
    return this.append({ role: 'user', text: text.trim() === '' ? '目印' : text.trim(), kind: 'marker', bookmarked: true, generatedBy: null })
  }

  async stop(): Promise<LiveState> {
    const session = this.session
    if (!session) return this.state()
    const endedAt = new Date(this.now()).toISOString()
    await this.write({ type: 'end', endedAt })
    this.session = null
    await this.disconnectObs()
    this.emit()
    return this.state()
  }

  transcribe(audio: string): Promise<string> {
    return this.transcriber.transcribe(audio)
  }

  async list(): Promise<LiveSessionSummary[]> {
    let files: string[]
    try {
      files = (await readdir(this.directory)).filter((file) => file.endsWith('.jsonl'))
    } catch {
      return []
    }
    const summaries: LiveSessionSummary[] = []
    for (const file of files) {
      const parsed = await this.readFile(file.replace(/\.jsonl$/, '')).catch(() => null)
      if (!parsed) continue
      summaries.push({
        id: parsed.session.id,
        startedAt: parsed.session.startedAt,
        endedAt: parsed.session.endedAt,
        entryCount: parsed.session.entries.length,
        markerCount: parsed.session.entries.filter((entry) => entry.kind === 'marker').length,
        aiName: parsed.profile.aiName,
        projectTitle: parsed.profile.projectTitle,
        recordingPath: parsed.session.recordingPath
      })
    }
    return summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  async read(id: string): Promise<LiveSession & { recordingPath: string | null }> {
    return (await this.readFile(id)).session
  }

  async dispose(): Promise<void> {
    await this.stop()
  }

  // ---------------------------------------------------------------- 内部

  private requireSession(): ActiveSession {
    if (!this.session) throw new AppError('INVALID_ARGUMENT', 'ライブが始まっていません')
    return this.session
  }

  private async append(fields: Omit<LiveEntry, 'id' | 'atMs' | 'adoptedItemId'>): Promise<LiveEntry> {
    const session = this.requireSession()
    const entry: LiveEntry = { id: `ent_${nanoid(10)}`, atMs: Math.max(0, this.now() - session.startedAtMs), adoptedItemId: null, ...fields }
    session.entries.push(entry)
    await this.write({ type: 'entry', entry })
    this.events.emit('live:entry', { sessionId: session.id, entry })
    this.emit()
    return entry
  }

  /** 1行ずつ順番に追記する(同時に書くと行が混ざるため)。 */
  private write(line: LiveLogLine): Promise<void> {
    const session = this.session
    if (!session) return Promise.resolve()
    const path = join(this.directory, `${session.id}.jsonl`)
    this.writeQueue = this.writeQueue.then(() => appendFile(path, `${JSON.stringify(line)}\n`, 'utf8'))
    return this.writeQueue
  }

  private setOffset(offsetMs: Ms, recordingPath?: string): void {
    const session = this.session
    if (!session) return
    session.offsetMs = Math.round(offsetMs)
    session.offsetSource = 'obs'
    if (recordingPath) session.recordingPath = recordingPath
    void this.write({ type: 'offset', offsetMs: session.offsetMs, source: 'obs', ...(recordingPath ? { recordingPath } : {}) })
    this.emit()
  }

  private async connectToObs(): Promise<void> {
    const settings = this.getSettings().obs
    if (!settings.enabled) {
      this.obsStatus = { state: 'disabled' }
      return
    }
    this.obsStatus = { state: 'connecting' }
    this.emit()
    try {
      const obs = await this.connectObs(settings.url, settings.password)
      this.obs = obs
      const status = await obs.recordStatus()
      // 既に録画中なら、今が録画の何ミリ秒目かが、そのままセッション開始の録画上の時刻になる。
      if (status.active) this.setOffset(status.durationMs)
      this.obsStatus = { state: 'connected', recording: status.active }
      obs.onRecordState((event) => {
        const session = this.session
        if (!session) return
        if (event.state === 'OBS_WEBSOCKET_OUTPUT_STARTED') {
          // セッションの途中で録画が始まったら、録画の 0 秒はセッションの「今」にあたる。
          this.setOffset(-(this.now() - session.startedAtMs))
        } else if (event.state === 'OBS_WEBSOCKET_OUTPUT_STOPPED' && event.outputPath) {
          this.setOffset(session.offsetMs, event.outputPath)
        }
        this.obsStatus = { state: 'connected', recording: event.active }
        this.emit()
      })
      obs.onClose(() => {
        this.obs = null
        if (this.session) this.obsStatus = { state: 'error', message: 'OBS との接続が切れました' }
        this.emit()
      })
    } catch (error) {
      this.obsStatus = { state: 'error', message: `OBS に接続できません: ${error instanceof Error ? error.message : String(error)}` }
    }
    this.emit()
  }

  private async disconnectObs(): Promise<void> {
    const obs = this.obs
    this.obs = null
    this.obsStatus = { state: 'disabled' }
    if (obs) await obs.disconnect().catch(() => {})
  }

  private async readFile(id: string): Promise<{ profile: LiveProfile; session: LiveSession & { recordingPath: string | null } }> {
    if (!SESSION_ID_PATTERN.test(id)) throw new AppError('INVALID_ARGUMENT', `セッションIDが不正です: ${id}`)
    const raw = await readFile(join(this.directory, `${id}.jsonl`), 'utf8').catch(() => {
      throw new AppError('NOT_FOUND', `ライブの記録が見つかりません: ${id}`)
    })
    let profile: LiveProfile | null = null
    const session: LiveSession & { recordingPath: string | null } = {
      id,
      startedAt: '',
      endedAt: null,
      recordingAssetId: null,
      offsetMs: 0,
      offsetSource: 'unknown',
      entries: [],
      recordingPath: null
    }
    for (const text of raw.split('\n')) {
      if (text.trim() === '') continue
      let line: LiveLogLine
      try {
        line = JSON.parse(text) as LiveLogLine
      } catch {
        // 書き込みの途中で落ちた最後の行は読めないことがある。それ以外は読めた分を使う。
        continue
      }
      if (line.type === 'session') {
        profile = line.profile
        session.startedAt = line.startedAt
      } else if (line.type === 'entry') {
        session.entries.push(line.entry)
      } else if (line.type === 'offset') {
        session.offsetMs = line.offsetMs
        session.offsetSource = line.source
        if (line.recordingPath) session.recordingPath = line.recordingPath
      } else if (line.type === 'end') {
        session.endedAt = line.endedAt
      }
    }
    if (!profile) throw new AppError('INVALID_ARGUMENT', `ライブの記録が壊れています: ${id}`)
    return { profile, session }
  }

  private emit(): void {
    this.events.emit('live:state', this.state())
  }
}

function stripInternal(session: ActiveSession): LiveSession & { recordingPath: string | null } {
  const { startedAtMs: _startedAtMs, ...rest } = session
  return rest
}
