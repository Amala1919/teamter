import { useState } from 'react'

import { formatModelRef } from '@shared/ai/types'
import { entryTimelineMs } from '@shared/live/timing'
import { MIN_CHAPTERS, normalizeChapters, youtubeTime } from '@shared/project/chapters'
import { projectDurationMs } from '@shared/project/queries'
import type { Chapter, Project, PublishInfo } from '@shared/project/types'

import { api, toAppError } from '../../api'
import { useSettingsStore } from '../../state/settings'
import { useEditorStore } from '../../state/store'

const EMPTY: PublishInfo = { titles: [], description: '', chapters: [], generatedBy: null }

/** 「1:23」「1:02:03」を秒にする。読めなければ null。 */
function parseTime(text: string): number | null {
  const parts = text.trim().split(':').map(Number)
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null
  return parts.reduce((total, part) => total * 60 + part, 0) * 1000
}

/** ライブで打った目印からチャプターの下書きを作る。 */
function chaptersFromMarkers(project: Project): Chapter[] {
  const chapters: Chapter[] = [{ atMs: 0, title: 'オープニング' }]
  for (const session of Object.values(project.liveSessions)) {
    for (const entry of session.entries) {
      if (!entry.bookmarked) continue
      const atMs = entryTimelineMs(project, session, entry)
      if (atMs !== null && entry.text !== '目印') chapters.push({ atMs, title: entry.text })
    }
  }
  return normalizeChapters(chapters)
}

/**
 * 投稿用の文(REQUIREMENTS.md A-6, E-4)。AI に下書きを作らせ、タイトル案から選び、概要欄とチャプターを直す。
 * 投稿そのものは行わない(L-5)。
 */
export function PublishSection({ onError }: { onError: (message: string | null) => void }): React.JSX.Element {
  const project = useEditorStore((state) => state.project)
  const dispatch = useEditorStore((state) => state.dispatch)
  const editorModel = useSettingsStore((state) => state.settings?.ai.roles.editor ?? null)
  const [loading, setLoading] = useState(false)
  const publish = project.publish ?? EMPTY
  const totalMs = projectDurationMs(project)

  const save = (next: PublishInfo, label: string): void => {
    const result = dispatch([{ op: 'publish.set', publish: next }], label)
    onError(result.ok ? null : result.message)
  }

  const generate = async (): Promise<void> => {
    setLoading(true)
    onError(null)
    try {
      const drafted = await api.invoke('ai:publish', project)
      save(drafted, '投稿文の下書き')
    } catch (error) {
      const appError = toAppError(error)
      onError(`${appError.message}${appError.guidance ? `。${appError.guidance}` : ''}`)
    } finally {
      setLoading(false)
    }
  }

  const updateChapter = (index: number, patch: Partial<Chapter>): void =>
    save({ ...publish, chapters: publish.chapters.map((chapter, position) => (position === index ? { ...chapter, ...patch } : chapter)) }, 'チャプターの変更')

  return (
    <section data-testid="publish-section">
      <h3>投稿文(タイトル・概要欄・チャプター)</h3>
      <div className="field__row field__row--wrap">
        <button type="button" className="button--small" disabled={!editorModel || loading} onClick={() => void generate()} data-testid="publish-generate">
          {loading ? '考え中…' : 'AIで下書きを作る'}
        </button>
        <button
          type="button"
          className="button--small"
          onClick={() => save({ ...publish, chapters: chaptersFromMarkers(project) }, 'チャプターを目印から作る')}
          disabled={Object.keys(project.liveSessions).length === 0}
          title="ライブで打った目印の位置にチャプターを置きます"
        >
          目印からチャプターを作る
        </button>
        {!editorModel && <span className="status status--warn">編集AIが未設定です</span>}
        {publish.generatedBy && <span className="note">{formatModelRef(publish.generatedBy)} の下書き</span>}
      </div>

      {publish.titles.length > 0 && (
        <div className="field">
          <span className="field__label">タイトル案(選ぶとプロジェクト名になります)</span>
          <ul className="publish__titles">
            {publish.titles.map((title) => (
              <li key={title}>
                <button
                  type="button"
                  className={title === project.meta.title ? 'chip chip--active' : 'chip'}
                  onClick={() => dispatch([{ op: 'project.setMeta', title }], 'タイトルの変更')}
                  data-testid="publish-title"
                >
                  {title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="field">
        <span className="field__label">概要欄の本文</span>
        <textarea
          rows={5}
          key={publish.description}
          defaultValue={publish.description}
          placeholder="動画の紹介文"
          onBlur={(event) => {
            if (event.target.value !== publish.description) save({ ...publish, description: event.target.value }, '概要欄の変更')
          }}
          data-testid="publish-description"
        />
      </label>

      <div className="field">
        <span className="field__label">チャプター</span>
        {publish.chapters.length > 0 && publish.chapters.length < MIN_CHAPTERS && (
          <p className="status status--warn">YouTube のチャプターは{MIN_CHAPTERS}つ以上必要です。</p>
        )}
        <ol className="publish__chapters">
          {publish.chapters.map((chapter, index) => (
            <li key={`${index}-${chapter.atMs}`} data-testid="publish-chapter">
              <input
                type="text"
                className="publish__time"
                defaultValue={youtubeTime(chapter.atMs, totalMs)}
                disabled={index === 0}
                onBlur={(event) => {
                  const atMs = parseTime(event.target.value)
                  if (atMs === null) event.target.value = youtubeTime(chapter.atMs, totalMs)
                  else if (atMs !== chapter.atMs) updateChapter(index, { atMs })
                }}
                aria-label="時刻"
              />
              <input
                type="text"
                defaultValue={chapter.title}
                onBlur={(event) => {
                  if (event.target.value.trim() !== '' && event.target.value !== chapter.title) updateChapter(index, { title: event.target.value })
                }}
                aria-label="チャプターの題"
              />
              <button
                type="button"
                className="button--small"
                onClick={() => save({ ...publish, chapters: publish.chapters.filter((_, position) => position !== index) }, 'チャプターの削除')}
              >
                削除
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="button--small"
          onClick={() =>
            save(
              { ...publish, chapters: [...publish.chapters, { atMs: publish.chapters.length === 0 ? 0 : useEditorStore.getState().playheadMs, title: '新しいチャプター' }] },
              'チャプターの追加'
            )
          }
          data-testid="publish-add-chapter"
        >
          再生位置にチャプターを足す
        </button>
      </div>
    </section>
  )
}
