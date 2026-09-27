import { contextBridge, ipcRenderer } from 'electron'

import type { AppInfo, OpenedProject, SavedProject, ZundaApi } from '@shared/ipc/contract'
import { IPC } from '@shared/ipc/contract'
import type { Project } from '@shared/project/types'

const api: ZundaApi = {
  openProject: () => ipcRenderer.invoke(IPC.projectOpen) as Promise<OpenedProject | null>,
  saveProject: (project: Project, path: string | null) =>
    ipcRenderer.invoke(IPC.projectSave, project, path) as Promise<SavedProject | null>,
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo) as Promise<AppInfo>
}

contextBridge.exposeInMainWorld('zunda', api)
