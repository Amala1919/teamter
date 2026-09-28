import { useState } from 'react'

import { FREE_SOURCES, FREE_SOURCES_CHECKED_AT, type FreeSource, type FreeSourceKind } from '@shared/media/free-sources'

import { Modal } from '../../ui/Modal'

export const CREDIT_LABELS: Record<FreeSource['credit'], string> = {
  required: 'クレジット必要',
  optional: 'クレジット任意',
  'per-item': '素材ごとに違う'
}

type Filter = 'all' | FreeSourceKind | 'epic'

/**
 * ゆっくり・ずんだもん実況でよく使われるフリー BGM・効果音のサイト一覧。
 * 素材はここから各サイトで入手して取り込む(再配布が禁じられているため、アプリには同梱しない)。
 */
export function FreeSourcesDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
  const shown = FREE_SOURCES.filter((source) =>
    filter === 'all' ? true : filter === 'epic' ? source.epic === true : source.kinds.includes(filter)
  )
  return (
    <Modal title="フリー BGM・効果音のサイト" onClose={onClose} wide>
      <p className="note">
        ゆっくり実況・ずんだもん実況でよく使われるフリー素材のサイトです。気に入った曲・音を各サイトから入手して「素材を追加」で取り込み、
        インスペクタの「入手元サイト」でサイトを選ぶと、クレジットが概要欄の下書きに自動で入ります(魔王魂などはファイル名から自動で判定します)。
        素材そのものは、どのサイトも再配布を禁じているためアプリには入っていません。利用条件は {FREE_SOURCES_CHECKED_AT} 時点の控えなので、
        使う前に各サイトの規約を確認してください。
      </p>
      <div className="segmented" role="radiogroup" aria-label="絞り込み">
        {(
          [
            ['all', 'すべて'],
            ['bgm', 'BGM'],
            ['se', '効果音'],
            ['epic', '戦争・歴史もの向き(HoI4 など)']
          ] as const
        ).map(([value, label]) => (
          <label key={value}>
            <input type="radio" name="free-source-filter" checked={filter === value} onChange={() => setFilter(value)} data-testid={`free-source-filter-${value}`} />
            {label}
          </label>
        ))}
      </div>
      <ul className="free-sources" data-testid="free-sources">
        {shown.map((source) => (
          <li key={source.id} className="free-sources__item" data-testid="free-source">
            <div className="free-sources__header">
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.name}
              </a>
              <span className="free-sources__kinds">{source.kinds.map((kind) => (kind === 'bgm' ? 'BGM' : '効果音')).join('・')}</span>
              <span className={`badge badge--${source.credit}`}>{CREDIT_LABELS[source.credit]}</span>
              <a className="free-sources__terms" href={source.termsUrl} target="_blank" rel="noreferrer">
                利用規約
              </a>
            </div>
            <div className="free-sources__genres">{source.genres.join(' / ')}</div>
            <ul className="free-sources__notes">
              {source.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <div className="free-sources__credit">
              表記の例: <code>{source.creditText.replace('{title}', '曲名')}</code>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
