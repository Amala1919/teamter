import { useEffect, useState } from 'react'

import type { Command } from '@shared/commands/types'
import { effectiveVoice, findItem, itemEndMs, voiceItemsInOrder } from '@shared/project/queries'
import type { VoiceItem, VoiceParams } from '@shared/project/types'
import { accentPhrasesToKana } from '@shared/voice/kana'

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
  ShapeInspector,
  TextInspector,
  TimingInspector,
  TransformInspector,
  VolumeField,
  ZoomInspector,
  type Run
} from './ItemInspectors'

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
                </dd>
              </>
            )}
          </dl>
          <TimingInspector project={project} item={item} run={run} />
          {item.type === 'voice' && <VoiceInspector item={item} />}
          {item.type === 'portrait' && <PortraitSceneInspector project={project} item={item} run={run} />}
          {item.type === 'portrait' && <SpeakerEmphasisSettings project={project} run={run} />}
          {item.type === 'zoom' && <ZoomInspector project={project} item={item} run={run} />}
          {item.type === 'text' && <TextInspector project={project} item={item} run={run} />}
          {item.type === 'shape' && <ShapeInspector item={item} run={run} />}
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
                max={4}
                step={0.25}
                onCommit={(rate) => run([{ op: 'item.setSpeed', itemId: item.id, rate }], '速度の変更')}
                testId="inspector-speed"
              />
              <PreviewQualityInspector project={project} item={item} run={run} />
            </section>
          )}
          {'transform' in item && <TransformInspector item={item} run={run} />}
          {item.type !== 'zoom' && item.type !== 'audio' && <EffectsInspector item={item} run={run} />}
          {'assetId' in item && <LicenseInspector project={project} assetId={item.assetId} run={run} />}
        </div>
      )}
    </section>
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

/** 読み方を直す(V-6)。今の読みをカタカナとアクセント記号で見せ、直した読みで合成し直す。 */
function ReadingEditor({ item, run }: { item: VoiceItem; run: (commands: Command[], label: string) => void }): React.JSX.Element {
  const current = item.reading ?? (item.synthesis ? accentPhrasesToKana(item.synthesis.accentPhrases) : '')
  const [draft, setDraft] = useState(current)
  useEffect(() => setDraft(current), [current])
  return (
    <section data-testid="reading-editor">
      <label className="field">
        <span className="field__label">
          読み方{item.reading ? '(手で直した読み)' : '(自動)'}
        </span>
        <input
          type="text"
          value={draft}
          placeholder="合成が終わると、今の読みが出ます"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim() !== '' && draft !== current) run([{ op: 'voice.setReading', itemId: item.id, reading: draft }], '読み方の変更')
          }}
          data-testid="reading-input"
        />
      </label>
      <p className="note">カタカナで書き、アクセントの山の後に「'」、言葉の区切りに「/」、息継ぎに「、」を入れます。例: ズンダモ'ン/ナノ'ダ</p>
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
