import type { Project } from '../project/types'

export const IPC = {
  projectOpen: 'project:open',
  projectSave: 'project:save',
  appInfo: 'app:info'
} as const

export interface OpenedProject {
  path: string
  project: Project
}

export interface SavedProject {
  path: string
}

export interface AppInfo {
  appVersion: string
  electronVersion: string
  projectFileExtension: string
}

/** preload が contextBridge で公開する API。レンダラが使える操作はこれだけに限る。 */
export interface ZundaApi {
  openProject: () => Promise<OpenedProject | null>
  /** path が null なら保存先を尋ねる。キャンセルされたら null を返す。 */
  saveProject: (project: Project, path: string | null) => Promise<SavedProject | null>
  getAppInfo: () => Promise<AppInfo>
}
