import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { CommonsImageService, stripHtml } from '@main/services/media/commons-images'
import { buildExplainerPrompt, citationText, explainerCommands, interpretExplainer, type ExplainerRequest, type FoundImage, type PlacedLine } from '@shared/ai/explainer'
import { applyCommands } from '@shared/commands/apply'
import type { Command } from '@shared/commands/types'
import { generateCredits } from '@shared/project/credits'
import { createEmptyProject } from '@shared/project/factory'
import type { ImageItem, Project, TextItem, VoiceItem } from '@shared/project/types'

import { tempDir } from './helpers/env'

let counter = 0
const ctx = { newId: (prefix: string) => `${prefix}_${++counter}`, now: () => new Date('2026-01-01T00:00:00Z') }

function apply(project: Project, commands: Command[]): Project {
  return applyCommands(project, commands, ctx).project
}

/** ずんだもん(あなた)・めたん・つむぎ(AI)のいるプロジェクト。めたんには「笑顔」の表情がある。 */
function cast(): { project: Project; zunda: string; metan: string; tsumugi: string } {
  let project = apply(createEmptyProject(), [
    { op: 'character.create', name: 'ずんだもん', engineId: 'voicevox', speakerId: 3, speakerName: 'ずんだもん' },
    { op: 'character.create', name: '四国めたん', authorRole: 'ai', persona: { personality: '物知り', speechStyle: 'ですわ口調', banterRole: 'navigator', forbidden: [], targetLengthChars: 40 }, engineId: 'voicevox', speakerId: 2, speakerName: 'めたん' },
    { op: 'character.create', name: '春日部つむぎ', authorRole: 'ai', persona: { personality: '明るい', speechStyle: 'ギャル', banterRole: 'boke', forbidden: [], targetLengthChars: 30 }, engineId: 'voicevox', speakerId: 8, speakerName: 'つむぎ' }
  ])
  const ids = Object.values(project.characters)
  const [zunda, metan, tsumugi] = [ids[0]!.id, ids[1]!.id, ids[2]!.id]
  project = { ...project, characters: { ...project.characters, [metan]: { ...project.characters[metan]!, portrait: { assetId: 'x', transform: { x: 0, y: 0, scale: 1, flipX: false, anchor: 'bottom-left' }, partGroups: {}, layerVisibility: {}, expressions: { exp_smile: { id: 'exp_smile', name: '笑顔', selections: {} } }, defaultExpressionId: null, lipSync: null, blink: null } } } }
  return { project, zunda, metan, tsumugi }
}

function request(overrides: Partial<ExplainerRequest> = {}): ExplainerRequest {
  return { topic: 'カイザーライヒの世界観', targetSeconds: 120, style: 'dialogue', narrators: [], interjector: null, images: true, ...overrides }
}

describe('解説の台本の依頼と応答', () => {
  it('依頼文に、お題・長さ・語り方・合いの手・表情の一覧が入る', () => {
    const { project, zunda, metan, tsumugi } = cast()
    const prompt = buildExplainerPrompt(project, request({ narrators: [metan, tsumugi], interjector: { characterId: zunda, frequency: 'few' } }), false)
    expect(prompt.turns[0]!.content).toContain('カイザーライヒの世界観')
    expect(prompt.system).toContain('約120秒')
    expect(prompt.system).toContain('掛け合い')
    expect(prompt.system).toContain('ずんだもん')
    expect(prompt.system).toContain('合いの手')
    expect(prompt.system).toContain('2〜3回')
    expect(prompt.turns[0]!.content).toContain('表情: 笑顔')
    expect(prompt.system).toContain('ウェブでは調べられない')
    const solo = buildExplainerPrompt(project, request({ style: 'solo', narrators: [metan], images: false }), true)
    expect(solo.system).toContain('1人で語る')
    expect(solo.system).toContain('参考画像は使わない')
    expect(solo.system).toContain('ウェブで確かめて')
  })

  it('話す人は ID でも名前でも受け、違う人なら解説役に振り直し、表情の名前を ID にする', () => {
    const { project, zunda, metan, tsumugi } = cast()
    const req = request({ narrators: [metan, tsumugi], interjector: { characterId: zunda, frequency: 'normal' } })
    const script = interpretExplainer(project, req, {
      title: 'カイザーライヒとは',
      lines: [
        { speaker: metan, text: '四国めたん:今日はカイザーライヒの話ですわ', expression: '笑顔', image: { query: 'ドイツ帝国', queryEn: 'German Empire', caption: '地図' } },
        { speaker: 'ずんだもん', text: 'へぇ〜なのだ', expression: null, image: { query: '無視される', queryEn: 'x', caption: '' } },
        { speaker: 'だれか', text: 'まとめると…', expression: '怒り', image: null }
      ]
    })
    expect(script.lines.map((line) => [line.characterId, line.text, line.expressionId])).toEqual([
      [metan, '今日はカイザーライヒの話ですわ', 'exp_smile'],
      [zunda, 'へぇ〜なのだ', null],
      [metan, 'まとめると…', null]
    ])
    expect(script.lines[0]!.image).toEqual({ query: 'ドイツ帝国', queryEn: 'German Empire', caption: '地図' })
    expect(script.warnings[0]).toContain('1 行')
    // 画像を使わない設定なら、画像の指定は捨てる。
    expect(interpretExplainer(project, { ...req, images: false }, { title: 't', lines: [{ speaker: metan, text: 'a', expression: null, image: { query: 'q', queryEn: 'q', caption: '' } }, { speaker: metan, text: 'b', expression: null, image: null }] }).lines[0]!.image).toBeNull()
  })
})

const IMAGE: FoundImage = {
  path: '/img/map.jpg',
  width: 1280,
  height: 960,
  title: 'Map of the German Empire',
  author: 'Alice',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Map.jpg',
  site: 'Wikimedia Commons'
}

function placed(characterId: string, text: string, ms: number, image = false): PlacedLine {
  return { characterId, text, expressionId: null, image: image ? { query: 'q', queryEn: 'q', caption: '' } : null, synthesis: { cacheKey: `k-${text}`, audioDurationMs: ms, lipSync: [], accentPhrases: [] } }
}

describe('解説をタイムラインに並べる', () => {
  it('セリフは合成した長さで順に並び、画像は次の画像まで真ん中に、出典は右上に出て、全体が1つのグループになる', () => {
    const { project: base, metan, tsumugi } = cast()
    // 後ろに素材がある(場所を空けるとずれる)。
    const project = apply(base, [{ op: 'media.placeText', text: '本編', atMs: 5000, durationMs: 2000 }])
    const lines = [placed(metan, '一', 2000, true), placed(tsumugi, '二', 1000), placed(metan, '三', 1500, true)]
    const commands = explainerCommands(project, { atMs: 5000, title: 'カイザーライヒとは', lines, images: [IMAGE, null, { ...IMAGE, path: '/img/flag.png', title: 'Flag' }], ripple: true, showTitle: true, gapMs: 200 })
    const after = apply(project, commands)

    const voices = after.items.filter((item): item is VoiceItem => item.type === 'voice').sort((a, b) => a.startMs - b.startMs)
    expect(voices.map((voice) => [voice.text, voice.startMs, voice.durationMs, voice.synthesis?.cacheKey])).toEqual([
      ['一', 5000, 2000, 'k-一'],
      ['二', 7200, 1000, 'k-二'],
      ['三', 8400, 1500, 'k-三']
    ])
    // 後ろの本編は、解説の長さ(4.9秒)だけずれる。
    expect(after.items.find((item) => item.type === 'text' && item.text === '本編')!.startMs).toBe(9900)

    const images = after.items.filter((item): item is ImageItem => item.type === 'image').sort((a, b) => a.startMs - b.startMs)
    expect(images.map((image) => [image.startMs, image.durationMs])).toEqual([
      [5000, 3400],
      [8400, 1500]
    ])
    expect(images[0]!.transform).toMatchObject({ x: 960, y: Math.round(1080 * 0.47) })
    expect(images[0]!.frame?.border).toBeTruthy()
    // 画像は立ち絵より下のレイヤー。
    const index = (id: string): number => after.layers.find((layer) => layer.id === id)!.index
    expect(index(images[0]!.layerId)).toBeLessThan(after.layers.find((layer) => layer.name === '立ち絵')!.index)

    const citations = after.items.filter((item): item is TextItem => item.type === 'text' && item.text.startsWith('出典'))
    expect(citations).toHaveLength(2)
    expect(citations[0]!.text).toBe(citationText(IMAGE))
    expect(citations[0]!.transform.x).toBeGreaterThan(960)
    expect(citations[0]!.transform.y).toBeLessThan(100)
    expect(after.items.some((item) => item.type === 'text' && item.text === 'カイザーライヒとは')).toBe(true)

    // 全部が1つのグループ(本編は入らない)。
    const groupIds = new Set(after.items.filter((item) => item.startMs >= 5000 && !(item.type === 'text' && item.text === '本編')).map((item) => item.groupId))
    expect(groupIds.size).toBe(1)
    expect([...groupIds][0]).toBeDefined()
    // 画像の出典は概要欄のクレジットにも入る。
    expect(generateCredits(after).text).toContain('Map of the German Empire')
  })

  it('画像・出典・見出しは、ID の順によらずそれぞれ専用のレイヤーに入り(セリフと重ならない)、2回目は同じレイヤーを使う', () => {
    const { project: base, metan, tsumugi } = cast()
    const lines = [placed(metan, '一', 2000, true), placed(tsumugi, '二', 1000)]
    const plan = { atMs: 0, title: '見出し', lines, images: [IMAGE, null], ripple: true, showTitle: true, gapMs: 200 }
    // ID の付け方(並べ替えの順)を変えても、置き場所は変わらない。
    for (const up of [true, false]) {
      let n = 0
      const sorted = { newId: (prefix: string) => `${prefix}_${up ? 100 + ++n : 900 - ++n}`, now: ctx.now }
      const after = applyCommands(base, explainerCommands(base, plan), sorted).project
      const layerOf = (item: { layerId: string } | undefined): string => after.layers.find((layer) => layer.id === item?.layerId)!.name
      expect(layerOf(after.items.find((item) => item.type === 'image'))).toBe('解説の画像')
      expect(layerOf(after.items.find((item) => item.type === 'text' && item.text.startsWith('出典')))).toBe('出典')
      expect(layerOf(after.items.find((item) => item.type === 'text' && item.text === '見出し'))).toBe('解説の見出し')
      expect(after.items.filter((item) => item.type === 'voice').every((item) => layerOf(item) === 'ボイス')).toBe(true)
      // 下から 画像 → 出典 → 見出し → 立ち絵 の順。
      const names = after.layers.map((layer) => layer.name)
      expect(names.indexOf('解説の画像')).toBeLessThan(names.indexOf('出典'))
      expect(names.indexOf('出典')).toBeLessThan(names.indexOf('解説の見出し'))
      expect(names.indexOf('解説の見出し')).toBeLessThan(names.indexOf('立ち絵'))
      expect(names.some((name) => /sd+$/.test(name))).toBe(false)

      // 2回目は、同じレイヤーを使う(レイヤーは増えない)。
      const again = apply(after, explainerCommands(after, { ...plan, atMs: 0 }))
      expect(again.layers.map((layer) => layer.name)).toEqual(names)
      expect(again.items.filter((item) => item.type === 'image')).toHaveLength(2)
    }
  })

  it('セリフを足すと後ろをずらす設定でも、並べた場所から動かさず、設定は元に戻す', () => {
    const { project: base, metan } = cast()
    const project = apply(base, [{ op: 'project.setEditing', openGapOnVoiceInsert: true }])
    const after = apply(project, explainerCommands(project, { atMs: 0, title: '', lines: [placed(metan, 'a', 1000), placed(metan, 'b', 1000)], images: [null, null], ripple: false, showTitle: false, gapMs: 100 }))
    expect(after.items.filter((item) => item.type === 'voice').map((item) => item.startMs)).toEqual([0, 1100])
    expect(after.editing.openGapOnVoiceInsert).toBe(true)
    expect(after.layers.some((layer) => layer.name === '解説の画像')).toBe(false)
  })
})

/** 模擬の Wikimedia Commons(検索の API と画像の配信)。 */
function fakeCommons(pages: unknown[]): { fetch: (input: string) => Promise<Response>; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    fetch: async (input: string) => {
      calls.push(input)
      if (input.includes('api.php')) return new Response(JSON.stringify({ query: { pages } }), { status: 200 })
      if (input.includes('broken')) return new Response('', { status: 404 })
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), { status: 200 })
    }
  }
}

describe('参考画像を探す(Wikimedia Commons)', () => {
  const page = (title: string, extra: Record<string, unknown> = {}): unknown => ({
    title: `File:${title}.png`,
    index: 1,
    imageinfo: [
      {
        thumburl: `https://upload.example/${title}.png`,
        thumbwidth: 1280,
        thumbheight: 720,
        mime: 'image/png',
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${title}.png`,
        extmetadata: { Artist: { value: '<a href="x">Bob</a> &amp; Co' }, LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0' } },
        ...extra
      }
    ]
  })

  it('最初に使える画像を落として、作者・ライセンス・説明ページを返し、配信を許可する', async () => {
    const directory = await tempDir('zs-commons-')
    const allowed: string[] = []
    const commons = fakeCommons([page('broken'), page('Map')])
    const service = new CommonsImageService(directory, (path) => allowed.push(path), 'zunda-studio/test', { fetch: commons.fetch })
    const found = await service.find(['ドイツ帝国', 'German Empire'])
    expect(found).toMatchObject({ width: 1280, height: 720, title: 'Map', author: 'Bob & Co', license: 'CC BY 4.0', pageUrl: 'https://commons.wikimedia.org/wiki/File:Map.png', site: 'Wikimedia Commons' })
    expect(existsSync(found!.path)).toBe(true)
    expect(readFileSync(found!.path)[1]).toBe(0x50)
    expect(allowed).toEqual([found!.path])
    // 検索の言葉(静止画だけを探す)。
    expect(new URL(commons.calls[0]!).searchParams.get('gsrsearch')).toBe('ドイツ帝国 filetype:bitmap')
  })

  it('ライセンスの分からない画像は使わず、どれも無ければ次の言葉で探し、それでも無ければ null', async () => {
    const commons = fakeCommons([page('NoLicense', { extmetadata: {} })])
    const service = new CommonsImageService(await tempDir('zs-commons-'), () => undefined, 'test', { fetch: commons.fetch })
    expect(await service.find(['a', 'b'])).toBeNull()
    expect(commons.calls.filter((call) => call.includes('api.php'))).toHaveLength(2)
  })

  it('つながらなければ、理由の分かるエラーにする', async () => {
    const service = new CommonsImageService(await tempDir('zs-commons-'), () => undefined, 'test', {
      fetch: () => Promise.reject(new Error('offline'))
    })
    await expect(service.find(['a'])).rejects.toMatchObject({ code: 'NETWORK' })
    expect(stripHtml('<span>A&nbsp;B</span>')).toBe('A B')
  })
})

describe('Commons の説明文の HTML', () => {
  it('隠された機械向けの文は消す', () => {
    const html = '<div class="fn"><div style="font-weight:bold"><i>Stanford\'s map</i></div><div style="display: none;">label QS:Len,"Stanford\'s map"</div></div>'
    expect(stripHtml(html)).toBe("Stanford's map")
  })
})
