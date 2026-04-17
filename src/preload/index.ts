import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge } from 'electron'

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
  }
  catch (error) {
    console.error(error)
  }
}
else {
  // @ts-expect-error global assignment outside contextBridge
  window.electron = electronAPI
}
