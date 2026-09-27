import { useEffect, useRef, useState } from 'react'

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
import {
  copySelection,
  cutSelection,
  duplicateSelection,
  FRAME_MS,
  jumpToEditPoint,
  jumpToEnd,
  nudgePlayhead,
  pasteAt,
  rippleDeleteSelection,
  selectAll,
  splitAtPlayhead
} from './state/edit-actions'
import { deleteSelection, startAutosave, useEditorStore } from './state/store'
import { ContextMenuHost } from './ui/ContextMenu'
import { useLayoutStore } from './state/layout'
import { Splitter } from './ui/Splitter'

export function App(): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const loadSettings = useSettingsStore((state) => state.load)
  const layout = useLayoutStore((state) => state.layout)
  const appRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<HTMLDivElement>(null)

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
      const modifier = event.ctrlKey || event.metaKey
      const report = (message: string | null): void => {
        if (message) setError(message)
      }
      // タイムラインの編集のショートカット。入力中やダイアログを開いている間は効かせない。
      if (!typing && !document.querySelector('[role="dialog"]')) {
        const handled = timelineShortcut(event, modifier, report)
        if (handled) {
          event.preventDefault()
          return
        }
      }
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
    <div
      className="app"
      ref={appRef}
      style={
        {
          '--layout-left': layout.left,
          '--layout-right': layout.right,
          '--layout-timeline': layout.timeline,
          '--layout-inspector': layout.inspector
        } as React.CSSProperties
      }
    >
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
      <div className="workspace" ref={workspaceRef}>
        <ScriptPane onError={setError} />
        <Splitter target="left" container={() => workspaceRef.current} orientation="vertical" label="台本の欄の幅" />
        <div className="workspace__center" ref={centerRef}>
          <PreviewPane onError={setError} />
          <Splitter target="inspector" container={() => centerRef.current} orientation="horizontal" after label="インスペクタの高さ" />
          <InspectorPane onError={setError} />
        </div>
        <Splitter target="right" container={() => workspaceRef.current} orientation="vertical" after label="チャットの欄の幅" />
        <SidePane onError={setError} />
      </div>
      <Splitter target="timeline" container={() => appRef.current} orientation="horizontal" after label="タイムラインの高さ" />
      <TimelinePane onError={setError} />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      <ContextMenuHost />
    </div>
  )
}

/**
 * タイムラインの編集のショートカット。扱ったら true を返す。
 *   S: 再生位置で分割 / Delete: 削除 / Shift+Delete: 削除して詰める
 *   Ctrl+C・X・V・D・A: コピー・切り取り・貼り付け・複製・すべて選択
 *   ←→: 1コマ送り(Shift で1秒) / ↑↓: 前後の編集点へ / Home・End: 先頭・末尾へ
 */
function timelineShortcut(event: KeyboardEvent, modifier: boolean, report: (message: string | null) => void): boolean {
  if (modifier && !event.altKey) {
    switch (event.key.toLowerCase()) {
      case 'c':
        report(copySelection())
        return true
      case 'x':
        report(cutSelection())
        return true
      case 'v':
        report(pasteAt())
        return true
      case 'd':
        report(duplicateSelection())
        return true
      case 'a':
        selectAll()
        return true
      default:
        return false
    }
  }
  if (event.altKey || modifier) return false
  switch (event.key) {
    case 'Delete':
    case 'Backspace':
      report(event.shiftKey ? rippleDeleteSelection() : deleteSelection())
      return true
    case 's':
    case 'S':
      report(splitAtPlayhead())
      return true
    case 'ArrowLeft':
      nudgePlayhead(event.shiftKey ? -1000 : -FRAME_MS)
      return true
    case 'ArrowRight':
      nudgePlayhead(event.shiftKey ? 1000 : FRAME_MS)
      return true
    case 'ArrowUp':
      jumpToEditPoint(-1)
      return true
    case 'ArrowDown':
      jumpToEditPoint(1)
      return true
    case 'Home':
      useEditorStore.getState().setPlayhead(0)
      return true
    case 'End':
      jumpToEnd()
      return true
    default:
      return false
  }
}
