import { formatModelRef } from '@shared/ai/types'

import { useSettingsStore } from '../../state/settings'
import { useEditorStore } from '../../state/store'
import { ModelPicker } from '../settings/ModelPicker'

interface CohostAiBarProps {
  onError: (message: string | null) => void
}

/**
 * この動画で相方を演じるAI(「中の人」)の切り替え。
 * 切り替えはコマンドとして記録するので undo でき、プロジェクトに保存される(AI-4)。
 */
export function CohostAiBar({ onError }: CohostAiBarProps): React.JSX.Element {
  const projectModel = useEditorStore((state) => state.project.ai.conversation)
  const dispatch = useEditorStore((state) => state.dispatch)
  const defaultModel = useSettingsStore((state) => state.settings?.ai.roles.conversation ?? null)

  const effective = projectModel ?? defaultModel

  return (
    <div className="cohost-bar" data-testid="cohost-bar">
      <span className="cohost-bar__label">相方の中の人</span>
      <ModelPicker
        value={projectModel}
        inheritLabel={defaultModel ? `既定値(${formatModelRef(defaultModel)})` : '既定値(未設定)'}
        onChange={(model) => {
          if (model !== null && model.model === '') return
          const result = dispatch([{ op: 'project.setConversationAi', model }], '相方の中の人の変更')
          onError(result.ok ? null : result.message)
        }}
        testId="cohost-model"
      />
      {!effective && <span className="status status--warn">会話AIが未設定です(設定 → AI)</span>}
    </div>
  )
}
