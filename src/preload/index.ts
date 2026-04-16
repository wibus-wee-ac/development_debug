import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { createIpcProxy } from '@cradle/ipc'
import type { IpcServices } from '../main/ipc-types'

const ipc = createIpcProxy<IpcServices>(electronAPI.ipcRenderer)

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', { ipc })
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = { ipc }
}
