import { useEffect, useState } from 'react'

import { toAppError } from '../../api'
import { useSettingsStore } from '../../state/settings'
import { useEditorStore } from '../../state/store'
import { openMenuAt, type MenuEntry } from '../../ui/ContextMenu'
import { ExportDialog } from '../export/ExportDialog'
import { ShortcutsDialog } from '../help/ShortcutsDialog'
import { ShortDialog } from './ShortDialog'

/** 設定を読み込む前の空の一覧(毎回新しい配列を返すと、描画が止まらなくなるため同じものを使う)。 */
const NO_RECENT: string[] = []

interface ToolbarProps {
  onError: (message: string | null) => void
  onOpenSettings: () => void
}

export function Toolbar({ onError, onOpenSettings }: ToolbarProps): React.JSX.Element {
  const title = useEditorStore((state) => state.project.meta.title)
  const dirty = useEditorStore((state) => state.dirty)
  const filePath = useEditorStore((state) => state.filePath)
  const canUndo = useEditorStore((state) => state.undoStack.length > 0)
  const canRedo = useEditorStore((state) => state.redoStack.length > 0)
  const undoLabel = useEditorStore((state) => state.undoStack.at(-1)?.label)
  const { newProject, openProject, saveProject, undo, redo, dispatch } = useEditorStore.getState()
  const [exportOpen, setExportOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [shortOpen, setShortOpen] = useState(false)
  // F1: キーの操作の一覧
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'F1') return
      event.preventDefault()
      setShortcutsOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const recentProjects = useSettingsStore((state) => state.settings?.recentProjects ?? NO_RECENT)

  /** 保存していない変更があれば、捨ててよいか確かめる。 */
  const confirmDiscard = (): boolean =>
    !useEditorStore.getState().dirty || window.confirm('保存していない変更があります。破棄して進みますか?')

  const run = (action: () => Promise<void>): void => {
    onError(null)
    action().catch((error: unknown) => {
      const appError = toAppError(error)
      onError(`${appError.message}。${appError.guidance}`)
    })
  }

  // Electron では window.prompt が使えないため、その場で編集する入力欄にする。
  const rename = (next: string): void => {
    const trimmed = next.trim()
    if (trimmed === '' || trimmed === title) return
    const result = dispatch([{ op: 'project.setMeta', title: trimmed }], 'プロジェクト名の変更')
    if (!result.ok) onError(result.message)
  }

  return (
    <header className="toolbar">
      <div className="toolbar__group">
        <button type="button" onClick={() => confirmDiscard() && newProject()}>
          新規
        </button>
        <button type="button" onClick={() => confirmDiscard() && run(() => openProject())}>
          開く
        </button>
        <button
          type="button"
          className="toolbar__recent"
          disabled={recentProjects.length === 0}
          title="最近開いたプロジェクト"
          aria-label="最近開いたプロジェクト"
          onClick={(event) => {
            const entries: MenuEntry[] = recentProjects.map((path, index) => ({
              label: recentLabel(path),
              shortcut: parentFolder(path),
              checked: path === filePath,
              onSelect: () => confirmDiscard() && run(() => openProject(path)),
              testId: `recent-project-${index}`
            }))
            const rect = event.currentTarget.getBoundingClientRect()
            event.stopPropagation()
            openMenuAt(rect.left, rect.bottom + 2, entries)
          }}
          data-testid="open-recent"
        >
          最近 ▾
        </button>
        <button type="button" onClick={() => run(() => saveProject())}>
          保存
        </button>
        <button type="button" onClick={() => run(() => saveProject({ saveAs: true }))}>
          名前を付けて保存
        </button>
      </div>

      <div className="toolbar__group">
        <button type="button" onClick={undo} disabled={!canUndo} title={undoLabel}>
          元に戻す
        </button>
        <button type="button" onClick={redo} disabled={!canRedo}>
          やり直す
        </button>
      </div>

      <div className="toolbar__group">
        <button type="button" onClick={() => setExportOpen(true)} data-testid="open-export">
          書き出し
        </button>
        <button type="button" onClick={() => setShortOpen(true)} title="このプロジェクトの一部から、縦型のショートを別に作る" data-testid="open-short">
          ショートを作る
        </button>
        <button type="button" onClick={onOpenSettings} data-testid="open-settings">
          設定
        </button>
        <button type="button" onClick={() => setShortcutsOpen(true)} title="キーの操作の一覧(F1)" aria-label="キーの操作の一覧" data-testid="open-shortcuts">
          ?
        </button>
      </div>

      <div className="toolbar__title">
        <input
          key={title}
          className="toolbar__titleInput"
          defaultValue={title}
          aria-label="プロジェクト名"
          onBlur={(event) => rename(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        {dirty && <span className="toolbar__dirty" title="未保存の変更があります" />}
        <span className="toolbar__path">{filePath ?? '未保存'}</span>
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {shortOpen && <ShortDialog onClose={() => setShortOpen(false)} onError={(message) => onError(message)} />}
    </header>
  )
}

/** ファイル名(拡張子なし)。 */
function recentLabel(path: string): string {
  const name = path.split(/[\\/]/).at(-1) ?? path
  return name.replace(/\.zsproj$/i, '')
}

/** 置き場所のフォルダ名(同じ名前のプロジェクトを見分けるため)。 */
function parentFolder(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts.at(-2) ?? ''
}
