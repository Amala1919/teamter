import { useEffect, useState } from 'react'

import type { VoiceParams } from '@shared/project/types'

export const VOICE_PARAM_FIELDS: { key: keyof VoiceParams; label: string; min: number; max: number; step: number }[] = [
  { key: 'speedScale', label: '話速', min: 0.5, max: 2, step: 0.01 },
  { key: 'pitchScale', label: '音高', min: -0.15, max: 0.15, step: 0.01 },
  { key: 'intonationScale', label: '抑揚', min: 0, max: 2, step: 0.01 },
  { key: 'volumeScale', label: '音量', min: 0, max: 2, step: 0.01 },
  { key: 'prePhonemeLength', label: '前の無音(秒)', min: 0, max: 1.5, step: 0.01 },
  { key: 'postPhonemeLength', label: '後の無音(秒)', min: 0, max: 1.5, step: 0.01 }
]

interface VoiceParamsEditorProps {
  values: VoiceParams
  /** 上書きされている項目(インスペクタで「既定に戻す」を出すため)。 */
  overridden?: Partial<Record<keyof VoiceParams, boolean>>
  onCommit: (params: Partial<VoiceParams>) => void
  onReset?: (key: keyof VoiceParams) => void
}

/**
 * 発話パラメータのスライダー。ドラッグ中は再合成せず、離した時点で1回だけ確定する。
 * ドラッグのたびに合成を走らせると、エンジンに大量の要求が溜まるため。
 */
export function VoiceParamsEditor({ values, overridden, onCommit, onReset }: VoiceParamsEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState(values)
  useEffect(() => setDraft(values), [values])

  return (
    <div className="voice-params">
      {VOICE_PARAM_FIELDS.map((field) => (
        <label key={field.key} className="field voice-params__row">
          <span className="field__label">{field.label}</span>
          <span className="field__row">
            <input
              type="range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={draft[field.key]}
              onChange={(event) => setDraft({ ...draft, [field.key]: Number(event.target.value) })}
              onPointerUp={() => {
                if (draft[field.key] !== values[field.key]) onCommit({ [field.key]: draft[field.key] })
              }}
              onKeyUp={() => {
                if (draft[field.key] !== values[field.key]) onCommit({ [field.key]: draft[field.key] })
              }}
              aria-label={field.label}
              data-testid={`voice-${field.key}`}
            />
            <span className="voice-params__value">{draft[field.key].toFixed(2)}</span>
            {onReset && overridden?.[field.key] && (
              <button type="button" className="button--small" onClick={() => onReset(field.key)}>
                既定に戻す
              </button>
            )}
          </span>
        </label>
      ))}
    </div>
  )
}
