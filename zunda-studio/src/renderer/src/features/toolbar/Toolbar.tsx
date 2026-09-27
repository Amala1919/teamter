import { useEditorStore } from '../../state/store'

interface ToolbarProps {
  onError: (message: string | null) => void
}

export function Toolbar({ onError }: ToolbarProps): React.JSX.Element {
  const title = useEditorStore((state) => state.project.meta.title)
  const dirty = useEditorStore((state) => state.dirty)
  const filePath = useEditorStore((state) => state.filePath)
  const canUndo = useEditorStore((state) => state.undoStack.length > 0)
  const canRedo = useEditorStore((state) => state.redoStack.length > 0)
  const undoLabel = useEditorStore((state) => state.undoStack.at(-1)?.label)
  const { newProject, openProject, saveProject, undo, redo, dispatch } = useEditorStore.getState()

  const run = (action: () => Promise<void>): void => {
    onError(null)
    action().catch((error: unknown) => onError(String(error)))
  }

  const rename = (): void => {
    const next = window.prompt('プロジェクト名', title)
    if (next === null || next.trim() === '') return
    const result = dispatch([{ op: 'project.setMeta', title: next.trim() }], 'プロジェクト名の変更')
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

      <div className="toolbar__title">
        <button type="button" className="linklike" onClick={rename}>
          {title}
        </button>
        {dirty && <span className="toolbar__dirty" title="未保存の変更があります" />}
        <span className="toolbar__path">{filePath ?? '未保存'}</span>
      </div>
    </header>
  )
}
