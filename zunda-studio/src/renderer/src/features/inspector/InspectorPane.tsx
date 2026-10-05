import { useEffect, useState } from 'react'

import type { Command } from '@shared/commands/types'
import { effectiveVoice, findItem, itemEndMs, voiceItemsInOrder } from '@shared/project/queries'
import type { ImageItem, Item, Project, ShapeItem, TextItem, VideoItem, VoiceItem, VoiceParams } from '@shared/project/types'
import { accentPhrasesToKana } from '@shared/voice/kana'

import { itemLabel } from '../../lib/item-label'
import { formatMs } from '../../lib/time'
import { deleteSelection, useEditorStore } from '../../state/store'
import { NumberField } from '../../ui/NumberField'
import { PortraitSceneInspector, SpeakerEmphasisSettings } from './PortraitInspectors'
import { VoiceParamsEditor } from '../characters/VoiceParamsEditor'
import {
  AudioInspector,
  EffectsInspector,
  LicenseInspector,
  PreviewQualityInspector,
  TimingInspector,
  TransformInspector,
  VolumeField,
  ZoomInspector,
  type Run
} from './ItemInspectors'
import { MediaLookInspector } from './MediaLookInspector'
import { ShapeInspector } from './ShapeInspector'
import { TextInspector } from './TextInspector'

export function InspectorPane({ onError }: { onError: (message: string) => void }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const selectedItemIds = useEditorStore((state) => state.selectedItemIds)
  const dispatch = useEditorStore((state) => state.dispatch)
  const setSelection = useEditorStore((state) => state.setSelection)
  const firstId = selectedItemIds[0]
  const item = firstId === undefined ? undefined : findItem(project, firstId)

  const run: Run = (commands, label) => {
    const result = dispatch(commands, label)
    if (!result.ok) onError(result.message)
  }

  return (
    <section className="pane pane--inspector" data-testid="inspector">
      <header className="pane__header">
        <h2>インスペクタ</h2>
        {item && (
          <button
            type="button"
            className="button--small button--danger"
            onClick={() => {
              const message = deleteSelection()
              if (message) onError(message)
              else setSelection([])
            }}
            data-testid="inspector-delete"
          >
            削除
          </button>
        )}
      </header>
      {!item ? (
        <div className="settings-section">
          <p className="pane__empty">アイテムを選択すると設定が表示される。</p>
          {Object.values(project.characters).some((character) => character.portrait) && <SpeakerEmphasisSettings project={project} run={run} />}
        </div>
      ) : (
        <div className="settings-section" key={item.id}>
          <dl className="inspector__list">
            <dt>種類</dt>
            <dd data-testid="inspector-type">{ITEM_LABELS[item.type] ?? item.type}</dd>
            <dt>区間</dt>
            <dd>
              {formatMs(item.startMs)} – {formatMs(itemEndMs(item))}({(item.durationMs / 1000).toFixed(2)}秒)
            </dd>
            {item.groupId !== undefined && (
              <>
                <dt>グループ</dt>
                <dd data-testid="inspector-group">
                  {project.items.filter((candidate) => candidate.groupId === item.groupId).length}個で一緒に動く{' '}
                  <button
                    type="button"
                    className="button--small"
                    onClick={() => run([{ op: 'item.ungroup', itemIds: project.items.filter((candidate) => candidate.groupId === item.groupId).map((candidate) => candidate.id) }], 'グループを解く')}
                    data-testid="inspector-ungroup"
                  >
                    グループを解く
                  </button>
                  <GroupMembers project={project} item={item} run={run} />
                </dd>
              </>
            )}
          </dl>
          <TimingInspector project={project} item={item} run={run} />
          {item.type === 'voice' && <VoiceInspector item={item} />}
          {item.type === 'portrait' && <PortraitSceneInspector project={project} item={item} run={run} />}
          {item.type === 'portrait' && <SpeakerEmphasisSettings project={project} run={run} />}
          {item.type === 'zoom' && <ZoomInspector project={project} item={item} run={run} />}
          {item.type === 'text' && (
            <TextInspector
              project={project}
              item={item}
              targets={project.items.filter((candidate): candidate is TextItem => candidate.type === 'text' && selectedItemIds.includes(candidate.id))}
              run={run}
            />
          )}
          {item.type === 'shape' && (
            <ShapeInspector
              project={project}
              item={item}
              targets={project.items.filter((candidate): candidate is ShapeItem => candidate.type === 'shape' && selectedItemIds.includes(candidate.id))}
              run={run}
            />
          )}
          {item.type === 'audio' && <AudioInspector item={item} run={run} />}
          {item.type === 'video' && item.freeze && (
            <section>
              <h3>静止画</h3>
              <p className="note" data-testid="inspector-freeze">
                元の動画の {formatMs(item.inMs)} のコマを止めて表示しています(音は鳴りません)。長さはタイムラインの端か、上の「長さ」で変えられます。
              </p>
            </section>
          )}
          {item.type === 'video' && !item.freeze && (
            <section>
              <h3>再生</h3>
              <VolumeField item={item} run={run} />
              <NumberField
                label="速度(倍)"
                value={item.playbackRate}
                min={0.25}
                max={16}
                step={0.25}
                onCommit={(rate) => run([{ op: 'item.setSpeed', itemId: item.id, rate }], '速度の変更')}
                testId="inspector-speed"
              />
              <PreviewQualityInspector project={project} item={item} run={run} />
            </section>
          )}
          {'transform' in item && <TransformInspector item={item} run={run} />}
          {(item.type === 'video' || item.type === 'image') && (
            <MediaLookInspector
              item={item}
              targets={project.items.filter((candidate): candidate is VideoItem | ImageItem => (candidate.type === 'video' || candidate.type === 'image') && selectedItemIds.includes(candidate.id))}
              run={run}
            />
          )}
          {item.type !== 'zoom' && item.type !== 'audio' && <EffectsInspector item={item} run={run} />}
          {'assetId' in item && <LicenseInspector project={project} assetId={item.assetId} run={run} />}
        </div>
      )}
    </section>
  )
}

/**
 * グループの仲間の一覧。1つずつ「外す」でグループから外せる(ほかの仲間はグループのまま)。
 * 名前を押すと、そのアイテムだけを選んで設定を開く。
 */
function GroupMembers({ project, item, run }: { project: Project; item: Item; run: Run }): React.JSX.Element {
  const setSelection = useEditorStore((state) => state.setSelection)
  const members = project.items.filter((candidate) => candidate.groupId === item.groupId).sort((a, b) => a.startMs - b.startMs)
  const remove = (member: Item): void => {
    run([{ op: 'item.ungroup', itemIds: [member.id] }], 'グループから外す')
    // 続けて外せるよう、残った仲間を選んだままにする(仲間が1つになってグループが解けたら、外したものを選ぶ)。
    const rest = members.filter((candidate) => candidate.id !== member.id).map((candidate) => candidate.id)
    setSelection(rest.length >= 2 ? rest : [member.id])
  }
  return (
    <ul className="inspector__groupMembers" data-testid="inspector-group-members">
      {members.map((member) => (
        <li key={member.id} className={member.id === item.id ? 'is-current' : undefined} data-testid="inspector-group-member">
          <button type="button" className="inspector__groupMemberName" onClick={() => setSelection([member.id])} title="これだけを選んで設定を開く">
            <span className="inspector__groupMemberType">{ITEM_LABELS[member.type] ?? member.type}</span>
            {itemLabel(project, member)}
          </button>
          <span className="inspector__groupMemberTime">{formatMs(member.startMs).replace(/\.\d+$/, '')}</span>
          <button
            type="button"
            className="button--small"
            onClick={() => remove(member)}
            title="これだけグループから外す(ほかはグループのまま)"
            aria-label={`「${itemLabel(project, member)}」をグループから外す`}
            data-testid="inspector-group-remove"
          >
            外す
          </button>
        </li>
      ))}
    </ul>
  )
}

const ITEM_LABELS: Record<string, string> = {
  voice: 'セリフ',
  video: '動画',
  image: '画像',
  text: 'テロップ',
  audio: '音声',
  shape: '図形',
  portrait: '立ち絵',
  zoom: 'ズーム'
}

function VoiceInspector({ item }: { item: VoiceItem }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const dispatch = useEditorStore((state) => state.dispatch)
  const voice = effectiveVoice(project, item)
  const lines = voiceItemsInOrder(project)
  const next = lines[lines.findIndex((line) => line.id === item.id) + 1]
  const gap = next ? next.startMs - itemEndMs(item) : null

  const run = (commands: Command[], label: string): void => {
    dispatch(commands, label)
  }

  const overridden = Object.fromEntries(
    Object.keys(item.voiceOverride ?? {}).map((key) => [key, true])
  ) as Partial<Record<keyof VoiceParams, boolean>>

  return (
    <div className="settings-section">
      <section>
        <h3>このセリフの声</h3>
        <p className="note">キャラクターの既定値から、このセリフだけ変えます。</p>
        {voice && (
          <VoiceParamsEditor
            values={voice.params}
            overridden={overridden}
            onCommit={(params) => run([{ op: 'voice.setVoiceParams', itemId: item.id, params }], '声の調整')}
            onReset={(key) => run([{ op: 'voice.setVoiceParams', itemId: item.id, params: { [key]: null } }], '声を既定に戻す')}
          />
        )}
      </section>

      {gap !== null && (
        <section>
          <label className="field">
            <span className="field__label">次のセリフまでの間(ms)</span>
            <input
              type="number"
              min={0}
              step={50}
              key={`${item.id}-${gap}`}
              defaultValue={gap}
              onBlur={(event) => {
                const value = Number(event.target.value)
                if (Number.isFinite(value) && value >= 0 && value !== gap) {
                  run([{ op: 'voice.setGapAfter', itemId: item.id, gapMs: value }], '間の変更')
                }
              }}
              data-testid="gap-after"
            />
          </label>
        </section>
      )}

      <DisplayTextEditor item={item} run={run} />

      <ReadingEditor item={item} run={run} />

      <section>
        <label className="field">
          <span className="field__label">字幕の改行</span>
          <textarea
            rows={Math.max(2, item.subtitleLines.length)}
            key={`${item.id}-${item.subtitleLines.join('|')}`}
            defaultValue={item.subtitleLines.join('\n')}
            onBlur={(event) => {
              const lines = event.target.value.split('\n')
              if (lines.join('\n') === item.subtitleLines.join('\n')) return
              run([{ op: 'voice.setSubtitleLines', itemId: item.id, lines }], '字幕の改行の変更')
            }}
          />
        </label>
        {item.subtitleLinesManual && (
          <button
            type="button"
            className="button--small"
            onClick={() => run([{ op: 'voice.setSubtitleLines', itemId: item.id, lines: null }], '字幕を自動改行に戻す')}
          >
            自動改行に戻す
          </button>
        )}
      </section>
    </div>
  )
}

/**
 * 字幕に出す文字。読み上げるセリフとは別の文字を出したいとき(「草」と出して「くさ」と読ませる、など)に使う。
 * 声は変わらない(読み方は下の「読み方」で直す)。
 */
function DisplayTextEditor({ item, run }: { item: VoiceItem; run: (commands: Command[], label: string) => void }): React.JSX.Element {
  const current = item.displayText ?? item.text
  const [draft, setDraft] = useState(current)
  useEffect(() => setDraft(current), [current])
  const hidden = item.subtitleHidden === true
  const setHidden = (next: boolean): void =>
    run([{ op: 'voice.setSubtitleHidden', itemIds: [item.id], hidden: next }], next ? '字幕を出さない' : '字幕を出す')
  const commit = (): void => {
    if (draft.trim() === '') {
      // 空にしたら、字幕を出さないことにする(文字は元のまま残す)
      setDraft(current)
      if (!hidden) setHidden(true)
      return
    }
    if (draft !== current) run([{ op: 'voice.setDisplayText', itemId: item.id, text: draft }], '字幕に出す文字の変更')
  }
  return (
    <section data-testid="display-text-editor">
      <label className="field__row">
        <input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} data-testid="subtitle-hidden" />
        このセリフの字幕を出さない(声はそのまま)
      </label>
      <label className="field field--stacked">
        <span className="field__label">字幕に出す文字{item.displayText ? '(セリフと別)' : '(セリフと同じ)'}</span>
        <textarea
          rows={2}
          value={draft}
          disabled={hidden}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            commit()
          }}
          data-testid="display-text-input"
        />
      </label>
      <p className="note">字幕だけを変えます(声はセリフのまま)。Enter で反映、Shift+Enter で改行。空にすると字幕を出さなくなります。セリフを書き換えると、セリフと同じに戻ります。</p>
      {item.displayText && (
        <button
          type="button"
          className="button--small"
          onClick={() => run([{ op: 'voice.setDisplayText', itemId: item.id, text: null }], '字幕をセリフと同じに戻す')}
          data-testid="display-text-reset"
        >
          セリフと同じに戻す
        </button>
      )}
    </section>
  )
}

/** 読み方を直す(V-6)。今の読みをカタカナとアクセント記号で見せ、直した読みで合成し直す。 */
function ReadingEditor({ item, run }: { item: VoiceItem; run: (commands: Command[], label: string) => void }): React.JSX.Element {
  const current = item.reading ?? (item.synthesis ? accentPhrasesToKana(item.synthesis.accentPhrases) : '')
  const [draft, setDraft] = useState(current)
  useEffect(() => setDraft(current), [current])
  return (
    <section data-testid="reading-editor">
      <label className="field field--stacked">
        <span className="field__label">
          読み方{item.reading ? '(手で直した読み)' : '(自動)'}
        </span>
        {/* 長い読みも折り返して全体が見えるよう、複数行のテキストボックスにする(読みに改行は無いので Enter で反映) */}
        <textarea
          className="reading-input"
          rows={4}
          value={draft}
          placeholder="合成が終わると、今の読みが出ます"
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value.replace(/[\r\n]+/g, ''))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            if (draft.trim() !== '' && draft !== current) run([{ op: 'voice.setReading', itemId: item.id, reading: draft }], '読み方の変更')
          }}
          data-testid="reading-input"
        />
      </label>
      <p className="note">カタカナで書き、アクセントの山の後に「'」、言葉の区切りに「/」、息継ぎに「、」を入れます。例: ズンダモ'ン/ナノ'ダ(Enter で反映)</p>
      <span className="field__row">
        <button
          type="button"
          className="button--small"
          disabled={draft.trim() === '' || draft === current}
          onClick={() => run([{ op: 'voice.setReading', itemId: item.id, reading: draft }], '読み方の変更')}
          data-testid="reading-apply"
        >
          この読みで合成
        </button>
        {item.reading && (
          <button type="button" className="button--small" onClick={() => run([{ op: 'voice.setReading', itemId: item.id, reading: null }], '読み方を自動に戻す')}>
            自動に戻す
          </button>
        )}
      </span>
    </section>
  )
}
