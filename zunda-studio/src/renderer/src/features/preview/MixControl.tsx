import { useEffect, useRef, useState } from 'react'

import type { AudioMix } from '@shared/project/types'

import { player } from '../../playback/player'
import { useEditorStore } from '../../state/store'

type MixKey = keyof AudioMix

const SLIDERS: { key: MixKey; label: string }[] = [
  { key: 'master', label: '全体' },
  { key: 'voice', label: 'セリフ' },
  { key: 'music', label: 'BGM・効果音' },
  { key: 'video', label: '動画の音' }
]

/** 音量のつまみの上限(%)。 */
const MAX_PERCENT = 200

/**
 * 全体の音量と、音の種類ごとの音量(プレビューと書き出しの両方に掛かる。取り消せる)。
 * プレビューの下の「🔊」から開く。
 */
export function MixControl({ onError }: { onError: (message: string) => void }): React.JSX.Element {
  const mix = useEditorStore((state) => state.project.mix)
  const dispatch = useEditorStore((state) => state.dispatch)
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const master = Math.round((mix?.master ?? 1) * 100)
  const changed = SLIDERS.some(({ key }) => (mix?.[key] ?? 1) !== 1)

  // 外をクリックするか Esc で閉じる
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent): void => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const commit = (patch: { [K in MixKey]?: number | null }, label: string): void => {
    const result = dispatch([{ op: 'project.setMix', ...patch }], label)
    if (!result.ok) onError(result.message)
    // 再生中なら、新しい音量で鳴らし直す
    else player.restartIfPlaying()
  }

  return (
    <div className="mix-control" ref={panelRef}>
      <button
        type="button"
        className={changed ? 'button--small button--active' : 'button--small'}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="全体の音量と、セリフ・BGM・動画の音の大きさ"
        data-testid="mix-toggle"
      >
        {master === 0 ? '🔇' : '🔊'} {master}%
      </button>
      {open && (
        <div className="mix-control__panel" role="dialog" aria-label="音量" data-testid="mix-panel">
          {SLIDERS.map(({ key, label }) => (
            <MixSlider
              key={key}
              label={label}
              percent={Math.round((mix?.[key] ?? 1) * 100)}
              onCommit={(percent) => commit({ [key]: percent / 100 }, `音量(${label})`)}
              testId={`mix-${key}`}
            />
          ))}
          <p className="note">プレビューと書き出しの両方に掛かります。100% を超えると音が割れることがあります。</p>
          <button
            type="button"
            className="button--small"
            disabled={!changed}
            onClick={() => commit({ master: null, voice: null, music: null, video: null }, '音量を100%に戻す')}
            data-testid="mix-reset"
          >
            すべて100%に戻す
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * 音量のつまみ。動かしている間は数字だけ変え、離したとき(change)に1回だけ反映する(取り消しを1回にするため)。
 */
function MixSlider({ label, percent, onCommit, testId }: { label: string; percent: number; onCommit: (percent: number) => void; testId: string }): React.JSX.Element {
  const [draft, setDraft] = useState(percent)
  const ref = useRef<HTMLInputElement>(null)
  const commit = useRef(onCommit)
  commit.current = onCommit
  useEffect(() => setDraft(percent), [percent])
  useEffect(() => {
    const input = ref.current
    if (!input) return
    const onChange = (): void => {
      const value = Number(input.value)
      if (Number.isFinite(value) && value !== percent) commit.current(value)
    }
    input.addEventListener('change', onChange)
    return () => input.removeEventListener('change', onChange)
  }, [percent])
  return (
    <label className="mix-control__row">
      <span className="mix-control__label">{label}</span>
      <input
        ref={ref}
        type="range"
        min={0}
        max={MAX_PERCENT}
        step={5}
        value={draft}
        onChange={(event) => setDraft(Number(event.target.value))}
        aria-label={`${label}の音量`}
        data-testid={testId}
      />
      <span className="mix-control__value" data-testid={`${testId}-value`}>
        {draft}%
      </span>
    </label>
  )
}
