import { Modal } from '../../ui/Modal'

/** キーの操作の一覧。ここに足せば一覧にも出る(実際の処理は App・台本の欄・プレビューにある)。 */
export const SHORTCUT_GROUPS: { title: string; items: [keys: string, action: string][] }[] = [
  {
    title: '全体',
    items: [
      ['Ctrl+S', '保存'],
      ['Ctrl+Z / Ctrl+Y', '元に戻す / やり直す'],
      ['Space', '再生・停止'],
      ['F1', 'この一覧を出す']
    ]
  },
  {
    title: '台本',
    items: [
      ['Ctrl+Enter', '次のセリフを追加(2人なら話者が交互)'],
      ['Ctrl+Shift+Enter', '選んでいるセリフへの相方の返答を作る'],
      ['Ctrl+F', '台本の検索・置換(Enter で次へ、Shift+Enter で前へ)']
    ]
  },
  {
    title: 'タイムライン',
    items: [
      ['S', '再生位置で分割'],
      ['F / Shift+F', '再生位置で止めて静止画を挟む / 先を静止画にする'],
      ['Delete / Shift+Delete', '削除 / 削除して詰める'],
      ['Ctrl+C・X・V・D', 'コピー・切り取り・貼り付け・複製'],
      ['Ctrl+A', 'すべて選択'],
      ['Shift+クリック', '選ぶものを足す(選んだものの1つをドラッグすると、まとめて動く)'],
      ['Ctrl+G / Ctrl+Shift+G', '選んだものをグループにする / グループを解く(グループは一緒に選ばれ、一緒に動く)'],
      ['← / →', '1コマ送り(Shift で1秒)'],
      ['↑ / ↓', '前後の編集点へ'],
      ['Home / End', '先頭 / 末尾へ'],
      ['M / Shift+M', '再生位置に目印を置く / 置いてメモを書く'],
      ['Ctrl+← / Ctrl+→', '前 / 次の目印へ'],
      ['1〜9', '効果音のパレットの音を再生位置に置く'],
      ['Ctrl+ホイール(目盛りの上ならホイールだけ)', '拡大・縮小']
    ]
  }
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <Modal title="キーの操作" onClose={onClose}>
      <div className="shortcuts" data-testid="shortcuts">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            <dl className="shortcuts__list">
              {group.items.map(([keys, action]) => (
                <div key={keys} className="shortcuts__row">
                  <dt>
                    <kbd>{keys}</kbd>
                  </dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="note">ほとんどの操作は、タイムライン・プレビュー・台本の右クリックからも選べます。</p>
      </div>
    </Modal>
  )
}
