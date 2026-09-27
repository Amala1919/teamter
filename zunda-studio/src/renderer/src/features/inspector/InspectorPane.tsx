import type { Command } from '@shared/commands/types'
import { effectiveVoice, findItem, itemEndMs, voiceItemsInOrder } from '@shared/project/queries'
import type { VoiceItem, VoiceParams } from '@shared/project/types'

import { formatMs } from '../../lib/time'
import { useEditorStore } from '../../state/store'
import { VoiceParamsEditor } from '../characters/VoiceParamsEditor'

export function InspectorPane(): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const selectedItemIds = useEditorStore((state) => state.selectedItemIds)
  const firstId = selectedItemIds[0]
  const item = firstId === undefined ? undefined : findItem(project, firstId)

  return (
    <section className="pane pane--inspector" data-testid="inspector">
      <header className="pane__header">
        <h2>インスペクタ</h2>
      </header>
      {!item ? (
        <p className="pane__empty">アイテムを選択すると設定が表示される。</p>
      ) : (
        <>
          <dl className="inspector__list">
            <dt>種類</dt>
            <dd>{ITEM_LABELS[item.type] ?? item.type}</dd>
            <dt>区間</dt>
            <dd>
              {formatMs(item.startMs)} – {formatMs(itemEndMs(item))}({(item.durationMs / 1000).toFixed(2)}秒)
            </dd>
            <dt>レイヤー</dt>
            <dd>{project.layers.find((layer) => layer.id === item.layerId)?.name ?? item.layerId}</dd>
          </dl>
          {item.type === 'voice' && <VoiceInspector item={item} />}
        </>
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
  portrait: '立ち絵'
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
