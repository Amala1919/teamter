import { formatDurationJa, formatMs } from '../lib/time'
import { itemEndMs, projectDurationMs, voiceItemsInOrder } from '../project/queries'
import type { ChatMessage, Item, ItemId, Project } from '../project/types'
import { briefingPromptSection } from './briefing'
import { MAX_AI_COMMANDS } from './edit-commands'
import type { ChatTurn, GenerateRequest } from './types'

/**
 * 編集AIへの依頼文を作る(AI_EDIT_PROTOCOL.md 3章・4章)。
 * プロジェクト全体は渡さず、編集に必要な表だけを渡す。素材ファイルの中身は送らない。
 */

export interface EditorRequest {
  message: string
  selection: ItemId[]
  /** 直近のやりとり(古い順)。 */
  history: Pick<ChatMessage, 'role' | 'content'>[]
}

/** 台本をすべて原文で渡す上限。これを超えたら選択範囲の周辺だけにする。 */
export const SCRIPT_LINES_LIMIT = 150
const SCRIPT_WINDOW = 50
const HISTORY_TURNS = 8

function itemSummary(project: Project, item: Item): string {
  const layer = project.layers.find((candidate) => candidate.id === item.layerId)?.name ?? item.layerId
  const range = `${formatMs(item.startMs)}-${formatMs(itemEndMs(item))}`
  const base = `${item.id} ${item.type} [${layer}] ${range}`
  switch (item.type) {
    case 'video':
    case 'audio':
      if (item.type === 'video' && item.freeze) return `${base} asset=${item.assetId} 静止画(素材の${formatMs(item.inMs)}のコマ)`
      return `${base} asset=${item.assetId} 素材の${formatMs(item.inMs)}から 音量${item.volume}${item.type === 'audio' && item.loop ? ' ループ' : ''}`
    case 'image':
      return `${base} asset=${item.assetId}`
    case 'text':
      return `${base} 「${item.text}」`
    case 'shape':
      return `${base} 図形=${item.shape} 色=${item.fill}${item.width ? ` ${Math.round(item.width)}x${Math.round(item.height ?? 0)}` : ' 画面いっぱい'} 中心=${Math.round(item.transform.x)},${Math.round(item.transform.y)}`
    case 'zoom':
      return `${base} 範囲 x=${item.region.x} y=${item.region.y} 幅=${item.region.width} 寄り方=${item.method}`
    case 'portrait':
      return `${base} 立ち絵 ${project.characters[item.characterId]?.name ?? item.characterId} ${item.kind ?? 'show'}${item.expressionId ? ` 表情=${item.expressionId}` : ''}`
    default:
      return base
  }
}

export function buildEditorContext(project: Project, selection: readonly ItemId[]): string {
  const lines = voiceItemsInOrder(project)
  const selected = new Set(selection)
  const selectedIndexes = lines.map((line, index) => (selected.has(line.id) ? index : -1)).filter((index) => index >= 0)
  let shown = lines.map((line, index) => ({ line, index }))
  let note = ''
  if (lines.length > SCRIPT_LINES_LIMIT) {
    const center = selectedIndexes.length > 0 ? selectedIndexes[0]! : lines.length - 1
    const from = Math.max(0, center - SCRIPT_WINDOW)
    const to = Math.min(lines.length, center + SCRIPT_WINDOW)
    shown = shown.slice(from, to)
    note = `(台本は全${lines.length}行。ここでは${from + 1}〜${to}行目だけを示す。範囲外は変更しないこと)\n`
  }

  const characters = Object.values(project.characters).map((character) => {
    const expressions = Object.values(character.portrait?.expressions ?? {})
      .map((expression) => `${expression.id}=${expression.name}`)
      .join(', ')
    return `- ${character.id} ${character.name}(${character.authorRole === 'ai' ? 'AIが演じる相方' : '投稿者本人'})${expressions ? ` 表情: ${expressions}` : ''}`
  })
  const assets = Object.entries(project.assets).map(([assetId, asset]) => {
    const name = asset.path.absolute.split(/[\\/]/).at(-1)
    const length = asset.type === 'video' || asset.type === 'audio' ? ` 長さ${formatMs(asset.durationMs)}` : ''
    const size = asset.type === 'video' || asset.type === 'image' ? ` ${asset.width}x${asset.height}` : ''
    return `- ${assetId} ${asset.type} ${name}${length}${size}`
  })
  const layers = [...project.layers].sort((a, b) => b.index - a.index).map((layer) => `- ${layer.id} ${layer.name}(前後順 ${layer.index})`)
  const others = project.items.filter((item) => item.type !== 'voice').map((item) => `- ${itemSummary(project, item)}`)
  const styles = Object.values(project.subtitleStyles).map((style) => `- ${style.id} ${style.name}`)

  return [
    `## 動画\n${project.canvas.width}x${project.canvas.height} ${project.canvas.fps}fps 総尺 ${formatDurationJa(projectDurationMs(project))}`,
    project.meta.synopsis?.trim() ? `## 企画メモ\n${project.meta.synopsis.trim()}` : '',
    `\n${briefingPromptSection(project)}`,
    `## キャラクター\n${characters.join('\n') || '(なし)'}`,
    `## 台本(発話順。ID 話者 開始 尺 セリフ)\n${note}${
      shown
        .map(({ line, index }) => {
          const speaker = project.characters[line.characterId]?.name ?? '?'
          const mark = selected.has(line.id) ? ' ★選択中' : ''
          return `${index + 1}. ${line.id} ${speaker} ${formatMs(line.startMs)} ${(line.durationMs / 1000).toFixed(1)}秒 「${line.text}」${mark}`
        })
        .join('\n') || '(まだセリフが無い)'
    }`,
    `## レイヤー(上ほど前面)\n${layers.join('\n')}`,
    `## セリフ以外のアイテム\n${others.join('\n') || '(なし)'}`,
    `## 素材\n${assets.join('\n') || '(なし)'}`,
    `## 字幕スタイル\n${styles.join('\n')}`,
    project.markers && project.markers.length > 0
      ? `## 目印(投稿者のメモ)\n${project.markers.map((marker) => `- ${marker.id} ${formatMs(marker.atMs)} ${marker.text || '(メモなし)'}`).join('\n')}`
      : '',
    selection.length > 0 ? `## 選択中\n${selection.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildEditorPrompt(project: Project, request: EditorRequest): Omit<GenerateRequest, 'jsonSchema'> {
  const system = [
    'あなたはゲーム実況動画(VOICEVOX の合成音声とキャラクターの立ち絵で作る動画)の編集アシスタントです。',
    '利用者の指示を、プロジェクトを編集するコマンドの列に変換します。コマンドは利用者が確認してから適用されます。',
    '',
    '## 決まりごと',
    '- 出力は指定のJSONだけ。reply に日本語で短い説明、commands にコマンドの配列',
    '- 質問や相談で、編集が要らないなら commands は空配列にする',
    '- ID は下の表にあるものだけを使う。新しく作ったものを後で参照するときは tempId を付け、その値を ID として使う',
    '- 時刻と長さはミリ秒。座標は動画の画素(左上が 0,0)。変形の x, y はアイテムの中心',
    '- 投稿者本人の役のセリフは、指示がない限り書き換えない(相方のセリフや演出は指示の範囲で変えてよい)',
    '- セリフの長さ(尺)は音声合成で決まる。セリフの開始時刻や間は変えられるが、セリフの尺は直接変えられない',
    '- ズーム(zoom.insert)の region は幅だけを指定し、高さは動画の縦横比で決まる。立ち絵や字幕も拡大したいときだけ wholeScreen を true にする',
    `- 1回の提案は${MAX_AI_COMMANDS}コマンドまで。それより大きい変更は、何回かに分けることを reply で提案する`,
    '- 素材の追加・削除、保存・書き出しはできない。必要なら reply で利用者に頼む',
    '- 強調の演出には装飾(media.placeShape)が使える: 手書きの丸(handCircle)・矢印(arrow/curveArrow)・吹き出し(bubble/shout/cloud)・集中線(focusLines)・スポットライト(spotlight)・紙吹雪(confetti)など。props に width・height(画素)・stroke(縁取り)・drawMs(描いていく時間)を入れ、effects で動き(pulse・blink・transition など)を付ける',
    '- 待ち時間(相手のターン・ロード)を飛ばすには video.condense(cut か speed)。場面の切り替えには timeline.crossTransition が使える'
  ].join('\n')

  const history: ChatTurn[] = request.history.slice(-HISTORY_TURNS * 2).map((message) => ({ role: message.role, content: message.content }))
  const turns: ChatTurn[] = [
    ...history,
    {
      role: 'user',
      content: `${buildEditorContext(project, request.selection)}\n\n## 指示\n${request.message}`
    }
  ]
  return { system, turns }
}
