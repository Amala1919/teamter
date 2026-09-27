import { useEffect, useState } from 'react'

import { ChatPane } from './features/chat/ChatPane'
import { InspectorPane } from './features/inspector/InspectorPane'
import { PreviewPane } from './features/preview/PreviewPane'
import { ScriptPane } from './features/script/ScriptPane'
import { TimelinePane } from './features/timeline/TimelinePane'
import { Toolbar } from './features/toolbar/Toolbar'
import { useEditorStore } from './state/store'

export function App(): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const saveProject = useEditorStore((state) => state.saveProject)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifier = event.ctrlKey || event.metaKey
      if (!modifier) return
      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if ((event.key === 'z' && event.shiftKey) || event.key === 'y') {
        event.preventDefault()
        redo()
      } else if (event.key === 's') {
        event.preventDefault()
        void saveProject()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo, saveProject])

  return (
    <div className="app">
      <Toolbar onError={setError} />
      {error !== null && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            閉じる
          </button>
        </div>
      )}
      <div className="workspace">
        <ScriptPane onError={setError} />
        <div className="workspace__center">
          <PreviewPane />
          <InspectorPane />
        </div>
        <ChatPane />
      </div>
      <TimelinePane />
    </div>
  )
}
