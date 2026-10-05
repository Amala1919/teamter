import { useState } from 'react'

import {
  IMAGE_KIND_LABELS,
  IMAGE_POLICY_LABELS,
  INTERJECTION_LABELS,
  type ExplainerImagePolicy,
  type ExplainerStyle,
  type ImageSourceKind,
  type InterjectionFrequency
} from '@shared/ai/explainer'
import { formatModelRef, type ModelRef } from '@shared/ai/types'
import type { Character } from '@shared/project/types'

import { formatMs } from '../../lib/time'
import { cancelExplainer, createExplainer, resetExplainer, useExplainerStore } from '../../state/explainer'
import { useSettingsStore } from '../../state/settings'
import { useEditorStore } from '../../state/store'
import { Modal } from '../../ui/Modal'
import { ModelPicker } from '../settings/ModelPicker'

const LENGTHS: { seconds: number; label: string }[] = [
  { seconds: 30, label: '30秒' },
  { seconds: 60, label: '1分' },
  { seconds: 120, label: '2分' },
  { seconds: 180, label: '3分' },
  { seconds: 300, label: '5分' },
  { seconds: 600, label: '10分' }
]

/** 語り方の選択肢の説明。 */
const STYLE_LABELS: Record<ExplainerStyle, string> = {
  solo: 'AIひとりで語る',
  dialogue: 'AI同士の掛け合い'
}

/**
 * 動画の中に入れる解説パートを作る。お題と目安の長さ・語り方を決めると、選んだ AI が台本を書き、
 * セリフ(字幕と立ち絵はいつもどおり)と、話に合う参考画像(画面の真ん中・出典は画面の右上)を並べる。
 */
export function ExplainerDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  // 一覧は毎回新しい配列になるので、ストアからは元のオブジェクトを受け取り、ここで並べる(並べたものを選ぶと描画が止まらなくなる)。
  const characterMap = useEditorStore((state) => state.project.characters)
  const characters = Object.values(characterMap)
  const editorModel = useSettingsStore((state) => state.settings?.ai.roles.editor ?? null)
  const phase = useExplainerStore((state) => state.phase)
  const aiCharacters = characters.filter((character) => character.authorRole === 'ai')
  const userCharacters = characters.filter((character) => character.authorRole === 'user')

  const [topic, setTopic] = useState('')
  const [seconds, setSeconds] = useState(120)
  const [style, setStyle] = useState<ExplainerStyle>(aiCharacters.length >= 2 ? 'dialogue' : 'solo')
  const [solo, setSolo] = useState(aiCharacters[0]?.id ?? characters[0]?.id ?? '')
  const [group, setGroup] = useState<string[]>(aiCharacters.slice(0, 2).map((character) => character.id))
  const [interject, setInterject] = useState(userCharacters.length > 0)
  const [interjector, setInterjector] = useState(userCharacters[0]?.id ?? '')
  const [frequency, setFrequency] = useState<InterjectionFrequency>('normal')
  const [audience, setAudience] = useState('')
  const [instruction, setInstruction] = useState('')
  const [images, setImages] = useState(true)
  const [imageSources, setImageSources] = useState<ExplainerImagePolicy>('web')
  const [webSearch, setWebSearch] = useState(true)
  const [showTitle, setShowTitle] = useState(true)
  const [showPortraits, setShowPortraits] = useState(true)
  const [separateSpeech, setSeparateSpeech] = useState(true)
  const [place, setPlace] = useState<'playhead' | 'end'>('playhead')
  const [ripple, setRipple] = useState(true)
  const [model, setModel] = useState<ModelRef | null>(null)

  // 一次ソースなどの画像はウェブで探すので、そのときはウェブを使う。
  const webImages = images && imageSources === 'web'
  const narrators = style === 'solo' ? [solo].filter(Boolean) : group
  const usedModel = model ?? editorModel
  const running = phase.kind === 'writing' || phase.kind === 'voicing' || phase.kind === 'images'
  const problem =
    topic.trim() === ''
      ? 'お題を書いてください'
      : narrators.length === 0
        ? '解説するキャラクターを選んでください'
        : style === 'dialogue' && narrators.length < 2
          ? '掛け合いには2人以上選んでください'
          : interject && (interjector === '' || narrators.includes(interjector))
            ? '合いの手を入れるキャラクターは、解説するキャラクター以外から選んでください'
            : !usedModel
              ? '使うAIを選んでください(設定の「AI」で編集AIを決めるか、下で選ぶ)'
              : null

  const start = (): void => {
    if (problem) return
    void createExplainer(
      {
        topic: topic.trim(),
        targetSeconds: seconds,
        style,
        narrators,
        interjector: interject ? { characterId: interjector, frequency } : null,
        ...(audience.trim() ? { audience: audience.trim() } : {}),
        ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
        images,
        imageSources,
        separateSpeech
      },
      { model, webSearch: webSearch || webImages, place, ripple, showTitle, showPortraits }
    )
  }

  const close = (): void => {
    if (running) return
    resetExplainer()
    onClose()
  }

  const toggleGroup = (character: Character, checked: boolean): void =>
    setGroup((current) => (checked ? [...current, character.id] : current.filter((id) => id !== character.id)))

  return (
    <Modal
      title="解説パートを作る"
      onClose={close}
      wide
      footer={
        running ? (
          <button type="button" className="button--danger" onClick={cancelExplainer} data-testid="explainer-cancel">
            やめる
          </button>
        ) : (
          <>
            <button type="button" onClick={close}>
              閉じる
            </button>
            <button type="button" className="button--primary" disabled={problem !== null} onClick={start} title={problem ?? undefined} data-testid="explainer-start">
              {phase.kind === 'done' ? 'もう一度作る' : '作る'}
            </button>
          </>
        )
      }
    >
      <div className="settings-section explainer">
        {characters.length === 0 ? (
          <p className="pane__empty">先にキャラクターを足してください(台本の欄の「キャラクター」)。</p>
        ) : (
          <>
            <label className="field field--stacked">
              <span className="field__label">お題</span>
              <textarea
                rows={3}
                value={topic}
                placeholder="例: カイザーライヒの世界観と、ドイツ帝国が勝った世界の主な国"
                onChange={(event) => setTopic(event.target.value)}
                data-testid="explainer-topic"
              />
            </label>
            <div className="field__row field__row--wrap">
              <label className="field field--inline">
                <span className="field__label">目安の長さ</span>
                <select value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} data-testid="explainer-length">
                  {LENGTHS.map((length) => (
                    <option key={length.seconds} value={length.seconds}>
                      {length.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field field--inline">
                <span className="field__label">見る人(任意)</span>
                <input type="text" value={audience} placeholder="例: このゲームを知らない人" onChange={(event) => setAudience(event.target.value)} />
              </label>
            </div>

            <h3>語り方</h3>
            <div className="segmented" role="radiogroup" aria-label="語り方">
              {(Object.keys(STYLE_LABELS) as ExplainerStyle[]).map((value) => (
                <label key={value}>
                  <input type="radio" name="explainer-style" checked={style === value} onChange={() => setStyle(value)} data-testid={`explainer-style-${value}`} />
                  {STYLE_LABELS[value]}
                </label>
              ))}
            </div>
            {style === 'solo' ? (
              <label className="field field--inline">
                <span className="field__label">語るキャラクター</span>
                <select value={solo} onChange={(event) => setSolo(event.target.value)} data-testid="explainer-solo">
                  {characters.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.name}
                      {character.authorRole === 'user' ? '(あなた)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="field__row field__row--wrap" data-testid="explainer-group">
                <span className="field__label">掛け合うキャラクター</span>
                {characters.map((character) => (
                  <label key={character.id} className="field__row">
                    <input type="checkbox" checked={group.includes(character.id)} onChange={(event) => toggleGroup(character, event.target.checked)} />
                    {character.name}
                    {character.authorRole === 'user' ? '(あなた)' : ''}
                  </label>
                ))}
              </div>
            )}
            <div className="field__row field__row--wrap">
              <label className="field__row">
                <input type="checkbox" checked={interject} onChange={(event) => setInterject(event.target.checked)} data-testid="explainer-interject" />
                合いの手を入れる
              </label>
              {interject && (
                <>
                  <select value={interjector} onChange={(event) => setInterjector(event.target.value)} aria-label="合いの手を入れるキャラクター" data-testid="explainer-interjector">
                    <option value="">選ぶ…</option>
                    {characters.map((character) => (
                      <option key={character.id} value={character.id}>
                        {character.name}
                        {character.authorRole === 'user' ? '(あなた)' : ''}
                      </option>
                    ))}
                  </select>
                  <select value={frequency} onChange={(event) => setFrequency(event.target.value as InterjectionFrequency)} aria-label="合いの手の多さ" data-testid="explainer-frequency">
                    {(Object.keys(INTERJECTION_LABELS) as InterjectionFrequency[]).map((value) => (
                      <option key={value} value={value}>
                        {INTERJECTION_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
            <p className="note">合いの手は「へぇ〜」「それってつまり?」のような短い一言です。AI が下書きするので、できたあと台本で自分の言葉に直せます。</p>

            <h3>画面</h3>
            <label className="field__row">
              <input type="checkbox" checked={images} onChange={(event) => setImages(event.target.checked)} data-testid="explainer-images" />
              話に合う参考画像を探して、画面の真ん中に出す(出典を画面の右上に出し、概要欄のクレジットにも入れる)
            </label>
            {images && (
              <>
                <div className="segmented" role="radiogroup" aria-label="画像の探し先">
                  {(Object.keys(IMAGE_POLICY_LABELS) as ExplainerImagePolicy[]).map((value) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="explainer-image-sources"
                        checked={imageSources === value}
                        onChange={() => setImageSources(value)}
                        data-testid={`explainer-image-sources-${value}`}
                      />
                      {IMAGE_POLICY_LABELS[value]}
                    </label>
                  ))}
                </div>
                {imageSources === 'web' ? (
                  <p className="note">
                    AI がウェブで、公式サイト・公的機関・博物館などの一次ソースや、大手の報道・学術機関などある程度信頼できるサイトの画像を探します
                    (まとめ・転載・掲示板のサイトは使いません)。見つからなければ Wikimedia Commons で探します。ウェブで調べられるのは Claude のときだけです。
                    公式サイトなどの画像は著作物なので、解説に必要な範囲で、出典を出して使います(引用)。投稿先の決まりも確かめてください。
                  </p>
                ) : (
                  <p className="note">Wikimedia Commons の、自由なライセンスの画像だけを使います(作者とライセンスも出します)。</p>
                )}
              </>
            )}
            <label className="field__row">
              <input type="checkbox" checked={showTitle} onChange={(event) => setShowTitle(event.target.checked)} />
              最初に見出しを出す
            </label>
            <label className="field__row">
              <input type="checkbox" checked={showPortraits} onChange={(event) => setShowPortraits(event.target.checked)} data-testid="explainer-show-portraits" />
              解説のあいだ、話すキャラクターの立ち絵を出す(立ち絵の表示の区間が途中で切れていれば、解説のあいだの区間を足す)
            </label>
            <label className="field__row">
              <input type="checkbox" checked={separateSpeech} onChange={(event) => setSeparateSpeech(event.target.checked)} data-testid="explainer-separate-speech" />
              読み間違えを防ぐため、読み上げる文を字幕と分ける
            </label>
            <p className="note">
              字幕と立ち絵はいつもどおり出ます(表情もセリフに合わせて AI が選びます)。
              {separateSpeech
                ? ' 分けると、AI が数字・英字・固有名詞など読み間違えやすい語だけをかなにした「読み上げる文」も書き、声はそれで作ります。字幕はふつうの文のまま出ます(セリフの「字幕に出す文字」で直せます)。'
                : ''}
            </p>

            <h3>置く場所</h3>
            <div className="segmented" role="radiogroup" aria-label="置く場所">
              <label>
                <input type="radio" name="explainer-place" checked={place === 'playhead'} onChange={() => setPlace('playhead')} />
                再生位置
              </label>
              <label>
                <input type="radio" name="explainer-place" checked={place === 'end'} onChange={() => setPlace('end')} data-testid="explainer-place-end" />
                最後に足す
              </label>
              {place === 'playhead' && (
                <label>
                  <input type="checkbox" checked={ripple} onChange={(event) => setRipple(event.target.checked)} />
                  後ろの素材をずらして場所を空ける
                </label>
              )}
            </div>

            <h3>AI</h3>
            <ModelPicker value={model} onChange={setModel} inheritLabel={`編集AIを使う${editorModel ? `(${formatModelRef(editorModel)})` : '(未設定)'}`} testId="explainer-model" />
            <label className="field__row">
              <input type="checkbox" checked={webSearch || webImages} disabled={webImages} onChange={(event) => setWebSearch(event.target.checked)} />
              事実をウェブで確かめながら書く(Claude のときだけ。時間がかかります)
              {webImages ? '。一次ソースなどの画像を探すので、ウェブを使います' : ''}
            </label>
            <label className="field field--stacked">
              <span className="field__label">指示(任意)</span>
              <textarea rows={2} value={instruction} placeholder="例: 年表のように順を追って。最後に今日のプレイとのつながりを一言" onChange={(event) => setInstruction(event.target.value)} />
            </label>
          </>
        )}

        <ExplainerStatus />
        {problem && !running && phase.kind !== 'done' && topic.trim() !== '' && <p className="status status--warn">{problem}</p>}
      </div>
    </Modal>
  )
}

/** 出どころごとの画像の数(「一次ソース 2・Wikimedia Commons 1」)。 */
function describeKinds(kinds: Record<ImageSourceKind, number>): string {
  return (Object.keys(IMAGE_KIND_LABELS) as ImageSourceKind[])
    .filter((kind) => kinds[kind] > 0)
    .map((kind) => `${IMAGE_KIND_LABELS[kind]} ${kinds[kind]}`)
    .join('・')
}

function ExplainerStatus(): React.JSX.Element | null {
  const phase = useExplainerStore((state) => state.phase)
  switch (phase.kind) {
    case 'idle':
      return null
    case 'writing':
      return (
        <p className="status" data-testid="explainer-status">
          AI が台本を書いています…(ウェブで調べると数分かかります)
        </p>
      )
    case 'voicing':
      return (
        <p className="status" data-testid="explainer-status">
          セリフの音声を作っています… {phase.done}/{phase.total}
        </p>
      )
    case 'images':
      return (
        <p className="status" data-testid="explainer-status">
          参考画像を探しています… {phase.done}/{phase.total}
        </p>
      )
    case 'done':
      return (
        <div className="status status--ok" data-testid="explainer-done">
          <p>
            {phase.lines}行のセリフ(約{formatMs(phase.durationMs).replace(/\.\d+$/, '')})と、参考画像 {phase.images}枚を並べました。
            {phase.images > 0 ? `(${describeKinds(phase.imageKinds)})` : ''}
            {phase.missingImages > 0 ? ` 見つからなかった画像が ${phase.missingImages}枚あります(その間は前の画像のまま)。` : ''}
            {phase.webSearched ? ' 事実はウェブで確かめています。' : ''}
          </p>
          {phase.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          <p className="note">
            {formatModelRef(phase.generatedBy)} が書きました。まとめて1つのグループになっているので、一緒に動かせます。気に入らなければ「元に戻す」で1回で消せます。
          </p>
        </div>
      )
    case 'error':
      return (
        <p className="status status--error" data-testid="explainer-error">
          {phase.message}
        </p>
      )
  }
}
