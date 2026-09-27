import { useState } from 'react'

import { useChatStore } from '../../state/ai'
import { assetName } from '../../state/media'
import { useEditorStore } from '../../state/store'
import { Modal } from '../../ui/Modal'

const TARGETS = [3, 5, 8, 10, 15]

/**
 * 録画から下書きを作る(REQUIREMENTS.md A-5)。録画を解析して使えそうな区間を選び、
 * ライブの記録と企画メモを材料に、区間の並べ方と掛け合いを編集AIに作らせる。結果はチャットに提案として出る。
 */
export function DraftDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const draft = useChatStore((state) => state.draft)
  const videos = Object.entries(project.assets).filter(([, asset]) => asset.type === 'video')
  const [assetId, setAssetId] = useState(videos[0]?.[0] ?? '')
  const [minutes, setMinutes] = useState(5)
  const [instruction, setInstruction] = useState('')
  const sessions = Object.values(project.liveSessions).filter((session) => !session.recordingAssetId || session.recordingAssetId === assetId)

  return (
    <Modal
      title="録画から下書きを作る"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="button--primary"
          disabled={!assetId}
          onClick={() => {
            const name = assetName(project.assets[assetId])
            void draft(
              { recordingAssetId: assetId, targetMs: minutes * 60_000, ...(instruction.trim() ? { instruction: instruction.trim() } : {}) },
              `録画「${name}」から${minutes}分くらいの下書きを作って${instruction.trim() ? `(${instruction.trim()})` : ''}`
            )
            onClose()
          }}
          data-testid="draft-start"
        >
          作る
        </button>
      }
    >
      {videos.length === 0 ? (
        <p className="pane__empty">先に「素材を追加」でゲームの録画を取り込んでください。</p>
      ) : (
        <div className="settings-section">
          <p className="note">
            録画の場面の切り替わり・盛り上がり・ライブの目印と会話から使えそうな区間を選び、つないで掛け合いを乗せます。長い録画は解析に数分かかります。できた下書きはチャットに出るので、変更点を見てから適用してください。
          </p>
          <label className="field">
            <span className="field__label">録画</span>
            <select value={assetId} onChange={(event) => setAssetId(event.target.value)} data-testid="draft-recording">
              {videos.map(([id, asset]) => (
                <option key={id} value={id}>
                  {assetName(asset)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">目安の長さ</span>
            <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} data-testid="draft-minutes">
              {TARGETS.map((value) => (
                <option key={value} value={value}>
                  {value}分
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">指示(任意)</span>
            <textarea rows={3} value={instruction} placeholder="例: ボス戦を中心に。最初に今日の目標を話す" onChange={(event) => setInstruction(event.target.value)} />
          </label>
          <p className="note" data-testid="draft-sessions">
            使うライブの記録: {sessions.length > 0 ? `${sessions.length}件(${sessions.reduce((sum, session) => sum + session.entries.length, 0)}発言)` : 'なし(録画の解析だけで作ります)'}
          </p>
        </div>
      )}
    </Modal>
  )
}
