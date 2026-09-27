import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { z } from 'zod'

import { buildCohostPrompt, cohostResponseSchema, interpretCohostResponse } from '@shared/ai/cohost'
import { editorResponseSchema, toCommands } from '@shared/ai/edit-commands'
import { buildEditorPrompt } from '@shared/ai/editor'
import { PROVIDER_IDS } from '@shared/ai/types'
import type { Channel, ChannelArgs, ChannelResult, IpcResult } from '@shared/ipc/contract'
import type { Project } from '@shared/project/types'
import type { SettingsPatch } from '@shared/settings/schema'

import { PROJECT_FILE_EXTENSION } from '../services/project/store'
import { writeFileAtomic } from './fs'
import { AppError, toErrorShape } from './errors'
import type { Services } from './services'

export type Handler<C extends Channel> = (...args: ChannelArgs<C>) => Promise<ChannelResult<C>>
export type HandlerTable = { [C in Channel]: Handler<C> }

/**
 * レンダラから届く引数の検証。レンダラは main より信頼度が低い前提で、境界で型を確かめる。
 * プロジェクト本体は巨大なので構造の要所だけ確かめ、中身の整合性はコマンド適用側が保証する。
 */
const pathArg = z.string().min(1).max(4096)
const projectArg = z
  .object({
    formatVersion: z.number(),
    meta: z.object({ title: z.string() }).loose(),
    assets: z.record(z.string(), z.object({ path: z.object({ absolute: z.string() }).loose() }).loose()),
    items: z.array(z.object({ id: z.string(), type: z.string() }).loose())
  })
  .loose()

const engineIdArg = z.string().min(1).max(100)
const personaSchema = z.object({
  personality: z.string().max(2000),
  speechStyle: z.string().max(2000),
  banterRole: z.enum(['tsukkomi', 'boke', 'navigator', 'free']),
  forbidden: z.array(z.string().max(200)).max(200),
  targetLengthChars: z.number().int().min(1).max(1000)
})
const accentPhraseSchema = z
  .object({
    moras: z.array(z.object({ text: z.string(), vowel: z.string(), vowelLength: z.number(), pitch: z.number() }).loose()),
    accent: z.number(),
    pauseMora: z.object({ vowel: z.string() }).loose().nullable(),
    isInterrogative: z.boolean()
  })
  .loose()
const voiceParamsSchema = z.object({
  speedScale: z.number().min(0.25).max(4),
  pitchScale: z.number().min(-0.3).max(0.3),
  intonationScale: z.number().min(0).max(2),
  volumeScale: z.number().min(0).max(4),
  prePhonemeLength: z.number().min(0).max(3),
  postPhonemeLength: z.number().min(0).max(3)
})
const synthesisRequestSchema = z.object({
  engineId: engineIdArg,
  speakerId: z.number().int().min(0),
  text: z.string().max(2000),
  params: voiceParamsSchema,
  accentPhrases: z.array(accentPhraseSchema).nullable().optional(),
  kana: z.string().max(4000).nullable().optional()
})

const ARG_SCHEMAS: { [C in Channel]: z.ZodType<ChannelArgs<C>> } = {
  'app:info': z.tuple([]),
  'settings:get': z.tuple([]),
  'settings:update': z.tuple([z.record(z.string(), z.unknown())]) as unknown as z.ZodType<[SettingsPatch]>,
  'dialog:pick': z.tuple([
    z.object({
      kind: z.enum([
        'openProject',
        'saveProject',
        'video',
        'media',
        'audio',
        'image',
        'psd',
        'persona',
        'exportVideo',
        'exportText',
        'executable',
        'any'
      ]),
      defaultName: z.string().max(255).optional(),
      multiple: z.boolean().optional()
    })
  ]) as unknown as z.ZodType<ChannelArgs<'dialog:pick'>>,
  'project:read': z.tuple([pathArg]),
  'project:write': z.tuple([pathArg, projectArg]) as unknown as z.ZodType<[string, Project]>,
  'ai:providers': z.tuple([]),
  'ai:models': z.tuple([z.enum(PROVIDER_IDS)]),
  'ai:test': z.tuple([z.enum(PROVIDER_IDS), z.string().min(1).max(200)]),
  'voice:engines': z.tuple([]),
  'voice:ensure': z.tuple([engineIdArg]),
  'voice:speakers': z.tuple([engineIdArg]),
  'voice:synthesize': z.tuple([synthesisRequestSchema]) as unknown as z.ZodType<ChannelArgs<'voice:synthesize'>>,
  'voice:resolve': z.tuple([z.string().max(100)]),
  'voice:dict:list': z.tuple([engineIdArg]),
  'voice:dict:add': z.tuple([
    engineIdArg,
    z.object({
      surface: z.string().min(1).max(100),
      pronunciation: z.string().min(1).max(200),
      accentType: z.number().int().min(0),
      priority: z.number().int().min(0).max(10)
    })
  ]),
  'voice:dict:delete': z.tuple([engineIdArg, z.string().min(1).max(100)]),
  'psd:load': z.tuple([pathArg]),
  'ai:cohost': z.tuple([
    projectArg,
    z.object({
      afterItemId: z.string().max(100).nullable(),
      candidates: z.number().int().min(1).max(5),
      rounds: z.number().int().min(1).max(6),
      characterId: z.string().max(100).optional(),
      instruction: z.string().max(2000).optional()
    })
  ]) as unknown as z.ZodType<ChannelArgs<'ai:cohost'>>,
  'ai:edit': z.tuple([
    projectArg,
    z.object({
      message: z.string().min(1).max(8000),
      selection: z.array(z.string().max(100)).max(1000),
      history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20_000) })).max(100)
    })
  ]) as unknown as z.ZodType<ChannelArgs<'ai:edit'>>,
  'media:probe': z.tuple([pathArg]),
  'media:proxy': z.tuple([pathArg, z.enum(['mp4', 'webm'])]),
  'media:peaks': z.tuple([pathArg]),
  'export:start': z.tuple([
    z
      .object({
        project: projectArg,
        outputPath: pathArg,
        startMs: z.number().min(0).optional(),
        endMs: z.number().min(0).optional(),
        fps: z.number().int().min(1).max(120).optional(),
        height: z.number().int().min(144).max(4320).optional(),
        crf: z.number().int().min(0).max(51).optional()
      })
      .loose()
  ]) as unknown as z.ZodType<ChannelArgs<'export:start'>>,
  'export:cancel': z.tuple([z.string().min(1).max(100)]),
  'live:setProfile': z.tuple([
    z
      .object({
        aiName: z.string().min(1).max(100),
        persona: z.object({ personality: z.string(), speechStyle: z.string(), banterRole: z.string(), forbidden: z.array(z.string()), targetLengthChars: z.number() }).loose().nullable(),
        userName: z.string().min(1).max(100),
        model: z.object({ providerId: z.enum(PROVIDER_IDS), model: z.string().min(1).max(200) }).nullable(),
        voice: z.object({ engineId: z.string().max(100), speakerId: z.number(), params: voiceParamsSchema }).nullable(),
        projectTitle: z.string().max(200)
      })
      .loose()
  ]) as unknown as z.ZodType<ChannelArgs<'live:setProfile'>>,
  'live:state': z.tuple([]),
  'live:start': z.tuple([]),
  'live:say': z.tuple([z.string().min(1).max(4000), z.enum(['chat', 'question', 'note'])]),
  'live:mark': z.tuple([z.string().max(400)]),
  'live:stop': z.tuple([]),
  'live:transcribe': z.tuple([z.string().min(1).max(30 * 1024 * 1024)]),
  'live:list': z.tuple([]),
  'live:read': z.tuple([z.string().min(1).max(100)]),
  'live:openWindow': z.tuple([]),
  'autosave:write': z.tuple([z.string().min(1).max(40), pathArg.nullable(), projectArg]) as unknown as z.ZodType<ChannelArgs<'autosave:write'>>,
  'autosave:list': z.tuple([]),
  'persona:read': z.tuple([pathArg]),
  'autosave:read': z.tuple([z.string().min(1).max(40)]),
  'autosave:clear': z.tuple([z.string().min(1).max(40)]),
  'export:text': z.tuple([pathArg, z.string().max(1_000_000)])
}

export function createHandlers(services: Services): HandlerTable {
  return {
    'app:info': () =>
      Promise.resolve({
        appVersion: services.appVersion,
        runtime: services.runtime,
        platform: process.platform,
        projectFileExtension: PROJECT_FILE_EXTENSION
      }),

    'settings:get': () => Promise.resolve(services.settings.get()),
    'settings:update': (patch) => services.settings.update(patch),

    'dialog:pick': async (request) => {
      const picked = await services.picker.pick(request)
      // 素材として選ばれたファイルは、プレビューで読めるよう配信を許可する。
      if (picked && ['video', 'audio', 'image', 'media', 'psd'].includes(request.kind)) {
        services.media.allowFiles(picked)
      }
      if (picked && request.kind === 'persona') {
        for (const path of picked) services.readableFiles.add(resolve(path))
      }
      // 書き出し先は、保存ダイアログで選ばれた場所だけを受け付ける。
      if (picked && ['exportVideo', 'exportText'].includes(request.kind)) {
        for (const path of picked) services.saveTargets.add(resolve(path))
      }
      return picked
    },

    'project:read': (path) => services.projects.read(path),
    'project:write': async (path, project) => {
      const written = await services.projects.write(path, project)
      const recent = [path, ...services.settings.get().recentProjects.filter((item) => item !== path)]
      await services.settings.update({ recentProjects: recent.slice(0, 10) })
      return written
    },

    'ai:providers': () => services.ai.statuses(),
    'ai:models': (providerId) => services.ai.models(providerId),
    'ai:test': async (providerId, model) => {
      const result = await services.ai
        .provider(providerId)
        .generate(model, {
          system: '接続確認です。指示に従って短く答えてください。',
          turns: [{ role: 'user', content: '「接続できたのだ」とだけ返してください。' }]
        })
      return { text: result.text, durationMs: result.durationMs }
    },

    'ai:cohost': async (project, request) => {
      if (!Object.values(project.characters).some((character) => character.authorRole === 'ai') && !request.characterId) {
        throw new AppError('INVALID_ARGUMENT', '相方(AIの役)のキャラクターがいません。キャラクター画面で「AI(相方)」にしてください')
      }
      const { value, result } = await services.ai.generateStructured('conversation', buildCohostPrompt(project, request), cohostResponseSchema, {
        projectConversation: project.ai.conversation
      })
      return { candidates: interpretCohostResponse(project, request, value), generatedBy: result.generatedBy }
    },
    'ai:edit': async (project, request) => {
      const { value, result } = await services.ai.generateStructured('editor', buildEditorPrompt(project, request), editorResponseSchema)
      return { reply: value.reply, commands: toCommands(value.commands), generatedBy: result.generatedBy }
    },

    'voice:engines': () => Promise.resolve(services.engines.statusList()),
    'voice:ensure': (engineId) => services.engines.ensure(engineId),
    'voice:speakers': async (engineId) => (await services.engines.require(engineId)).speakers(),
    'voice:synthesize': async (request) => {
      if (request.text.trim() === '' && !request.accentPhrases && !request.kana) {
        throw new AppError('INVALID_ARGUMENT', 'セリフが空です')
      }
      return services.synthesis.synthesize(request)
    },
    'voice:resolve': (cacheKey) => services.synthesis.resolve(cacheKey),
    'voice:dict:list': async (engineId) => (await services.engines.require(engineId)).userDict(),
    'voice:dict:add': async (engineId, word) => {
      const id = await (await services.engines.require(engineId)).addUserDictWord(word)
      await services.synthesis.bumpDictionary(engineId)
      return id
    },
    'voice:dict:delete': async (engineId, wordId) => {
      await (await services.engines.require(engineId)).deleteUserDictWord(wordId)
      await services.synthesis.bumpDictionary(engineId)
    },

    'psd:load': (path) => {
      // 利用者が選んだ・プロジェクトに登録された PSD に限る(任意のファイルを解析させない)。
      if (!services.media.isAllowed(path)) {
        return Promise.reject(new AppError('ACCESS_DENIED', 'プロジェクトに登録されていない PSD は読み込めません'))
      }
      return services.psd.load(path)
    },

    'media:probe': (path) => requireAllowed(services, path).then(() => services.mediaTools.probe(path)),
    'media:proxy': (path, format) => requireAllowed(services, path).then(() => services.mediaTools.proxy(path, format)),
    'media:peaks': (path) => requireAllowed(services, path).then(() => services.mediaTools.peaks(path)),

    'export:start': (request) => {
      // 書き出し先は保存ダイアログで選ばれた場所に限る(任意の場所へ書かせない)。
      if (!services.saveTargets.has(resolve(request.outputPath))) {
        return Promise.reject(new AppError('ACCESS_DENIED', '書き出し先は保存ダイアログで選んでください'))
      }
      for (const asset of Object.values(request.project.assets)) services.media.allowFile(asset.path.absolute)
      return Promise.resolve(services.exporter.start(request))
    },
    'export:cancel': (jobId) => Promise.resolve(services.exporter.cancel(jobId)),

    'live:setProfile': (profile) => Promise.resolve(services.live.setProfile(profile)),
    'live:state': () => Promise.resolve(services.live.state()),
    'live:start': async () => {
      const state = await services.live.start()
      registerLiveHotkeys(services)
      return state
    },
    'live:say': (text, kind) => services.live.say(text, kind),
    'live:mark': (text) => services.live.mark(text),
    'live:stop': async () => {
      services.windows?.unregisterHotkeys()
      return services.live.stop()
    },
    'live:transcribe': (audio) => services.live.transcribe(audio),
    'live:list': () => services.live.list(),
    'live:read': (sessionId) => services.live.read(sessionId),
    'live:openWindow': () => Promise.resolve(services.windows?.openLive() ?? false),

    'autosave:write': (key, filePath, project) => services.autosave.write(key, filePath, project),
    'autosave:list': () => services.autosave.list(),
    'persona:read': async (path) => {
      if (!services.readableFiles.has(resolve(path))) throw new AppError('ACCESS_DENIED', 'ファイルはファイル選択で選んでください')
      let raw: unknown
      try {
        raw = JSON.parse(await readFile(path, 'utf8'))
      } catch {
        throw new AppError('INVALID_ARGUMENT', '相方の設定として読めないファイルです')
      }
      const envelope = raw as { persona?: unknown }
      const parsed = personaSchema.safeParse(envelope.persona ?? raw)
      if (!parsed.success) throw new AppError('INVALID_ARGUMENT', '相方の設定として読めないファイルです')
      return parsed.data
    },
    'autosave:read': async (key) => {
      const project = await services.autosave.read(key)
      // 復元したプロジェクトの素材は、元のファイルを開いたときと同じく配信を許可する。
      for (const asset of Object.values(project.assets)) services.media.allowFile(asset.path.absolute)
      return project
    },
    'autosave:clear': (key) => services.autosave.clear(key),
    'export:text': async (path, text) => {
      if (!services.saveTargets.has(resolve(path))) throw new AppError('ACCESS_DENIED', '保存先は保存ダイアログで選んでください')
      await writeFileAtomic(path, text)
    }
  }
}

/** ライブ中だけ、ゲームを操作したまま使えるホットキーを登録する(R-9)。 */
function registerLiveHotkeys(services: Services): void {
  const windows = services.windows
  if (!windows) return
  const { markerHotkey, pushToTalkHotkey } = services.settings.get().live
  windows.unregisterHotkeys()
  windows.registerHotkey(markerHotkey, () => void services.live.mark().catch(() => {}))
  windows.registerHotkey(pushToTalkHotkey, () => services.events.emit('live:hotkey', { action: 'toggle-talk' }))
}

/** 利用者が選んだ・プロジェクトに登録された素材に限る(任意のファイルを ffmpeg に読ませない)。 */
function requireAllowed(services: Services, path: string): Promise<void> {
  if (services.media.isAllowed(path)) return Promise.resolve()
  return Promise.reject(new AppError('ACCESS_DENIED', 'プロジェクトに登録されていないファイルは扱えません'))
}

/**
 * どの経路(Electron IPC / HTTP)から来た呼び出しも、ここで検証・実行・結果の包装を行う。
 */
export async function dispatch(
  handlers: HandlerTable,
  channel: string,
  args: unknown
): Promise<IpcResult<unknown>> {
  try {
    if (!Object.hasOwn(handlers, channel)) {
      throw new AppError('INVALID_ARGUMENT', `不明なチャネルです: ${channel}`)
    }
    const typedChannel = channel as Channel
    const parsed = ARG_SCHEMAS[typedChannel].safeParse(args)
    if (!parsed.success) {
      throw new AppError(
        'INVALID_ARGUMENT',
        `引数が不正です: ${channel}`,
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n')
      )
    }
    const handler = handlers[typedChannel] as (...values: unknown[]) => Promise<unknown>
    const value = await handler(...(parsed.data as unknown[]))
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error: toErrorShape(error) }
  }
}
