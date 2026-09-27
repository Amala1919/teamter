import { useEffect, useState } from 'react'

import { SidePane } from './features/chat/SidePane'
import { InspectorPane } from './features/inspector/InspectorPane'
import { PreviewPane } from './features/preview/PreviewPane'
import { ScriptPane } from './features/script/ScriptPane'
import { SettingsDialog } from './features/settings/SettingsDialog'
import { TimelinePane } from './features/timeline/TimelinePane'
import { Toolbar } from './features/toolbar/Toolbar'
import { togglePlayback } from './playback/player'
import { useSettingsStore } from './state/settings'
import { RecoveryBanner } from './features/toolbar/RecoveryBanner'
import { EngineInstallBanner } from './features/voice/EngineInstall'
import { useVoiceStore } from './state/voice'
import { deleteSelection, startAutosave, useEditorStore } from './state/store'

export function App(): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const loadSettings = useSettingsStore((state) => state.load)

  useEffect(() => {
    loadSettings()
      // 起動したら音声エンジンをつないでおく(見つからなければ自動インストールを勧める)。
      .then(() => useVoiceStore.getState().ensureEngine('voicevox'))
      .catch((caught: unknown) => setError(String(caught)))
  }, [loadSettings])

  useEffect(() => {
    // テストでは間隔を短くできるようにする。
    let interval: number | undefined
    try {
      const configured = Number(window.localStorage.getItem('zs.autosaveIntervalMs'))
      if (configured > 0) interval = configured
    } catch {
      // 保存領域が使えなくても既定の間隔で動かす。
    }
    return startAutosave(interval)
  }, [])
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const saveProject = useEditorStore((state) => state.saveProject)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing = target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if (event.key === ' ' && !typing) {
        event.preventDefault()
        togglePlayback()
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && !document.querySelector('[role="dialog"]')) {
        event.preventDefault()
        const message = deleteSelection()
        if (message) setError(message)
        return
      }
      const modifier = event.ctrlKey || event.metaKey
      if (!modifier) return
      // 入力欄の中では、その入力欄の取り消し(文字単位)を優先する。
      if (typing && (event.key === 'z' || event.key === 'y')) return
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
      <div className="app__header">
        <Toolbar onError={setError} onOpenSettings={() => setSettingsOpen(true)} />
        <RecoveryBanner onError={setError} />
        <EngineInstallBanner onOpenSettings={() => setSettingsOpen(true)} />
        {error !== null && (
          <div className="banner banner--error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              閉じる
            </button>
          </div>
        )}
      </div>
      <div className="workspace">
        <ScriptPane onError={setError} />
        <div className="workspace__center">
          <PreviewPane onError={setError} />
          <InspectorPane onError={setError} />
        </div>
        <SidePane onError={setError} />
      </div>
      <TimelinePane onError={setError} />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
