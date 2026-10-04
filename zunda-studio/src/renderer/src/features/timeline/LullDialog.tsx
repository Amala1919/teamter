import { useEffect, useMemo, useState } from 'react'

import { DEFAULT_LULL_OPTIONS, lullsForItem, MOTION_LEVELS, type LullOptions, type MediaActivity } from '@shared/media/activity'
import type { Ms, VideoItem } from '@shared/project/types'

import { api, toAppError } from '../../api'
import { formatMs } from '../../lib/time'
import { useEditorStore } from '../../state/store'
import { Modal } from '../../ui/Modal'

const RATES = [2, 4, 8, 16]
/** 選んだ早送りの速さを覚えておく(次に開いたときの既定)。 */
const RATE_KEY = 'zs.lullRate'

function savedRate(): number {
  try {
    const value = Number(window.localStorage.getItem(RATE_KEY))
    return RATES.includes(value) ? value : 4
  } catch {
    return 4
  }
}

/**
 * 待ち時間(相手のターン・ロード・考え中など)を探して、まとめて切り取る・早送りにする。
 * 動画の動き(と、選べば音)が少ないところを候補にし、選んだものだけを1回の操作で詰める(1回で取り消せる)。
 */
export function LullDialog({ item, onClose, onError }: { item: VideoItem; onClose: () => void; onError: (message: string) => void }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const dispatch = useEditorStore((state) => state.dispatch)
  const asset = project.assets[item.assetId]
  const [activity, setActivity] = useState<MediaActivity | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [options, setOptions] = useState<LullOptions>(DEFAULT_LULL_OPTIONS)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'cut' | 'speed'>('speed')
  const [rate, setRate] = useState(savedRate)
  const [label, setLabel] = useState(true)

  useEffect(() => {
    if (!asset) return
    let cancelled = false
    api
      .invoke('media:activity', asset.path.absolute)
      .then((result) => {
        if (!cancelled) setActivity(result)
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(toAppError(error).message)
      })
    return () => {
      cancelled = true
    }
  }, [asset])

  const lulls = useMemo(() => (activity ? lullsForItem(item, activity, options) : []), [activity, item, options])
  const key = ([from, to]: [Ms, Ms]): string => `${from}-${to}`
  const chosen = lulls.filter((range) => !excluded.has(key(range)))
  const total = chosen.reduce((sum, [from, to]) => sum + (to - from), 0)
  const saved = mode === 'cut' ? total : total - total / rate
  const maxRate = 16 / item.playbackRate

  const apply = (): void => {
    if (chosen.length === 0) return
    try {
      window.localStorage.setItem(RATE_KEY, String(rate))
    } catch {
      // 覚えておけなくても続ける。
    }
    const result = dispatch(
      [{ op: 'video.condense', itemId: item.id, ranges: chosen.map(([fromMs, toMs]) => ({ fromMs, toMs })), mode, rate, label, ripple: true }],
      mode === 'cut' ? `待ち時間を切り取る(${chosen.length}か所)` : `待ち時間を早送りにする(${chosen.length}か所)`
    )
    if (!result.ok) {
      onError(result.message)
      return
    }
    onClose()
  }

  return (
    <Modal
      title="待ち時間を探して詰める"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="note">
            {chosen.length}か所・合計 {formatMs(total)} → {formatMs(saved)} 短くなります
          </span>
          <button type="button" onClick={onClose}>
            やめる
          </button>
          <button type="button" disabled={chosen.length === 0} onClick={apply} data-testid="lull-apply">
            {mode === 'cut' ? '切り取って後ろを詰める' : `${rate}倍で早送りにする`}
          </button>
        </>
      }
    >
      <p className="note">
        画面の動きが少ないところ(相手のターン・ロード・考え中など)を探します。選んだ区間だけを、切り取るか早送りにして、後ろの素材を前へ詰めます(1回の「元に戻す」で戻せます)。
        セリフを入れる前に使うのがおすすめです(区間の中に置いたセリフは動きません)。
      </p>
      <div className="field__row field__row--wrap">
        <label className="field__row">
          <input type="checkbox" checked={options.useMotion} onChange={(event) => setOptions({ ...options, useMotion: event.target.checked })} />
          画面の動きが
        </label>
        <select
          value={options.motionBelow}
          disabled={!options.useMotion}
          onChange={(event) => setOptions({ ...options, motionBelow: Number(event.target.value) })}
          data-testid="lull-motion"
        >
          {MOTION_LEVELS.map((level) => (
            <option key={level.value} value={level.value}>
              {level.label}
            </option>
          ))}
        </select>
        <label className="field__row">
          <input type="checkbox" checked={options.useSound} onChange={(event) => setOptions({ ...options, useSound: event.target.checked })} data-testid="lull-use-sound" />
          音も小さい
        </label>
        <label className="field field--inline">
          <span className="field__label">これより長い(秒)</span>
          <input
            type="number"
            min={1}
            max={120}
            step={1}
            value={options.minMs / 1000}
            onChange={(event) => setOptions({ ...options, minMs: Math.max(1000, Number(event.target.value) * 1000) })}
            data-testid="lull-min"
          />
        </label>
      </div>
      <div className="segmented" role="radiogroup" aria-label="詰め方">
        <label>
          <input type="radio" name="lull-mode" checked={mode === 'speed'} onChange={() => setMode('speed')} data-testid="lull-mode-speed" />
          早送りにする
        </label>
        <label>
          <input type="radio" name="lull-mode" checked={mode === 'cut'} onChange={() => setMode('cut')} data-testid="lull-mode-cut" />
          切り取る
        </label>
        {mode === 'speed' && (
          <>
            <select value={rate} onChange={(event) => setRate(Number(event.target.value))} data-testid="lull-rate">
              {RATES.filter((value) => value <= maxRate).map((value) => (
                <option key={value} value={value}>
                  {value}倍
                </option>
              ))}
            </select>
            <label>
              <input type="checkbox" checked={label} onChange={(event) => setLabel(event.target.checked)} data-testid="lull-label" />
              「▶▶ ×{rate}」を出す
            </label>
          </>
        )}
      </div>

      {failure && <p className="status status--error">{failure}</p>}
      {!activity && !failure && <p className="status" data-testid="lull-analyzing">動画の動きを調べています…(長い録画では少しかかります。2回目からはすぐ出ます)</p>}
      {activity && lulls.length === 0 && <p className="note" data-testid="lull-empty">待ち時間は見つかりませんでした。「画面の動きが」の目安を緩めるか、長さを短くしてみてください。</p>}
      {lulls.length > 0 && (
        <ul className="lull-list" data-testid="lull-list">
          {lulls.map((range) => {
            const [from, to] = range
            const checked = !excluded.has(key(range))
            return (
              <li key={key(range)} className="lull-list__item" data-testid="lull-item">
                <label className="field__row">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = new Set(excluded)
                      if (event.target.checked) next.delete(key(range))
                      else next.add(key(range))
                      setExcluded(next)
                    }}
                  />
                  {formatMs(from)} – {formatMs(to)}({((to - from) / 1000).toFixed(1)}秒)
                </label>
                <button type="button" className="button--small" onClick={() => setPlayhead(from)}>
                  見る
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
