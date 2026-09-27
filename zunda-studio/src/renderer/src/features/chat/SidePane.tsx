import { useState } from 'react'

import { LiveLogPane } from '../live/LiveLogPane'
import { ChatPane } from './ChatPane'

type Tab = 'chat' | 'live'

/** 右の欄。編集チャットと、録画中の会話の記録を切り替えて見る。 */
export function SidePane({ onError }: { onError: (message: string | null) => void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('chat')
  return (
    <section className="pane pane--side">
      <nav className="tabs side__tabs" role="tablist">
        {(
          [
            ['chat', 'チャット'],
            ['live', 'ライブの記録']
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
      {tab === 'chat' ? <ChatPane /> : <LiveLogPane onError={onError} />}
    </section>
  )
}
