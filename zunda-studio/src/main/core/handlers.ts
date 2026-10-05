import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { z } from 'zod'

import { buildCohostPrompt, cohostResponseSchema, interpretCohostResponse, MAX_CLIP_FRAMES, visionNote, visionTimes } from '@shared/ai/cohost'
import { editorResponseSchema, toCommands } from '@shared/ai/edit-commands'
import {
  applyCheckResults,
  briefingCheckSchema,
  briefingResponseSchema,
  buildBriefingPrompt,
  buildCheckPrompt,
  factsToCheck,
  interpretBriefing,
  mapCheckIds,
  validateBriefing
} from '@shared/ai/briefing'
import { buildDraftPrompt, liveMomentsFor, wrapDraftCommands } from '@shared/ai/draft'
import { buildEditorPrompt } from '@shared/ai/editor'
import { buildExplainerPrompt, explainerResponseSchema, interpretExplainer, MAX_IMAGE_SOURCES } from '@shared/ai/explainer'
import { buildPortraitPrompt, filterPortraitCommands, portraitResponseSchema } from '@shared/ai/portraits'
import { candidateSegments } from '@shared/media/analysis'
import { buildPublishPrompt, interpretPublishResponse, publishResponseSchema } from '@shared/ai/publish'
import { PROVIDER_IDS, projectSession } from '@shared/ai/types'
import type { CacheInfo, Channel, ChannelArgs, ChannelResult, IpcResult } from '@shared/ipc/contract'
import type { SavedCharacter } from '@shared/project/character-library'
import type { ProjectTemplate } from '@shared/project/templates'
import type { Project } from '@shared/project/types'
import type { SettingsPatch } from '@shared/settings/schema'
import { SECRET_NAMES } from '@shared/settings/secrets'

import { PROJECT_FILE_EXTENSION } from '../services/project/store'
import { grabFrames } from '../services/media/frame-grabber'
import { cacheTargetFor, copyCache, directorySize, finishCacheMove, freeSpace } from './cache-location'
import { writeFileAtomic } from './fs'
import { AppError, toErrorShape } from './errors'
import type { Services } from './services'

export type Handler<C extends Channel> = (...args: ChannelArgs<C>) => Promise<ChannelResult<C>>
export type HandlerTable = { [C in Channel]: Handler<C> }

/** 相方に見せる画面の画質と範囲(範囲は録画に対する割合)。 */
const visionOptionsShape = {
  quality: z.enum(['standard', 'high']).optional(),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).optional()
}

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
  'app:relaunch': z.tuple([]),
  'cache:info': z.tuple([]),
  'cache:move': z.tuple([pathArg.nullable()]),
  'settings:get': z.tuple([]),
  'settings:update': z.tuple([z.record(z.string(), z.unknown())]) as unknown as z.ZodType<[SettingsPatch]>,
  'secrets:status': z.tuple([]),
  'secrets:set': z.tuple([z.enum(SECRET_NAMES), z.string().max(1000).nullable()]),
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
        'exportImage',
        'executable',
        'directory',
        'any'
      ]),
      defaultName: z.string().max(255).optional(),
      multiple: z.boolean().optional()
    })
  ]) as unknown as z.ZodType<ChannelArgs<'dialog:pick'>>,
  'project:read': z.tuple([pathArg]),
  'project:write': z.tuple([pathArg, projectArg]) as unknown as z.ZodType<[string, Project]>,
  'project:forgetRecent': z.tuple([pathArg]),
  'ai:providers': z.tuple([]),
  'ai:models': z.tuple([z.enum(PROVIDER_IDS)]),
  'ai:test': z.tuple([z.enum(PROVIDER_IDS), z.string().min(1).max(200)]),
  'voice:engines': z.tuple([]),
  'voice:ensure': z.tuple([engineIdArg]),
  'voice:install:info': z.tuple([]),
  'voice:install:start': z.tuple([]),
  'voice:install:cancel': z.tuple([]),
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
      instruction: z.string().max(2000).optional(),
      targetLengthChars: z.number().int().min(1).max(1000).optional(),
      vision: z
        .discriminatedUnion('kind', [
          z.object({ kind: z.literal('frame'), atMs: z.number().min(0), ...visionOptionsShape }),
          z.object({ kind: z.literal('frames'), times: z.array(z.number().min(0)).min(1).max(MAX_CLIP_FRAMES), ...visionOptionsShape }),
          z.object({ kind: z.literal('clip'), startMs: z.number().min(0), endMs: z.number().min(0), ...visionOptionsShape })
        ])
        .optional()
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
  'ai:publish': z.tuple([projectArg]) as unknown as z.ZodType<ChannelArgs<'ai:publish'>>,
  'ai:explainer': z.tuple([
    projectArg,
    z.object({
      topic: z.string().min(1).max(4000),
      targetSeconds: z.number().min(10).max(30 * 60),
      style: z.enum(['solo', 'dialogue']),
      narrators: z.array(z.string().min(1).max(100)).min(1).max(8),
      interjector: z.object({ characterId: z.string().min(1).max(100), frequency: z.enum(['few', 'normal', 'many']) }).nullable(),
      audience: z.string().max(1000).optional(),
      instruction: z.string().max(4000).optional(),
      images: z.boolean(),
      imageSources: z.enum(['web', 'free']).optional(),
      separateSpeech: z.boolean().optional()
    }),
    z.object({ model: z.object({ providerId: z.enum(PROVIDER_IDS), model: z.string().min(1).max(200) }).nullable(), webSearch: z.boolean() })
  ]) as unknown as z.ZodType<ChannelArgs<'ai:explainer'>>,
  'images:find': z.tuple([
    z.object({
      sources: z
        .array(
          z.object({
            pageUrl: z.string().min(1).max(2000),
            imageUrl: z.string().min(1).max(2000).nullable(),
            site: z.string().max(80),
            title: z.string().max(120),
            kind: z.enum(['primary', 'reliable']),
            reason: z.string().max(200)
          })
        )
        .max(MAX_IMAGE_SOURCES),
      queries: z.array(z.string().min(1).max(200)).max(4)
    })
  ]),
  'ai:briefing': z.tuple([projectArg]) as unknown as z.ZodType<ChannelArgs<'ai:briefing'>>,
  'ai:visionFrame': z.tuple([projectArg, z.number().min(0)]) as unknown as z.ZodType<ChannelArgs<'ai:visionFrame'>>,
  'ai:briefingCheck': z.tuple([projectArg, z.object({}).loose(), z.array(z.string().max(100)).max(100).nullable()]) as unknown as z.ZodType<
    ChannelArgs<'ai:briefingCheck'>
  >,
  'ai:portraits': z.tuple([projectArg, z.object({ instruction: z.string().max(4000).optional() })]) as unknown as z.ZodType<ChannelArgs<'ai:portraits'>>,
  'ai:draft': z.tuple([
    projectArg,
    z.object({
      recordingAssetId: z.string().min(1).max(100),
      targetMs: z.number().min(30_000).max(60 * 60 * 1000),
      instruction: z.string().max(4000).optional()
    })
  ]) as unknown as z.ZodType<ChannelArgs<'ai:draft'>>,
  'media:probe': z.tuple([pathArg]),
  'media:proxy': z.union([z.tuple([pathArg, z.enum(['mp4', 'webm'])]), z.tuple([pathArg, z.enum(['mp4', 'webm']), z.number().int().min(0).max(4320)])]),
  'media:peaks': z.tuple([pathArg]),
  'media:activity': z.tuple([pathArg]),
  'export:start': z.tuple([
    z
      .object({
        project: projectArg,
        outputPath: pathArg,
        startMs: z.number().min(0).optional(),
        endMs: z.number().min(0).optional(),
        fps: z.number().int().min(1).max(120).optional(),
        height: z.number().int().min(144).max(4320).optional(),
        crf: z.number().int().min(0).max(51).optional(),
        loudness: z.union([z.literal('off'), z.number().min(-40).max(-5)]).optional(),
        encoder: z.enum(['auto', 'cpu', 'nvenc', 'qsv', 'amf']).optional()
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
        projectTitle: z.string().max(200),
        briefing: z.string().max(20_000).optional()
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
  'characters:list': z.tuple([]),
  // 形の検証は保存するときに行う(壊れた値は保存しない)
  'characters:save': z.tuple([z.record(z.string(), z.unknown())]) as unknown as z.ZodType<[SavedCharacter]>,
  'characters:remove': z.tuple([z.string().min(1).max(100)]),
  'templates:list': z.tuple([]),
  'templates:save': z.tuple([z.record(z.string(), z.unknown())]) as unknown as z.ZodType<[ProjectTemplate]>,
  'templates:remove': z.tuple([z.string().min(1).max(100)]),
  'persona:read': z.tuple([pathArg]),
  'autosave:read': z.tuple([z.string().min(1).max(40)]),
  'autosave:clear': z.tuple([z.string().min(1).max(40)]),
  'export:text': z.tuple([pathArg, z.string().max(1_000_000)]),
  // 4K の PNG でも収まる大きさ(base64)。
  'export:image': z.tuple([pathArg, z.string().max(80_000_000).regex(/^[A-Za-z0-9+/=]*$/)])
}

export function createHandlers(services: Services): HandlerTable {
  /** 開いた・保存したプロジェクトを「最近開いたプロジェクト」の先頭に置く(10件まで)。 */
  const rememberRecent = async (path: string): Promise<void> => {
    const recent = [path, ...services.settings.get().recentProjects.filter((item) => item !== path)]
    await services.settings.update({ recentProjects: recent.slice(0, 10) })
  }
  return {
    'app:info': () =>
      Promise.resolve({
        appVersion: services.appVersion,
        runtime: services.runtime,
        platform: process.platform,
        projectFileExtension: PROJECT_FILE_EXTENSION
      }),

    'app:relaunch': () => Promise.resolve(services.windows?.relaunch?.() ?? false),
    'cache:info': () => cacheInfo(services),
    'cache:move': async (directory) => {
      if (cacheMoving) throw new AppError('INVALID_ARGUMENT', 'キャッシュを移している途中です')
      // 移す先は、ファイル選択で選んだフォルダに限る(任意の場所へ書かせない)。
      if (directory !== null && !services.readableFiles.has(resolve(directory))) {
        throw new AppError('ACCESS_DENIED', '移す先はフォルダの選択で選んでください')
      }
      cacheMoving = true
      try {
        const current = services.cache.root
        const target = directory === null ? services.cache.defaultRoot : await cacheTargetFor(directory)
        const pending = services.settings.get().storage.cacheDir
        if (resolve(target) !== resolve(current)) {
          await copyCache(current, target, (copiedBytes, totalBytes) => services.events.emit('cache:move-progress', { copiedBytes, totalBytes }))
        }
        // 前に移した先(まだ起動し直していない)を使わなくなったなら消す。
        if (pending && resolve(pending) !== resolve(target) && resolve(pending) !== resolve(current)) {
          await finishCacheMove(pending, target, services.cache.defaultRoot).catch(() => undefined)
        }
        const isDefault = resolve(target) === resolve(services.cache.defaultRoot)
        await services.settings.update({
          storage: { cacheDir: isDefault ? null : target, cleanupCacheDir: resolve(target) === resolve(current) ? null : current }
        })
        return await cacheInfo(services)
      } finally {
        cacheMoving = false
      }
    },
    'settings:get': () => Promise.resolve(services.settings.get()),

    'settings:update': (patch) => services.settings.update(patch),
    'secrets:status': () => Promise.resolve(services.secrets.statuses()),
    'secrets:set': async (name, value) => {
      const status = await services.secrets.set(name, value)
      // キーが変わるとモデル一覧や状態が変わるので、画面に読み直してもらう。
      services.events.emit('settings:changed', services.settings.get())
      return status
    },

    'dialog:pick': async (request) => {
      const picked = await services.picker.pick(request)
      // 素材として選ばれたファイルは、プレビューで読めるよう配信を許可する。
      if (picked && ['video', 'audio', 'image', 'media', 'psd'].includes(request.kind)) {
        services.media.allowFiles(picked)
      }
      if (picked && (request.kind === 'persona' || request.kind === 'directory')) {
        for (const path of picked) services.readableFiles.add(resolve(path))
      }
      // 書き出し先は、保存ダイアログで選ばれた場所だけを受け付ける。
      if (picked && ['exportVideo', 'exportText', 'exportImage'].includes(request.kind)) {
        for (const path of picked) services.saveTargets.add(resolve(path))
      }
      return picked
    },

    'project:read': async (path) => {
      const project = await services.projects.read(path)
      await rememberRecent(path)
      return project
    },
    'project:write': async (path, project) => {
      const written = await services.projects.write(path, project)
      await rememberRecent(path)
      return written
    },
    'project:forgetRecent': async (path) => {
      await services.settings.update({ recentProjects: services.settings.get().recentProjects.filter((item) => item !== path) })
    },

    'ai:providers': () => services.ai.statuses(),
    'ai:models': (providerId) => services.ai.models(providerId),
    'ai:test': async (providerId, model) => {
      const result = await services.ai
        .provider(providerId)
        .generate(model, {
          system: '接続確認です。指示に従って短く答えてください。',
          turns: [{ role: 'user', content: '「接続できたのだ」とだけ返してください。' }],
          session: 'connection-test'
        })
      return { text: result.text, durationMs: result.durationMs }
    },

    'ai:cohost': async (project, request) => {
      if (!Object.values(project.characters).some((character) => character.authorRole === 'ai') && !request.characterId) {
        throw new AppError('INVALID_ARGUMENT', '相方(AIの役)のキャラクターがいません。キャラクター画面で「AI(相方)」にしてください')
      }
      const prompt = buildCohostPrompt(project, request)
      // 画面を見せるなら、録画からその時刻のコマを取り出して添える。
      let vision: { shownFrames: number; imagesDropped: boolean } | undefined
      if (request.vision) {
        const { images, shownTimes } = await grabFrames(project, visionTimes(request.vision), services.ffmpeg, (path) => requireAllowed(services, path), {
          ...(request.vision.quality ? { quality: request.vision.quality } : {}),
          ...(request.vision.region ? { region: request.vision.region } : {})
        })
        if (images.length > 0) {
          const note = visionNote(request.vision, shownTimes)
          const turns = prompt.turns.map((turn, index) => (index === prompt.turns.length - 1 ? { ...turn, content: `${turn.content}\n\n${note}` } : turn))
          Object.assign(prompt, { turns, images })
        }
        vision = { shownFrames: images.length, imagesDropped: false }
      }
      Object.assign(prompt, { session: projectSession(project.meta, 'cohost') })
      const { value, result } = await services.ai.generateStructured('conversation', prompt, cohostResponseSchema, {
        projectConversation: project.ai.conversation
      })
      if (vision) vision.imagesDropped = result.imagesDropped === true
      return { candidates: interpretCohostResponse(project, request, value), generatedBy: result.generatedBy, ...(vision ? { vision } : {}) }
    },
    'ai:draft': async (project, request) => {
      const asset = project.assets[request.recordingAssetId]
      if (!asset || asset.type !== 'video') throw new AppError('INVALID_ARGUMENT', '録画(動画)の素材を選んでください')
      await requireAllowed(services, asset.path.absolute)
      const analysis = await services.analysis.analyze(asset.path.absolute)
      const moments = liveMomentsFor(project, request.recordingAssetId)
      const candidates = candidateSegments(analysis, {
        markers: moments.filter((moment) => moment.kind === 'marker' || moment.kind === 'note').map((moment) => moment.atMs),
        talks: moments.filter((moment) => moment.kind !== 'marker').map((moment) => moment.atMs)
      })
      const { value, result } = await services.ai.generateStructured(
        'editor',
        { ...buildDraftPrompt(project, request, candidates), session: projectSession(project.meta, 'draft') },
        editorResponseSchema
      )
      return {
        reply: value.reply,
        commands: wrapDraftCommands(project, toCommands(value.commands)),
        generatedBy: result.generatedBy,
        candidates: candidates.length
      }
    },
    'ai:portraits': async (project, request) => {
      if (!Object.values(project.characters).some((character) => character.portrait)) {
        throw new AppError('INVALID_ARGUMENT', '立ち絵のあるキャラクターがいません。キャラクター画面で立ち絵(PSD)を設定してください')
      }
      const { value, result } = await services.ai.generateStructured(
        'editor',
        { ...buildPortraitPrompt(project, request), session: projectSession(project.meta, 'portraits') },
        portraitResponseSchema
      )
      const { commands, dropped } = filterPortraitCommands(project, value.commands)
      const note = dropped > 0 ? `(立ち絵以外に触れる操作 ${dropped} 件は除きました)` : ''
      return { reply: `${value.reply}${note}`, commands, generatedBy: result.generatedBy }
    },
    'ai:visionFrame': async (project, atMs) => {
      // 範囲を選びやすいよう、送るときより少し大きめ(長辺 1280px)で取り出す。
      const { images } = await grabFrames(project, [atMs], services.ffmpeg, (path) => requireAllowed(services, path), { maxEdge: 1280 })
      const image = images[0]
      return image ? `data:${image.mediaType};base64,${image.data}` : null
    },
    'ai:briefing': async (project) => {
      if (!project.meta.synopsis?.trim()) throw new AppError('INVALID_ARGUMENT', '企画メモが空です。先に企画メモを書いてください')
      const { value, result } = await services.ai.generateStructured(
        'editor',
        { ...buildBriefingPrompt(project), session: projectSession(project.meta, 'briefing') },
        briefingResponseSchema
      )
      return interpretBriefing(project, value, result.generatedBy, new Date())
    },
    'ai:briefingCheck': async (project, briefing, factIds) => {
      const problem = validateBriefing(briefing)
      if (problem) throw new AppError('INVALID_ARGUMENT', problem)
      const facts = factsToCheck(briefing, factIds ?? undefined)
      if (facts.length === 0) return { briefing, webSearched: false, checked: 0 }
      // ウェブ検索を使える接続方法(Claude Code)なら使い、出典つきで確かめる。時間がかかるので待ち時間を延ばす。
      // 使えない接続方法には「使えない」と伝えた依頼にする(調べたふりをさせない)。
      const canSearch = services.ai.resolve('editor').providerId === 'claude-code'
      const { value, result } = await services.ai.generateStructured(
        'editor',
        {
          ...buildCheckPrompt(project, facts, canSearch),
          webSearch: canSearch,
          timeoutMs: canSearch ? 10 * 60_000 : 0,
          session: projectSession(project.meta, 'briefing-check')
        },
        briefingCheckSchema
      )
      const webSearched = canSearch && result.webSearch === true
      return { briefing: applyCheckResults(briefing, mapCheckIds(facts, value), webSearched, new Date()), webSearched, checked: facts.length }
    },
    'ai:explainer': async (project, request, options) => {
      for (const id of [...request.narrators, ...(request.interjector ? [request.interjector.characterId] : [])]) {
        if (!project.characters[id]) throw new AppError('INVALID_ARGUMENT', `キャラクターが見つかりません: ${id}`)
      }
      if (request.style === 'dialogue' && request.narrators.length < 2) throw new AppError('INVALID_ARGUMENT', '掛け合いには、解説するキャラクターを2人以上選んでください')
      const resolveOptions = options.model ? { explicit: options.model } : {}
      // ウェブ検索は Claude Code のときだけ使える(使えないなら、調べられないと伝えた依頼にする)。
      const canSearch = options.webSearch && services.ai.resolve('editor', resolveOptions).providerId === 'claude-code'
      const { value, result } = await services.ai.generateStructured(
        'editor',
        {
          ...buildExplainerPrompt(project, request, canSearch),
          webSearch: canSearch,
          timeoutMs: canSearch ? 10 * 60_000 : 5 * 60_000,
          session: projectSession(project.meta, 'explainer')
        },
        explainerResponseSchema,
        resolveOptions
      )
      const webSearched = canSearch && result.webSearch === true
      const script = interpretExplainer(project, request, value, webSearched)
      if (script.lines.length === 0) throw new AppError('AI_OUTPUT_INVALID', 'AIの台本にセリフがありませんでした。お題を具体的にしてやり直してください')
      return { script, generatedBy: result.generatedBy, webSearched }
    },
    'images:find': async ({ sources, queries }) => (await services.webImages.find(sources)) ?? (queries.length > 0 ? await services.commonsImages.find(queries) : null),
    'ai:publish': async (project) => {
      const { value, result } = await services.ai.generateStructured(
        'editor',
        { ...buildPublishPrompt(project), session: projectSession(project.meta, 'publish') },
        publishResponseSchema
      )
      return { ...interpretPublishResponse(project, value), generatedBy: result.generatedBy }
    },
    'ai:edit': async (project, request) => {
      const { value, result } = await services.ai.generateStructured(
        'editor',
        { ...buildEditorPrompt(project, request), session: projectSession(project.meta, 'editor-chat') },
        editorResponseSchema
      )
      return { reply: value.reply, commands: toCommands(value.commands), generatedBy: result.generatedBy }
    },

    'voice:engines': () => Promise.resolve(services.engines.statusList()),
    'voice:ensure': (engineId) => services.engines.ensure(engineId),
    'voice:install:info': () => services.engineInstaller.info(),
    'voice:install:start': async () => {
      const executablePath = await services.engineInstaller.install()
      // 入れたエンジンを使う設定にする(VOICEVOX の項目が消されていたら足す)。
      const current = services.settings.get().voice.engines
      const engines = current.some((engine) => engine.id === 'voicevox')
        ? current.map((engine) => (engine.id === 'voicevox' ? { ...engine, executablePath, autoLaunch: true } : engine))
        : [{ id: 'voicevox', label: 'VOICEVOX', url: 'http://127.0.0.1:50021', executablePath, autoLaunch: true }, ...current]
      await services.settings.update({ voice: { engines } })
      services.engineInstaller.markStarting()
      const status = await services.engines.ensure('voicevox')
      services.engineInstaller.finish(status.state === 'ready' ? undefined : (status.message ?? 'VOICEVOX を起動できませんでした'))
      return status
    },
    'voice:install:cancel': () => {
      services.engineInstaller.cancel()
      return Promise.resolve()
    },
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
    'media:proxy': (path, format, maxHeight) => requireAllowed(services, path).then(() => services.mediaTools.proxy(path, format, maxHeight)),
    'media:peaks': (path) => requireAllowed(services, path).then(() => services.mediaTools.peaks(path)),
    'media:activity': (path) => requireAllowed(services, path).then(() => services.analysis.activity(path)),

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
    'characters:list': () => Promise.resolve(services.characters.list()),
    'characters:save': (character) => services.characters.save(character),
    'characters:remove': (id) => services.characters.remove(id),
    'templates:list': () => Promise.resolve(services.templates.list()),
    'templates:save': (template) => services.templates.save(template),
    'templates:remove': (id) => services.templates.remove(id),
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
    },
    'export:image': async (path, pngBase64) => {
      if (!services.saveTargets.has(resolve(path))) throw new AppError('ACCESS_DENIED', '保存先は保存ダイアログで選んでください')
      const bytes = Buffer.from(pngBase64, 'base64')
      // PNG の署名で中身を確かめる(画像以外を書かせない)。
      if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) throw new AppError('INVALID_ARGUMENT', 'PNG の画像ではありません')
      await writeFileAtomic(path, bytes)
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

let cacheMoving = false

async function cacheInfo(services: Services): Promise<CacheInfo> {
  const { root, defaultRoot, fallbackFrom } = services.cache
  return {
    path: root,
    defaultPath: defaultRoot,
    nextPath: services.settings.get().storage.cacheDir ?? defaultRoot,
    bytes: await directorySize(root),
    freeBytes: await freeSpace(root),
    fallbackFrom
  }
}
