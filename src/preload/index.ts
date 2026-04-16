import { createIpcProxy } from '@cradle/ipc'
import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge } from 'electron'

import type { IpcServices } from '../main/ipc-types'

const ipc = createIpcProxy<IpcServices>(electronAPI.ipcRenderer)

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', { ipc })
  }
  catch (error) {
    console.error(error)
  }
}
else {
  // @ts-expect-error global assignment outside contextBridge
  window.electron = electronAPI
  // @ts-expect-error global assignment outside contextBridge
  window.api = { ipc }
}
