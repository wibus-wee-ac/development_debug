// Input: electron-toolkit preload helpers, Electron contextBridge, IPC/ACP devtool event channels, PTY push channels
// Output: Safe renderer globals for Electron APIs, devtool subscriptions, and PTY push events
// Position: Shared preload bridge loaded by all BrowserWindow instances

import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge } from 'electron'

const ACP_DEVTOOL_EVENT_CHANNEL = 'acp-devtool:event'
const IPC_DEVTOOL_EVENT_CHANNEL = 'ipc-devtool:event'

const ipcDevtool = {
  getSnapshot: () => electronAPI.ipcRenderer.invoke('ipcDevtool.getSnapshot'),
  clear: () => electronAPI.ipcRenderer.invoke('ipcDevtool.clear'),
  getAcpSnapshot: () => electronAPI.ipcRenderer.invoke('ipcDevtool.getAcpSnapshot'),
  clearAcp: () => electronAPI.ipcRenderer.invoke('ipcDevtool.clearAcp'),
  onEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload)
    electronAPI.ipcRenderer.on(IPC_DEVTOOL_EVENT_CHANNEL, wrapped)

    return () => {
      electronAPI.ipcRenderer.removeListener(IPC_DEVTOOL_EVENT_CHANNEL, wrapped)
    }
  },
  onAcpEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload)
    electronAPI.ipcRenderer.on(ACP_DEVTOOL_EVENT_CHANNEL, wrapped)

    return () => {
      electronAPI.ipcRenderer.removeListener(ACP_DEVTOOL_EVENT_CHANNEL, wrapped)
    }
  },
}

const ptyPush = {
  onData: (listener: (sessionId: string, data: string) => void) => {
    const wrapped = (_event: unknown, sessionId: string, data: string) => listener(sessionId, data)
    electronAPI.ipcRenderer.on('pty:data', wrapped)
    return () => electronAPI.ipcRenderer.removeListener('pty:data', wrapped)
  },
  onTitle: (listener: (sessionId: string, title: string) => void) => {
    const wrapped = (_event: unknown, sessionId: string, title: string) => listener(sessionId, title)
    electronAPI.ipcRenderer.on('pty:title', wrapped)
    return () => electronAPI.ipcRenderer.removeListener('pty:title', wrapped)
  },
  onExit: (listener: (sessionId: string, exitCode: number, signal: number | null) => void) => {
    const wrapped = (_event: unknown, sessionId: string, exitCode: number, signal: number | null) => listener(sessionId, exitCode, signal)
    electronAPI.ipcRenderer.on('pty:exit', wrapped)
    return () => electronAPI.ipcRenderer.removeListener('pty:exit', wrapped)
  },
  onNotification: (listener: (sessionId: string, message: string) => void) => {
    const wrapped = (_event: unknown, sessionId: string, message: string) => listener(sessionId, message)
    electronAPI.ipcRenderer.on('pty:notification', wrapped)
    return () => electronAPI.ipcRenderer.removeListener('pty:notification', wrapped)
  },
  onCommandFinish: (listener: (sessionId: string, exitCode: number) => void) => {
    const wrapped = (_event: unknown, sessionId: string, exitCode: number) => listener(sessionId, exitCode)
    electronAPI.ipcRenderer.on('pty:command-finish', wrapped)
    return () => electronAPI.ipcRenderer.removeListener('pty:command-finish', wrapped)
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('ipcDevtool', ipcDevtool)
    contextBridge.exposeInMainWorld('ptyPush', ptyPush)
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
  // @ts-expect-error global assignment outside contextBridge
  window.ptyPush = ptyPush
}
