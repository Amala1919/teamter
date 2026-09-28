import type { Command } from '@shared/commands/types'
import { FREE_SOURCES, freeSource, licenseFromSource } from '@shared/media/free-sources'
import { DEFAULT_LAYER_IDS } from '@shared/project/factory'
import { ZOOM_METHODS, type AssetLicense, type AudioItem, type Effect, type Item, type Project, type ShapeItem, type TextItem, type Transform, type VideoItem, type ZoomItem } from '@shared/project/types'
import { defaultEffect, EFFECT_LABELS } from '@shared/render/effects'
import { defaultZoomTiming, ZOOM_METHOD_LABELS } from '@shared/render/zoom'

import { assetName } from '../../state/media'
import { NumberField } from '../../ui/NumberField'
import { CREDIT_LABELS } from '../media/FreeSourcesDialog'

export type Run = (commands: Command[], label: string) => void

const EASING_LABELS: Record<string, string> = {
  linear: '一定',
  easeInCubic: 'だんだん速く',
  easeOutCubic: 'だんだん遅く',
  easeInOutCubic: 'なめらか'
}

// ---------------------------------------------------------------- 区間・レイヤー

export function TimingInspector({ project, item, run }: { project: Project; item: Item; run: Run }): React.JSX.Element {
  const layers = [...project.layers].sort((a, b) => b.index - a.index)
  return (
    <section>
      <div className="field__row field__row--wrap">
        <NumberField
          label="開始(秒)"
          value={item.startMs}
          displayScale={0.001}
          step={0.1}
          min={0}
          onCommit={(value) => run([{ op: 'item.setTimeRange', itemId: item.id, startMs: value }], '開始時刻の変更')}
          testId="inspector-start"
        />
        {item.type !== 'voice' && (
          <NumberField
            label="長さ(秒)"
            value={item.durationMs}
            displayScale={0.001}
            step={0.1}
            min={0.01}
            onCommit={(value) => run([{ op: 'item.trim', itemId: item.id, endMs: item.startMs + value }], '長さの変更')}
            testId="inspector-duration"
          />
        )}
      </div>
      <label className="field field--inline">
        <span className="field__label">レイヤー</span>
        <select
          value={item.layerId}
          onChange={(event) => run([{ op: 'item.setLayer', itemId: item.id, layerId: event.target.value }], 'レイヤーの変更')}
          data-testid="inspector-layer"
        >
          {layers.map((layer) => (
            <option key={layer.id} value={layer.id}>
              {layer.name}
            </option>
          ))}
        </select>
      </label>
    </section>
  )
}

// ---------------------------------------------------------------- 変形

export function TransformInspector({ item, run }: { item: Item & { transform: Transform }; run: Run }): React.JSX.Element {
  const set = (patch: Partial<Transform>, label: string): void => run([{ op: 'item.setTransform', itemId: item.id, ...patch }], label)
  const { transform } = item
  return (
    <section>
      <h3>位置・大きさ</h3>
      <div className="field__row field__row--wrap">
        <NumberField label="X" value={transform.x} onCommit={(x) => set({ x }, '位置の変更')} testId="transform-x" />
        <NumberField label="Y" value={transform.y} onCommit={(y) => set({ y }, '位置の変更')} testId="transform-y" />
        <NumberField
          label="拡大率(%)"
          value={transform.scale}
          displayScale={100}
          min={1}
          step={5}
          onCommit={(scale) => set({ scale }, '大きさの変更')}
          testId="transform-scale"
        />
        <NumberField label="回転(度)" value={transform.rotation} step={5} onCommit={(rotation) => set({ rotation }, '回転の変更')} />
        <NumberField
          label="不透明度(%)"
          value={transform.opacity}
          displayScale={100}
          min={0}
          max={100}
          step={10}
          onCommit={(opacity) => set({ opacity }, '不透明度の変更')}
        />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- 音

export function VolumeField({ item, run }: { item: AudioItem | VideoItem; run: Run }): React.JSX.Element {
  return (
    <NumberField
      label="音量(%)"
      value={item.volume}
      displayScale={100}
      min={0}
      max={400}
      step={10}
      onCommit={(volume) => run([{ op: 'item.setAudio', itemId: item.id, volume }], '音量の変更')}
      testId="inspector-volume"
    />
  )
}

export function AudioInspector({ item, run }: { item: AudioItem; run: Run }): React.JSX.Element {
  const set = (patch: Omit<Extract<Command, { op: 'item.setAudio' }>, 'op' | 'itemId'>, label: string): void =>
    run([{ op: 'item.setAudio', itemId: item.id, ...patch }], label)
  return (
    <section>
      <h3>音</h3>
      <div className="field__row field__row--wrap">
        <VolumeField item={item} run={run} />
        <NumberField label="フェードイン(秒)" value={item.fadeInMs} displayScale={0.001} step={0.5} min={0} onCommit={(fadeInMs) => set({ fadeInMs }, 'フェードの変更')} />
        <NumberField label="フェードアウト(秒)" value={item.fadeOutMs} displayScale={0.001} step={0.5} min={0} onCommit={(fadeOutMs) => set({ fadeOutMs }, 'フェードの変更')} />
      </div>
      <label className="field__row">
        <input type="checkbox" checked={item.loop} onChange={(event) => set({ loop: event.target.checked }, 'ループの切り替え')} data-testid="inspector-loop" />
        ループする(タイムラインで伸ばすと繰り返す)
      </label>
      <label className="field__row">
        <input
          type="checkbox"
          checked={item.duckable}
          onChange={(event) => set({ duckable: event.target.checked }, 'ダッキングの切り替え')}
          data-testid="inspector-duckable"
        />
        セリフの間は音量を下げる
      </label>
    </section>
  )
}

// ---------------------------------------------------------------- テロップ・図形

export function TextInspector({ project, item, run }: { project: Project; item: TextItem; run: Run }): React.JSX.Element {
  return (
    <section>
      <h3>テロップ</h3>
      <label className="field">
        <span className="field__label">文字</span>
        <textarea
          rows={2}
          key={item.text}
          defaultValue={item.text}
          onBlur={(event) => {
            const text = event.target.value
            if (text.trim() !== '' && text !== item.text) run([{ op: 'item.setContent', itemId: item.id, text }], 'テロップの変更')
          }}
          data-testid="inspector-text"
        />
      </label>
      <label className="field field--inline">
        <span className="field__label">スタイル</span>
        <select value={item.styleId} onChange={(event) => run([{ op: 'item.setContent', itemId: item.id, styleId: event.target.value }], 'スタイルの変更')}>
          {Object.values(project.subtitleStyles).map((style) => (
            <option key={style.id} value={style.id}>
              {style.name}
            </option>
          ))}
        </select>
      </label>
    </section>
  )
}

export function ShapeInspector({ item, run }: { item: ShapeItem; run: Run }): React.JSX.Element {
  return (
    <section>
      <h3>図形</h3>
      <div className="field__row field__row--wrap">
        <label className="field field--inline">
          <span className="field__label">形</span>
          <select value={item.shape} onChange={(event) => run([{ op: 'item.setContent', itemId: item.id, shape: event.target.value as ShapeItem['shape'] }], '形の変更')}>
            <option value="rect">四角</option>
            <option value="ellipse">楕円</option>
          </select>
        </label>
        <label className="field field--inline">
          <span className="field__label">色</span>
          <input type="color" value={item.fill.slice(0, 7)} onChange={(event) => run([{ op: 'item.setContent', itemId: item.id, fill: event.target.value }], '色の変更')} />
        </label>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- ズーム

export function ZoomInspector({ project, item, run }: { project: Project; item: ZoomItem; run: Run }): React.JSX.Element {
  const topLayer = [...project.layers].sort((a, b) => b.index - a.index)[0]
  const wholeScreen = topLayer?.id === item.layerId
  const zoomLayer = project.layers.find((layer) => layer.id === DEFAULT_LAYER_IDS.zoom) ?? project.layers.find((layer) => layer.name === 'ズーム')
  return (
    <section data-testid="zoom-inspector">
      <h3>ズーム</h3>
      <p className="note">プレビューの枠をドラッグして範囲を決めます。四隅・四辺で大きさ、内側で位置を変えられます。</p>
      <label className="field field--inline">
        <span className="field__label">寄り方</span>
        <select
          value={item.method}
          onChange={(event) => {
            const method = event.target.value as ZoomItem['method']
            // 寄り方を変えたら、その寄り方に合った既定の時間にする。
            run([{ op: 'zoom.update', itemId: item.id, method, ...defaultZoomTiming(method) }], '寄り方の変更')
          }}
          data-testid="zoom-method"
        >
          {ZOOM_METHODS.map((method) => (
            <option key={method} value={method}>
              {ZOOM_METHOD_LABELS[method]}
            </option>
          ))}
        </select>
      </label>
      <div className="field__row field__row--wrap">
        {item.method !== 'cut' && item.method !== 'slowPush' && (
          <NumberField
            label="寄る時間(秒)"
            value={item.inMs}
            displayScale={0.001}
            step={0.1}
            min={0}
            onCommit={(inMs) => run([{ op: 'zoom.update', itemId: item.id, inMs }], '寄る時間の変更')}
            testId="zoom-in-ms"
          />
        )}
        {item.method !== 'cut' && (
          <NumberField
            label="戻る時間(秒)"
            value={item.outMs}
            displayScale={0.001}
            step={0.1}
            min={0}
            onCommit={(outMs) => run([{ op: 'zoom.update', itemId: item.id, outMs }], '戻る時間の変更')}
            testId="zoom-out-ms"
          />
        )}
      </div>
      <div className="field__row field__row--wrap">
        <NumberField label="枠のX" value={item.region.x} onCommit={(x) => run([{ op: 'zoom.update', itemId: item.id, region: { ...item.region, x } }], 'ズーム枠の変更')} />
        <NumberField label="枠のY" value={item.region.y} onCommit={(y) => run([{ op: 'zoom.update', itemId: item.id, region: { ...item.region, y } }], 'ズーム枠の変更')} />
        <NumberField
          label="枠の幅"
          value={item.region.width}
          onCommit={(width) => run([{ op: 'zoom.update', itemId: item.id, region: { ...item.region, width } }], 'ズーム枠の変更')}
          testId="zoom-width"
        />
      </div>
      <label className="field__row">
        <input
          type="checkbox"
          checked={wholeScreen}
          onChange={(event) => {
            const layerId = event.target.checked ? topLayer?.id : zoomLayer?.id
            if (layerId) run([{ op: 'item.setLayer', itemId: item.id, layerId }], 'ズームの範囲の変更')
          }}
          data-testid="zoom-whole-screen"
        />
        立ち絵と字幕も一緒に拡大する
      </label>
    </section>
  )
}

// ---------------------------------------------------------------- エフェクト

export function EffectsInspector({ item, run }: { item: Item; run: Run }): React.JSX.Element {
  const update = (index: number, effect: Effect): void =>
    run([{ op: 'item.updateEffect', itemId: item.id, effectIndex: index, effect }], 'エフェクトの変更')
  return (
    <section data-testid="effects-inspector">
      <h3>エフェクト</h3>
      {item.effects.map((effect, index) => (
        <div key={index} className="effect-row" data-testid="effect-row">
          <div className="effect-row__header">
            <strong>{EFFECT_LABELS[effect.type]}</strong>
            <button
              type="button"
              className="button--small button--danger"
              onClick={() => run([{ op: 'item.removeEffect', itemId: item.id, effectIndex: index }], 'エフェクトを外す')}
            >
              外す
            </button>
          </div>
          <EffectFields effect={effect} onChange={(next) => update(index, next)} />
        </div>
      ))}
      <label className="field field--inline">
        <span className="field__label">追加</span>
        <select
          value=""
          onChange={(event) => {
            const type = event.target.value as Effect['type']
            if (type) run([{ op: 'item.addEffect', itemId: item.id, effect: defaultEffect(type) }], 'エフェクトの追加')
          }}
          data-testid="add-effect"
        >
          <option value="">エフェクトを選ぶ…</option>
          {(Object.keys(EFFECT_LABELS) as Effect['type'][]).map((type) => (
            <option key={type} value={type}>
              {EFFECT_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
    </section>
  )
}

function EffectFields({ effect, onChange }: { effect: Effect; onChange: (effect: Effect) => void }): React.JSX.Element {
  const seconds = { displayScale: 0.001, step: 0.1, min: 0 }
  const easing =
    effect.type === 'scale' || effect.type === 'move' ? (
      <label className="field field--inline">
        <span className="field__label">変化</span>
        <select value={effect.easing} onChange={(event) => onChange({ ...effect, easing: event.target.value as typeof effect.easing })}>
          {Object.entries(EASING_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
    ) : null
  switch (effect.type) {
    case 'fade':
      return (
        <div className="field__row field__row--wrap">
          <NumberField label="イン(秒)" value={effect.inMs} {...seconds} onCommit={(inMs) => onChange({ ...effect, inMs })} />
          <NumberField label="アウト(秒)" value={effect.outMs} {...seconds} onCommit={(outMs) => onChange({ ...effect, outMs })} />
        </div>
      )
    case 'scale':
      return (
        <div className="field__row field__row--wrap">
          <NumberField label="始め(%)" value={effect.from} displayScale={100} min={1} step={5} onCommit={(from) => onChange({ ...effect, from })} />
          <NumberField label="終わり(%)" value={effect.to} displayScale={100} min={1} step={5} onCommit={(to) => onChange({ ...effect, to })} />
          <NumberField label="時間(秒)" value={effect.durationMs} {...seconds} onCommit={(durationMs) => onChange({ ...effect, durationMs })} />
          {easing}
        </div>
      )
    case 'move':
      return (
        <div className="field__row field__row--wrap">
          <NumberField label="始めのずれX" value={effect.fromX} onCommit={(fromX) => onChange({ ...effect, fromX })} />
          <NumberField label="始めのずれY" value={effect.fromY} onCommit={(fromY) => onChange({ ...effect, fromY })} />
          <NumberField label="時間(秒)" value={effect.durationMs} {...seconds} onCommit={(durationMs) => onChange({ ...effect, durationMs })} />
          {easing}
        </div>
      )
    case 'shake':
      return (
        <div className="field__row field__row--wrap">
          <NumberField label="大きさ(px)" value={effect.amplitudePx} min={0} onCommit={(amplitudePx) => onChange({ ...effect, amplitudePx })} />
          <NumberField label="速さ(Hz)" value={effect.frequencyHz} min={1} max={60} onCommit={(frequencyHz) => onChange({ ...effect, frequencyHz })} />
          <NumberField label="時間(秒)" value={effect.durationMs} {...seconds} onCommit={(durationMs) => onChange({ ...effect, durationMs })} />
        </div>
      )
  }
}

// ---------------------------------------------------------------- 素材の権利

export function LicenseInspector({ project, assetId, run }: { project: Project; assetId: string; run: Run }): React.JSX.Element | null {
  const asset = project.assets[assetId]
  if (!asset) return null
  const update = (patch: Partial<AssetLicense>): void =>
    run([{ op: 'asset.updateLicense', assetId, license: { ...asset.license, ...patch } }], '素材の権利表記の変更')
  const site = freeSource(asset.license.sourceId)
  const fileName = asset.path.absolute.split(/[\\/]/).at(-1) ?? asset.path.absolute
  return (
    <section data-testid="license-inspector">
      <h3>素材</h3>
      <p className="inspector__mono" title={asset.path.absolute}>
        {assetName(asset)}
      </p>
      {asset.type !== 'video' && (
        <label className="field">
          <span className="field__label">入手元サイト</span>
          <select
            value={asset.license.sourceId ?? ''}
            onChange={(event) => {
              const chosen = freeSource(event.target.value)
              if (chosen) {
                run([{ op: 'asset.updateLicense', assetId, license: licenseFromSource(chosen, fileName) }], '入手元サイトの設定')
              } else {
                const { sourceId: _sourceId, ...rest } = asset.license
                run([{ op: 'asset.updateLicense', assetId, license: rest }], '入手元サイトの設定')
              }
            }}
            data-testid="license-site"
          >
            <option value="">その他・自分で用意したもの</option>
            {FREE_SOURCES.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}({CREDIT_LABELS[source.credit]})
              </option>
            ))}
          </select>
        </label>
      )}
      {site && (
        <div className="license-site" data-testid="license-site-notes">
          <ul>
            {site.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <a href={site.termsUrl} target="_blank" rel="noreferrer">
            {site.name} の利用規約を開く
          </a>
        </div>
      )}
      <label className="field">
        <span className="field__label">入手元</span>
        <input
          type="text"
          key={`source-${asset.license.source}`}
          defaultValue={asset.license.source}
          placeholder="例: 配布ページのURL / 自分で録画"
          onBlur={(event) => {
            if (event.target.value !== asset.license.source) update({ source: event.target.value })
          }}
          data-testid="license-source"
        />
      </label>
      <label className="field__row">
        <input type="checkbox" checked={asset.license.creditRequired} onChange={(event) => update({ creditRequired: event.target.checked })} data-testid="license-credit-required" />
        クレジットが必要
      </label>
      {!asset.license.creditRequired && (
        <label className="field__row">
          <input
            type="checkbox"
            checked={asset.license.creditOptIn === true}
            onChange={(event) => update({ creditOptIn: event.target.checked })}
            data-testid="license-credit-optin"
          />
          必要ではないが、概要欄にクレジットを載せる
        </label>
      )}
      {(asset.license.creditRequired || asset.license.creditOptIn) && (
        <label className="field">
          <span className="field__label">クレジット表記</span>
          <input
            type="text"
            key={`credit-${asset.license.creditText ?? ''}`}
            defaultValue={asset.license.creditText ?? ''}
            placeholder="例: BGM: 〇〇様"
            onBlur={(event) => {
              if (event.target.value !== (asset.license.creditText ?? '')) update({ creditText: event.target.value })
            }}
            data-testid="license-credit-text"
          />
        </label>
      )}
    </section>
  )
}
