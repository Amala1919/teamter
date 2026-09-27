import { useEffect, useState } from 'react'

import type { AutosaveEntry } from '@shared/ipc/contract'

import { api, toAppError } from '../../api'
import { useEditorStore } from '../../state/store'

/**
 * 前回、保存しないまま終わった(落ちた)編集が自動保存に残っていれば、復元を勧める(REQUIREMENTS.md T-5)。
 */
export function RecoveryBanner({ onError }: { onError: (message: string | null) => void }): React.JSX.Element | null {
  const [entries, setEntries] = useState<AutosaveEntry[]>([])
  const sessionKey = useEditorStore((state) => state.sessionKey)

  useEffect(() => {
    api
      .invoke('autosave:list')
      .then((list) => setEntries(list.filter((entry) => entry.key !== useEditorStore.getState().sessionKey)))
      .catch(() => setEntries([]))
    // 起動したときに一度だけ調べる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const entry = entries.find((candidate) => candidate.key !== sessionKey)
  if (!entry) return null

  const dismiss = (key: string): void => setEntries((current) => current.filter((candidate) => candidate.key !== key))

  return (
    <div className="banner banner--warn" role="status" data-testid="recovery-banner">
      <span>
        保存されていない編集が残っています:「{entry.title}」({new Date(entry.savedAt).toLocaleString()} の時点
        {entry.filePath ? ` / ${entry.filePath}` : ' / 未保存の新規'})
      </span>
      <button
        type="button"
        onClick={() => {
          api
            .invoke('autosave:read', entry.key)
            .then((project) => {
              useEditorStore.getState().restoreProject(project, entry.filePath, entry.key)
              dismiss(entry.key)
            })
            .catch((error: unknown) => onError(toAppError(error).message))
        }}
        data-testid="recovery-restore"
      >
        復元する
      </button>
      <button
        type="button"
        onClick={() => {
          void api.invoke('autosave:clear', entry.key).catch(() => {})
          dismiss(entry.key)
        }}
        data-testid="recovery-discard"
      >
        破棄
      </button>
    </div>
  )
}
