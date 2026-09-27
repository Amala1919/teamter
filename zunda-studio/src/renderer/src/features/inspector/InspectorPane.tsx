import { findItem, itemEndMs } from '@shared/project/queries'

import { formatMs } from '../../lib/time'
import { useEditorStore } from '../../state/store'

export function InspectorPane(): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const selectedItemIds = useEditorStore((state) => state.selectedItemIds)
  const firstId = selectedItemIds[0]
  const item = firstId === undefined ? undefined : findItem(project, firstId)

  return (
    <section className="pane pane--inspector">
      <header className="pane__header">
        <h2>インスペクタ</h2>
      </header>
      {!item ? (
        <p className="pane__empty">アイテムを選択すると設定が表示される。</p>
      ) : (
        <dl className="inspector__list">
          <dt>種類</dt>
          <dd>{item.type}</dd>
          <dt>ID</dt>
          <dd className="inspector__mono">{item.id}</dd>
          <dt>区間</dt>
          <dd>
            {formatMs(item.startMs)} – {formatMs(itemEndMs(item))}({item.durationMs}ms)
          </dd>
          <dt>レイヤー</dt>
          <dd>{project.layers.find((layer) => layer.id === item.layerId)?.name ?? item.layerId}</dd>
          {item.type === 'voice' && (
            <>
              <dt>話者</dt>
              <dd>{project.characters[item.characterId]?.name ?? item.characterId}</dd>
              <dt>表情</dt>
              <dd>{item.expressionId ?? '既定'}</dd>
              <dt>合成</dt>
              <dd>{item.synthesis === null ? '未合成' : '合成済み'}</dd>
            </>
          )}
        </dl>
      )}
      <p className="note">各プロパティの編集UIは対応するフェーズで追加する。</p>
    </section>
  )
}
