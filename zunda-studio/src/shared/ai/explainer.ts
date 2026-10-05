import { z } from 'zod'

import type { Command } from '../commands/types'
import { DEFAULT_LAYER_IDS } from '../project/factory'
import type { Character, CharacterId, Ms, Project, SynthesisResult, TextLook } from '../project/types'
import { briefingPromptSection } from './briefing'
import { cleanLine, describePersona } from './cohost'
import type { GenerateRequest } from './types'

/**
 * 動画の中に入れる解説パートを AI に作らせる(お題と目安の長さから、セリフ・表情・参考画像の探し方まで)。
 * 依頼文と応答の検証、セリフと画像をタイムラインに並べるコマンドの組み立てはここ(テストしやすいよう純粋な関数にしてある)。
 * 画像の検索・ダウンロードは main 側(Wikimedia Commons)、音声の合成はレンダラが行い、結果をここへ渡す。
 */

/** 語り方。solo: 1人で語る / dialogue: AI のキャラクター同士の掛け合い。 */
export type ExplainerStyle = 'solo' | 'dialogue'

/** 合いの手の多さ。 */
export type InterjectionFrequency = 'few' | 'normal' | 'many'

export const INTERJECTION_LABELS: Record<InterjectionFrequency, string> = {
  few: '少なめ(要所だけ)',
  normal: 'ふつう',
  many: '多め(こまめに)'
}

const INTERJECTION_TEXT: Record<InterjectionFrequency, string> = {
  few: '全体で2〜3回、話の区切りや大事なところだけ',
  normal: '話題が変わるところや、聞き手が引っかかりそうなところで(およそ4〜6行に1回)',
  many: 'こまめに(およそ2〜3行に1回)'
}

export interface ExplainerRequest {
  /** お題。 */
  topic: string
  /** 目安の長さ(秒)。 */
  targetSeconds: number
  style: ExplainerStyle
  /** 解説するキャラクター(solo なら1人、dialogue なら2人以上)。 */
  narrators: CharacterId[]
  /** 合いの手を入れるキャラクター(投稿者本人の役など)。null なら入れない。 */
  interjector: { characterId: CharacterId; frequency: InterjectionFrequency } | null
  /** 見る人の想定(「初心者向け」など)。 */
  audience?: string
  /** そのほかの指示。 */
  instruction?: string
  /** 参考画像を探すための言葉も作らせるか。 */
  images: boolean
}

/** 1秒あたりに読み上げるおおよその文字数(合成音声の標準の速さ)。 */
export const CHARS_PER_SECOND = 7

const MAX_LINES = 160

/** AI が返す形。 */
export const explainerResponseSchema = z.object({
  title: z.string().min(1).max(60).describe('解説パートの見出し(画面に出す短いタイトル)'),
  lines: z
    .array(
      z.object({
        speaker: z.string().min(1).max(100).describe('話すキャラクターの ID(指定された中から)'),
        text: z.string().min(1).max(300).describe('セリフ(名前やかぎかっこは付けない)'),
        expression: z.string().max(60).nullable().describe('表情の名前(指定された一覧から。無ければ null)'),
        image: z
          .object({
            query: z.string().min(1).max(120).describe('Wikimedia Commons で探す言葉(日本語。英語で見つからないときに使う)'),
            queryEn: z.string().min(1).max(120).describe('同じものを英語で(先にこちらで探す。Commons は英語の説明が多い)'),
            caption: z.string().max(60).describe('画像が何か(短く)')
          })
          .nullable()
          .describe('このセリフから画面の真ん中に出す参考画像。前の画像のままでよいなら null')
      })
    )
    .min(2)
    .max(MAX_LINES)
})

export type ExplainerResponse = z.infer<typeof explainerResponseSchema>

export interface ExplainerImageQuery {
  query: string
  queryEn: string
  caption: string
}

export interface ExplainerLine {
  characterId: CharacterId
  text: string
  expressionId: string | null
  image: ExplainerImageQuery | null
}

export interface ExplainerScript {
  title: string
  lines: ExplainerLine[]
  /** 直したこと(話す人が違った・空のセリフを除いた など)。 */
  warnings: string[]
}

/** 解説を依頼する文を作る。 */
export function buildExplainerPrompt(project: Project, request: ExplainerRequest, canSearch: boolean): Omit<GenerateRequest, 'jsonSchema'> {
  const narrators = request.narrators.map((id) => project.characters[id]).filter((character): character is Character => character !== undefined)
  const interjector = request.interjector ? project.characters[request.interjector.characterId] : undefined
  const targetChars = Math.round(request.targetSeconds * CHARS_PER_SECOND)
  const speakerList = [...narrators, ...(interjector ? [interjector] : [])]
    .map((character) => {
      const expressions = Object.values(character.portrait?.expressions ?? {}).map((expression) => expression.name)
      return [`### ${character.id}`, describePersona(character, null), expressions.length > 0 ? `表情: ${expressions.join(' / ')}` : '表情: (なし。null にする)'].join('\n')
    })
    .join('\n\n')

  const style =
    request.style === 'solo' || narrators.length < 2
      ? `- 解説は ${narrators[0]?.name ?? '?'}(${narrators[0]?.id ?? '?'})が1人で語る。視聴者に語りかける口調で`
      : `- 解説は ${narrators.map((character) => `${character.name}(${character.id})`).join('・')} の掛け合いで進める。説明役と聞き役を自然に入れ替え、質問・ツッコミ・まとめで理解が深まるように`
  const interjection = interjector
    ? `- ${interjector.name}(${interjector.id})は投稿者本人の役。解説はせず、短い合いの手(驚き・相づち・素朴な疑問。10〜25文字)だけを、${INTERJECTION_TEXT[request.interjector!.frequency]}入れる`
    : null

  const system = [
    'あなたはゲーム実況動画の中に入れる「解説パート」の台本を書く構成作家です。合成音声のキャラクターが読み上げ、画面には字幕と参考画像が出ます。',
    '',
    '## 決まりごと',
    '- 出力は指定のJSONだけ',
    style,
    interjection,
    '- 各キャラクターの性格・口調を守る。セリフに名前やかぎかっこは付けない',
    `- 全体で約${request.targetSeconds}秒(セリフの合計で約${targetChars}文字)。1つのセリフは15〜60文字くらいにし、長い説明は分ける`,
    '- 最初に何の話かを示し、最後に一言でまとめる',
    '- 確かでないことは断定しない。数字や年号は確かなものだけ使う',
    canSearch ? '- 事実はウェブで確かめてから書く(読むだけの検索が使える)' : '- ウェブでは調べられない。一般的に知られていることの範囲で書く',
    request.images
      ? '- 説明に合う参考画像を、話題が変わるところで image に指定する(画面の真ん中に出る)。Wikimedia Commons で見つかりそうな具体的な言葉(人物名・地名・物の名前・地図など)にする。同じ画像のままでよいセリフは null。画像は4〜8行に1枚くらい'
      : '- 参考画像は使わない(image はすべて null)',
    '- expression は、そのキャラクターの表情の一覧にある名前だけ。合うものが無ければ null'
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  const content = [
    `## お題\n${request.topic.trim()}`,
    request.audience?.trim() ? `## 見る人\n${request.audience.trim()}` : '',
    project.meta.synopsis?.trim() ? `## この動画の企画メモ(話をそろえるために)\n${project.meta.synopsis.trim()}` : '',
    briefingPromptSection(project),
    `## 話すキャラクター\n${speakerList}`,
    request.instruction?.trim() ? `## 指示\n${request.instruction.trim()}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')

  return { system, turns: [{ role: 'user', content }] }
}

/** AI の応答を、使えるセリフの並びにする(話す人・表情を確かめ、余計な飾りを外す)。 */
export function interpretExplainer(project: Project, request: ExplainerRequest, response: ExplainerResponse): ExplainerScript {
  const allowed = new Set([...request.narrators, ...(request.interjector ? [request.interjector.characterId] : [])])
  const byName = new Map(Object.values(project.characters).map((character) => [character.name, character.id]))
  const warnings: string[] = []
  let misattributed = 0
  const lines: ExplainerLine[] = []
  response.lines.forEach((line, index) => {
    // ID の代わりに名前を返すモデルもあるので、名前でも引く。どちらでもなければ、解説役の順番で振る。
    let characterId = allowed.has(line.speaker) ? line.speaker : byName.get(line.speaker)
    if (!characterId || !allowed.has(characterId)) {
      misattributed++
      characterId = request.narrators[index % request.narrators.length]!
    }
    const character = project.characters[characterId]!
    const text = cleanLine(line.text, character.name)
    if (text === '') return
    const expression = line.expression ? Object.values(character.portrait?.expressions ?? {}).find((candidate) => candidate.name === line.expression) : undefined
    lines.push({
      characterId,
      text,
      expressionId: expression?.id ?? null,
      image: request.images && line.image ? { query: line.image.query.trim(), queryEn: line.image.queryEn.trim(), caption: line.image.caption.trim() } : null
    })
  })
  if (misattributed > 0) warnings.push(`話す人が指定と違ったセリフ ${misattributed} 行を、解説役に振り直しました`)
  return { title: response.title.trim(), lines, warnings }
}

// ---------------------------------------------------------------- タイムラインに並べる

/** 見つけた参考画像(main がダウンロードしたもの)。 */
export interface FoundImage {
  path: string
  width: number
  height: number
  /** 画像の題(ファイルの名前など)。 */
  title: string
  author: string
  license: string
  licenseUrl: string | null
  /** 画像の説明ページ(出典)。 */
  pageUrl: string
  /** どこの画像か(画面に出す名前)。 */
  site: string
}

export interface PlacedLine extends ExplainerLine {
  synthesis: SynthesisResult
}

export interface ExplainerPlan {
  atMs: Ms
  title: string
  lines: PlacedLine[]
  /** lines と同じ並び。その行で出す画像(見つからなければ null)。 */
  images: (FoundImage | null)[]
  /** 後ろの素材をずらして場所を空ける。 */
  ripple: boolean
  /** 見出しを出す。 */
  showTitle: boolean
  gapMs: Ms
  /** テロップの幅を測る(画面の右上に出典を寄せるため)。無ければ文字数から見積もる。 */
  measure?: (text: string, look: TextLook) => number
}

/** 出典の文(画面の端に出す)。 */
export function citationText(image: FoundImage): string {
  const title = image.title.length > 40 ? `${image.title.slice(0, 39)}…` : image.title
  const author = image.author.length > 30 ? `${image.author.slice(0, 29)}…` : image.author
  return `出典: ${image.site}「${title}」${author ? ` ${author}` : ''} / ${image.license}`
}

/** 概要欄のクレジットに載せる文。 */
export function creditText(image: FoundImage): string {
  return `画像: 「${image.title}」${image.author ? ` ${image.author}` : ''} / ${image.license}${image.licenseUrl ? ` (${image.licenseUrl})` : ''} / ${image.site}: ${image.pageUrl}`
}

/** 解説の画像を置くレイヤー・出典のレイヤー・見出しのレイヤーの名前(下からこの順に、立ち絵より下に作る)。 */
export const EXPLAINER_IMAGE_LAYER = '解説の画像'
export const EXPLAINER_CITATION_LAYER = '出典'
export const EXPLAINER_TITLE_LAYER = '解説の見出し'

/**
 * 解説の素材を置くレイヤーを用意する(同じ名前のレイヤーがあればそれを使い、無ければ下から順に立ち絵のすぐ下へ作る)。
 * 素材ごとに専用のレイヤーへ置くので、セリフやほかの解説の素材と重なって別のレイヤーへ振り分けられることがない。
 * 返すのは、名前ごとのレイヤーの ID(作るものは仮の ID)。
 */
function explainerLayers(project: Project, names: readonly string[], commands: Command[]): Map<string, string> {
  const ids = new Map<string, string>()
  const portrait = project.layers.find((layer) => layer.id === DEFAULT_LAYER_IDS.portrait)
  // 足したレイヤーの位置。あとから調べる既存のレイヤーの位置は、足した分だけ押し上がる。
  const inserted: number[] = []
  const shifted = (index: number): number => inserted.reduce((value, at) => (value >= at ? value + 1 : value), index)
  let next = portrait ? portrait.index : Math.max(0, ...project.layers.map((layer) => layer.index + 1))
  for (const name of names) {
    const existing = project.layers.find((layer) => layer.name === name)
    if (existing) {
      ids.set(name, existing.id)
      next = Math.max(next, shifted(existing.index) + 1)
      continue
    }
    const tempId = `ex-layer-${ids.size}`
    commands.push({ op: 'layer.insert', name, index: next, tempId })
    inserted.push(next)
    ids.set(name, tempId)
    next += 1
  }
  return ids
}

/**
 * 合成済みのセリフと見つけた画像を、タイムラインに並べるコマンド。1回の「元に戻す」で全部戻る。
 * セリフは間を空けて順に並べ、画像は次の画像まで画面の真ん中(字幕の上)に、出典は画面の右上に出す。全体を1つのグループにする。
 */
export function explainerCommands(project: Project, plan: ExplainerPlan): Command[] {
  const commands: Command[] = []
  const { width, height } = project.canvas
  const scale = width / 1920
  const starts: Ms[] = []
  let cursor = plan.atMs
  for (const line of plan.lines) {
    starts.push(cursor)
    cursor += Math.max(1, Math.round(line.synthesis.audioDurationMs)) + plan.gapMs
  }
  const endMs = cursor - plan.gapMs
  const total = endMs - plan.atMs
  if (plan.lines.length === 0 || total <= 0) return []

  if (plan.ripple) commands.push({ op: 'timeline.insertGap', atMs: plan.atMs, durationMs: total })
  // セリフを足したときに後ろのセリフをずらす設定でも、ここでは並べた場所から動かさない(並べ終えたら元に戻す)。
  const openGap = project.editing.openGapOnVoiceInsert === true
  if (openGap) commands.push({ op: 'project.setEditing', openGapOnVoiceInsert: false })

  const tempIds: string[] = []
  plan.lines.forEach((line, index) => {
    const tempId = `ex-v${index}`
    tempIds.push(tempId)
    commands.push(
      { op: 'voice.insert', characterId: line.characterId, text: line.text, atMs: starts[index]!, ...(line.expressionId ? { expressionId: line.expressionId } : {}), tempId },
      { op: 'voice.applySynthesis', itemId: tempId, expectedText: line.text, synthesis: line.synthesis }
    )
  })

  // 画像・出典・見出しのレイヤー(無ければ立ち絵のすぐ下に作る。立ち絵は画像より手前に出る)。
  const hasImages = plan.images.some((image) => image !== null)
  const showTitle = plan.showTitle && plan.title !== ''
  const layers = explainerLayers(
    project,
    [...(hasImages ? [EXPLAINER_IMAGE_LAYER, EXPLAINER_CITATION_LAYER] : []), ...(showTitle ? [EXPLAINER_TITLE_LAYER] : [])],
    commands
  )
  if (hasImages) {
    const imageLayerId = layers.get(EXPLAINER_IMAGE_LAYER)!
    const citationLayerId = layers.get(EXPLAINER_CITATION_LAYER)!

    const assetIds = new Map<string, string>()
    const changes = plan.images.map((image, index) => ({ image, index })).filter((entry) => entry.image !== null)
    changes.forEach(({ image, index }, order) => {
      const found = image!
      const startMs = starts[index]!
      const next = changes[order + 1]
      const until = next ? starts[next.index]! : endMs
      const durationMs = Math.max(200, until - startMs)
      // 素材(同じ画像は1つにまとめる)。
      let assetId = assetIds.get(found.path) ?? Object.entries(project.assets).find(([, asset]) => asset.path.absolute === found.path)?.[0]
      if (!assetId) {
        assetId = `ex-a${order}`
        commands.push({
          op: 'asset.add',
          asset: {
            type: 'image',
            path: { absolute: found.path, relative: null },
            width: found.width,
            height: found.height,
            license: { source: found.pageUrl, creditRequired: true, creditText: creditText(found) }
          },
          tempId: assetId
        })
      }
      assetIds.set(found.path, assetId)
      // 画面の真ん中に、幅 56%・高さ 50% に収まる大きさで置く(上の見出し・出典と、下の字幕にかからない高さ)。
      const fit = Math.min((width * 0.56) / Math.max(1, found.width), (height * 0.5) / Math.max(1, found.height))
      const imageId = `ex-i${order}`
      tempIds.push(imageId)
      commands.push(
        {
          op: 'media.placeImage',
          assetId,
          atMs: startMs,
          durationMs,
          layerId: imageLayerId,
          transform: { x: Math.round(width / 2), y: Math.round(height * 0.47), scale: Math.round(fit * 1000) / 1000 },
          tempId: imageId
        },
        {
          op: 'item.setMediaLook',
          itemIds: [imageId],
          frame: { shape: 'rounded', radiusPx: Math.round(16 * scale), border: { color: '#ffffff', widthPx: Math.max(2, Math.round(6 * scale)) }, shadow: { color: '#00000099', offsetX: 0, offsetY: Math.round(6 * scale), blurPx: Math.round(18 * scale) } }
        },
        { op: 'item.addEffect', itemId: imageId, effect: { type: 'transition', in: { kind: 'pop', durationMs: 300 }, out: { kind: 'fade', durationMs: 200 } } }
      )

      // 出典(画面の右上。帯を敷いて小さく)。
      const text = citationText(found)
      const look: TextLook = {
        color: '#ffffff',
        fontWeight: 500,
        fontSizePx: Math.max(12, Math.round(24 * scale)),
        align: 'right',
        outline: 'none',
        shadow: 'none',
        background: { color: '#000000', opacity: 0.55, paddingPx: Math.round(8 * scale), radiusPx: Math.round(6 * scale) }
      }
      const textWidth = plan.measure ? plan.measure(text, look) : Array.from(text).length * (look.fontSizePx ?? 24) * 0.9
      const margin = Math.round(24 * scale)
      const pad = look.background!.paddingPx
      const citationId = `ex-c${order}`
      tempIds.push(citationId)
      commands.push(
        {
          op: 'media.placeText',
          text,
          atMs: startMs,
          durationMs,
          layerId: citationLayerId,
          transform: { x: Math.round(width - margin - pad - textWidth / 2), y: Math.round(margin + pad + (look.fontSizePx ?? 24) / 2) },
          tempId: citationId
        },
        { op: 'item.setTextLook', itemIds: [citationId], look, replace: true }
      )
    })
  }

  // 見出し(最初のセリフの間、画面の上に)。
  if (showTitle) {
    const first = plan.lines[0]!
    commands.push(
      {
        op: 'media.placeText',
        text: plan.title,
        atMs: plan.atMs,
        durationMs: Math.max(2500, Math.round(first.synthesis.audioDurationMs)),
        layerId: layers.get(EXPLAINER_TITLE_LAYER)!,
        transform: { x: Math.round(width / 2), y: Math.round(height * 0.12) },
        tempId: 'ex-title'
      },
      {
        op: 'item.setTextLook',
        itemIds: ['ex-title'],
        look: {
          color: '#ffffff',
          fontWeight: 900,
          fontSizePx: Math.round(56 * scale),
          outline: 'none',
          shadow: 'none',
          background: { color: '#1e5bd8', opacity: 0.92, paddingPx: Math.round(16 * scale), radiusPx: Math.round(10 * scale) }
        },
        replace: true
      },
      { op: 'item.addEffect', itemId: 'ex-title', effect: { type: 'transition', in: { kind: 'wipeRight', durationMs: 350 }, out: { kind: 'fade', durationMs: 250 } } }
    )
    tempIds.push('ex-title')
  }

  if (openGap) commands.push({ op: 'project.setEditing', openGapOnVoiceInsert: true })
  // 解説のまとまりを1つのグループにして、一緒に動かせるようにする。
  if (tempIds.length >= 2) commands.push({ op: 'item.group', itemIds: tempIds })
  return commands
}

/** 解説の合計の長さ(セリフと間)。 */
export function explainerDurationMs(lines: readonly { synthesis: SynthesisResult }[], gapMs: Ms): Ms {
  if (lines.length === 0) return 0
  return lines.reduce((sum, line) => sum + Math.max(1, Math.round(line.synthesis.audioDurationMs)), 0) + gapMs * (lines.length - 1)
}
