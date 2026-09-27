import { toAppError } from '../../api'
import { useEditorStore } from '../../state/store'

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
        <button type="button" onClick={() => newProject()}>
          新規
        </button>
        <button type="button" onClick={() => run(openProject)}>
          開く
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
        <button type="button" onClick={onOpenSettings} data-testid="open-settings">
          設定
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
    </header>
  )
}
