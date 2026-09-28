import { useState } from 'react'

import { useChatStore } from '../../state/ai'
import { useEditorStore } from '../../state/store'
import { Modal } from '../../ui/Modal'

const EXAMPLES = ['驚く場面や怒る場面は表情をはっきり変えて', 'ズームしている間は立ち絵を隠して', 'ゲーム画面を見せる場面では立ち絵を小さくして端に寄せて']

/**
 * 立ち絵をまとめて AI に調整させる。ほかの編集(セリフ・素材・ズーム)が終わってから使う想定。
 * 結果はチャットに提案として出て、変更点を見てから適用する。
 */
export function PortraitAiDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const portraits = useChatStore((state) => state.portraits)
  const [instruction, setInstruction] = useState('')
  const withPortrait = Object.values(project.characters).filter((character) => character.portrait)
  const lines = project.items.filter((item) => item.type === 'voice').length

  return (
    <Modal
      title="立ち絵をAIでまとめて調整"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="button--primary"
          disabled={withPortrait.length === 0}
          onClick={() => {
            const extra = instruction.trim()
            void portraits(extra ? { instruction: extra } : {}, `立ち絵をまとめて調整して${extra ? `(${extra})` : ''}`)
            onClose()
          }}
          data-testid="portrait-ai-start"
        >
          調整を頼む
        </button>
      }
    >
      <div className="settings-section">
        {withPortrait.length === 0 ? (
          <p className="pane__empty">立ち絵のあるキャラクターがいません。キャラクター画面で立ち絵(PSD)を設定してください。</p>
        ) : (
          <>
            <p className="note">
              台本({lines}行)のセリフと、録画・ズームの場面をもとに、表情・登場と退場・位置と大きさ・話し手の強調をまとめて提案させます。
              セリフの文や尺は変えません。提案はチャットに出るので、変更点を見てから適用してください(1回の「元に戻す」で全部戻せます)。
            </p>
            <label className="field">
              <span className="field__label">追加の指示(任意)</span>
              <textarea
                rows={3}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder={EXAMPLES[0]}
                data-testid="portrait-ai-instruction"
              />
            </label>
            <div className="field__row field__row--wrap">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" className="button--small" onClick={() => setInstruction(example)}>
                  {example}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
