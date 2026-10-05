import { nanoid } from 'nanoid'
import { useState } from 'react'

import { makeShortProject } from '@shared/project/canvas'
import { itemEndMs, projectDurationMs } from '@shared/project/queries'

import { api, toAppError } from '../../api'
import { formatMs } from '../../lib/time'
import { useEditorStore } from '../../state/store'
import { Modal } from '../../ui/Modal'
import { NumberField } from '../../ui/NumberField'

/** YouTube のショートの長さの上限(3分)。 */
const SHORT_LIMIT_MS = 180_000

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'ショート'
}

/**
 * 今のプロジェクトの一部から、縦型のショートを別のプロジェクトとして作る(元のプロジェクトは変えない)。
 * 範囲は、選んでいる素材の範囲(無ければ再生位置から60秒)を始めに出す。
 */
export function ShortDialog({ onClose, onError }: { onClose: () => void; onError: (message: string) => void }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const selectedItemIds = useEditorStore((state) => state.selectedItemIds)
  const playheadMs = useEditorStore((state) => state.playheadMs)
  const selected = project.items.filter((item) => selectedItemIds.includes(item.id))
  const total = projectDurationMs(project)
  const [fromMs, setFromMs] = useState(selected.length > 0 ? Math.min(...selected.map((item) => item.startMs)) : Math.min(playheadMs, total))
  const [toMs, setToMs] = useState(selected.length > 0 ? Math.max(...selected.map((item) => itemEndMs(item))) : Math.min(total, playheadMs + 60_000))
  const [layout, setLayout] = useState<'blur' | 'fill'>('blur')
  const [openAfter, setOpenAfter] = useState(true)
  const [busy, setBusy] = useState(false)
  const length = toMs - fromMs

  const create = async (): Promise<void> => {
    if (length <= 0) return
    setBusy(true)
    try {
      const short = makeShortProject(project, { fromMs, toMs, width: 1080, height: 1920, layout, newId: (prefix) => `${prefix}_${nanoid(10)}` })
      const picked = await api.invoke('dialog:pick', { kind: 'saveProject', defaultName: `${sanitize(short.meta.title)}.zsproj` })
      const target = picked?.[0]
      if (!target) return
      await api.invoke('project:write', target, short)
      onClose()
      if (!openAfter) return
      const state = useEditorStore.getState()
      if (state.dirty && !window.confirm('今のプロジェクトに保存していない変更があります。破棄してショートを開きますか?')) return
      await state.openProject(target)
    } catch (error) {
      onError(toAppError(error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="縦型のショートを作る"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            やめる
          </button>
          <button type="button" disabled={busy || length <= 0} onClick={() => void create()} data-testid="short-create">
            作って保存…
          </button>
        </>
      }
    >
      <p className="note">
        このプロジェクトの一部を、縦 1080×1920 の別のプロジェクトにします(元のプロジェクトは変わりません)。ゲームの録画は縦の画面に合わせ、字幕は下の方に、読める文字数で折り返します。
        範囲の途中で切れるセリフは入りません。
      </p>
      <div className="field__row field__row--wrap">
        <NumberField label="始め(秒)" value={fromMs} displayScale={0.001} step={0.5} min={0} max={total / 1000} onCommit={(value) => setFromMs(Math.round(value))} testId="short-from" />
        <NumberField label="終わり(秒)" value={toMs} displayScale={0.001} step={0.5} min={0} max={total / 1000} onCommit={(value) => setToMs(Math.round(value))} testId="short-to" />
        <span className={length > SHORT_LIMIT_MS ? 'status status--warn' : 'note'}>
          長さ {formatMs(Math.max(0, length))}
          {length > SHORT_LIMIT_MS ? '(ショートは3分までです)' : ''}
        </span>
      </div>
      <div className="segmented" role="radiogroup" aria-label="ゲームの録画の置き方">
        <label>
          <input type="radio" name="short-layout" checked={layout === 'blur'} onChange={() => setLayout('blur')} data-testid="short-layout-blur" />
          全体を見せる(上下はぼかした映像)
        </label>
        <label>
          <input type="radio" name="short-layout" checked={layout === 'fill'} onChange={() => setLayout('fill')} data-testid="short-layout-fill" />
          真ん中を切り抜いて画面いっぱい
        </label>
      </div>
      <label className="field__row">
        <input type="checkbox" checked={openAfter} onChange={(event) => setOpenAfter(event.target.checked)} />
        保存したら開く
      </label>
    </Modal>
  )
}
