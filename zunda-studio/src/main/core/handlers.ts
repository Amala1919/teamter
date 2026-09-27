import { z } from 'zod'

import { PROVIDER_IDS } from '@shared/ai/types'
import type { Channel, ChannelArgs, ChannelResult, IpcResult } from '@shared/ipc/contract'
import type { Project } from '@shared/project/types'
import type { SettingsPatch } from '@shared/settings/schema'

import { PROJECT_FILE_EXTENSION } from '../services/project/store'
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
        'audio',
        'image',
        'psd',
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
  'voice:dict:delete': z.tuple([engineIdArg, z.string().min(1).max(100)])
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
      if (picked && ['video', 'audio', 'image', 'psd'].includes(request.kind)) {
        services.media.allowFiles(picked)
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
    'voice:dict:add': async (engineId, word) => (await services.engines.require(engineId)).addUserDictWord(word),
    'voice:dict:delete': async (engineId, wordId) => (await services.engines.require(engineId)).deleteUserDictWord(wordId)
  }
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
