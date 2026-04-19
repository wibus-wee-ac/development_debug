// Input: electron-toolkit preload helpers, Electron contextBridge, IPC devtool event channel
// Output: Safe renderer globals for Electron APIs and IPC devtool subscriptions
// Position: Shared preload bridge loaded by all BrowserWindow instances

import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge } from 'electron'

const IPC_DEVTOOL_EVENT_CHANNEL = 'ipc-devtool:event'

const ipcDevtool = {
  getSnapshot: () => electronAPI.ipcRenderer.invoke('ipcDevtool.getSnapshot'),
  clear: () => electronAPI.ipcRenderer.invoke('ipcDevtool.clear'),
  onEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload)
    electronAPI.ipcRenderer.on(IPC_DEVTOOL_EVENT_CHANNEL, wrapped)

    return () => {
      electronAPI.ipcRenderer.removeListener(IPC_DEVTOOL_EVENT_CHANNEL, wrapped)
    }
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('ipcDevtool', ipcDevtool)
  }
 catch (error) {
    console.error(error)
  }
}
 else {
  // @ts-expect-error global assignment outside contextBridge
  window.electron = electronAPI
  // @ts-expect-error global assignment outside contextBridge
  window.ipcDevtool = ipcDevtool
}
