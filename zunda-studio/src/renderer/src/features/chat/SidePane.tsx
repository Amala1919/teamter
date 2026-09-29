import { useEffect, useState } from 'react'

import { useSettingsStore } from '../../state/settings'
import { useEditorStore } from '../../state/store'
import { InspectorPane } from '../inspector/InspectorPane'
import { LiveLogPane } from '../live/LiveLogPane'
import { ChatPane } from './ChatPane'

type Tab = 'chat' | 'live' | 'inspector'

/**
 * 右の欄。編集チャット・録画中の会話の記録・インスペクタを切り替えて見る。
 * タイムラインやプレビューで素材を選ぶとインスペクタに切り替わる(台本の欄で行を選んだときは切り替えない)。
 * チャットは切り替えても書きかけの文が消えないよう、隠すだけにする。
 */
export function SidePane({ onError }: { onError: (message: string | null) => void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('chat')
  const selectedItemIds = useEditorStore((state) => state.selectedItemIds)
  const selectionSource = useEditorStore((state) => state.selectionSource)
  // 素材を選んだらインスペクタに切り替えるか(設定の「編集」タブで切れる)
  const autoInspector = useSettingsStore((state) => state.settings?.ui.autoInspectorTab !== false)

  useEffect(() => {
    if (autoInspector && selectedItemIds.length > 0 && selectionSource === 'other') setTab('inspector')
  }, [selectedItemIds, selectionSource, autoInspector])

  return (
    <section className="pane pane--side">
      <nav className="tabs side__tabs" role="tablist">
        {(
          [
            ['chat', 'チャット'],
            ['live', 'ライブの記録'],
            ['inspector', 'インスペクタ']
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
            onClick={() => setTab(id)}
            data-testid={`side-tab-${id}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="side__panel" hidden={tab !== 'chat'}>
        <ChatPane />
      </div>
      {tab === 'live' && <LiveLogPane onError={onError} />}
      {tab === 'inspector' && <InspectorPane onError={onError} />}
    </section>
  )
}
