import { fail, invalidateSynthesis, refreshSubtitleLines, type HandlerTable } from '../env'

type CharacterHandlers = Pick<
  HandlerTable,
  'character.create' | 'character.setPersona' | 'character.update' | 'character.setPortrait' | 'character.delete'
>

export const characterHandlers: CharacterHandlers = {
  'character.create': (draft, command, env) => {
    const styleId = command.subtitleStyleId === undefined ? Object.keys(draft.subtitleStyles)[0] : env.resolve(command.subtitleStyleId)
    if (!styleId || !draft.subtitleStyles[styleId]) fail(command.op, '字幕スタイルが存在しません')
    const authorRole = command.authorRole ?? 'user'
    if (authorRole === 'ai' && !command.persona) fail(command.op, 'AIが演じる役には persona が必要です')
    if (command.name.trim() === '') fail(command.op, 'キャラクター名が空です')

    const id = env.ctx.newId('chr')
    draft.characters[id] = {
      id,
      name: command.name,
      authorRole,
      persona: command.persona ?? null,
      voice: {
        engineId: command.engineId,
        speakerId: command.speakerId,
        speakerName: command.speakerName,
        speedScale: 1,
        pitchScale: 0,
        intonationScale: 1,
        volumeScale: 1,
        prePhonemeLength: 0.1,
        postPhonemeLength: 0.1
      },
      subtitleStyleId: styleId,
      portrait: null,
      creditRequired: command.creditText !== undefined && command.creditText !== '',
      creditText: command.creditText ?? ''
    }
    if (command.tempId) env.resolvedIds[command.tempId] = id
  },

  'character.setPersona': (draft, command, env) => {
    const character = draft.characters[env.resolve(command.characterId)]
    if (!character) fail(command.op, `キャラクターが見つかりません: ${command.characterId}`)
    if (character.authorRole !== 'ai') fail(command.op, 'AIが演じる役ではないため persona を設定できません')
    character.persona = command.persona
  },

  'character.update': (draft, command, env) => {
    const characterId = env.resolve(command.characterId)
    const character = draft.characters[characterId]
    if (!character) fail(command.op, `キャラクターが見つかりません: ${characterId}`)

    if (command.name !== undefined) {
      if (command.name.trim() === '') fail(command.op, 'キャラクター名が空です')
      character.name = command.name
    }
    if (command.persona !== undefined) character.persona = command.persona
    if (command.authorRole !== undefined) {
      if (command.authorRole === 'ai' && !character.persona) {
        fail(command.op, 'AIが演じる役にするには先に persona を設定してください')
      }
      character.authorRole = command.authorRole
    }
    if (command.creditText !== undefined) {
      character.creditText = command.creditText
      character.creditRequired = command.creditText !== ''
    }

    let restyled = false
    if (command.subtitleStyleId !== undefined) {
      if (!draft.subtitleStyles[command.subtitleStyleId]) {
        fail(command.op, `字幕スタイルが見つかりません: ${command.subtitleStyleId}`)
      }
      character.subtitleStyleId = command.subtitleStyleId
      restyled = true
    }

    const voiceChanged =
      command.voice !== undefined &&
      Object.entries(command.voice).some(
        ([key, value]) => value !== undefined && character.voice[key as keyof typeof character.voice] !== value
      )
    if (command.voice) {
      for (const [key, value] of Object.entries(command.voice)) {
        if (value !== undefined) (character.voice as unknown as Record<string, unknown>)[key] = value
      }
    }

    for (const item of draft.items) {
      if (item.type !== 'voice' || item.characterId !== characterId) continue
      if (voiceChanged) invalidateSynthesis(item)
      if (restyled) refreshSubtitleLines(draft, item)
    }
  },

  'character.setPortrait': (draft, command, env) => {
    const characterId = env.resolve(command.characterId)
    const character = draft.characters[characterId]
    if (!character) fail(command.op, `キャラクターが見つかりません: ${characterId}`)
    const portrait = command.portrait
    if (portrait === null) {
      character.portrait = null
      return
    }
    const asset = draft.assets[env.resolve(portrait.assetId)]
    if (!asset || asset.type !== 'psd') fail(command.op, '立ち絵には PSD の素材を指定してください')
    if (!(portrait.transform.scale > 0)) fail(command.op, '立ち絵の拡大率が不正です')
    const groupIds = new Set(Object.keys(portrait.partGroups))
    if (portrait.lipSync && !groupIds.has(portrait.lipSync.partGroupId)) fail(command.op, '口パクのパーツグループが見つかりません')
    if (portrait.blink && !groupIds.has(portrait.blink.partGroupId)) fail(command.op, 'まばたきのパーツグループが見つかりません')
    if (portrait.defaultExpressionId !== null && !portrait.expressions[portrait.defaultExpressionId]) {
      fail(command.op, '既定の表情が見つかりません')
    }
    character.portrait = { ...portrait, assetId: env.resolve(portrait.assetId) }
    // 消えた表情を指しているセリフは既定の表情に戻す。
    for (const item of draft.items) {
      if (item.type === 'voice' && item.characterId === characterId && item.expressionId && !portrait.expressions[item.expressionId]) {
        item.expressionId = null
      }
    }
  },

  'character.delete': (draft, command, env) => {
    const characterId = env.resolve(command.characterId)
    if (!draft.characters[characterId]) fail(command.op, `キャラクターが見つかりません: ${characterId}`)
    const used = draft.items.some(
      (item) => (item.type === 'voice' || item.type === 'portrait') && item.characterId === characterId
    )
    if (used) fail(command.op, 'このキャラクターのセリフや立ち絵が残っているため削除できません')
    delete draft.characters[characterId]
  }
}
