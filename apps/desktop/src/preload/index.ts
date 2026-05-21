import { contextBridge, ipcRenderer } from 'electron'

// Parse --server-url and --session-id from additionalArguments
function getArg(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find(a => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : null
}

const serverUrl = getArg('server-url') ?? 'http://127.0.0.1:21423'
const sessionId = getArg('session-id')
const isTearoff = getArg('tearoff') === 'true'
const surface = getArg('surface')
const isTray = surface === 'tray'

// Expose a minimal, typesafe API to the renderer
const cradleElectron = {
  /** IPC invoke — matches the InvokableIpc interface from @cradle/ipc/client */
  ipc: {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
    on: (channel: string, handler: (...args: unknown[]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => handler(...args)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
  },

  /** Environment info */
  env: {
    serverUrl,
    sessionId,
    isTearoff,
    surface,
    isTray,
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    isElectron: true as const,
  },

  /** Window controls (for custom titlebar if needed) */
  window: {
    minimize: () => ipcRenderer.invoke('window.minimize'),
    maximize: () => ipcRenderer.invoke('window.maximize'),
    close: () => ipcRenderer.invoke('window.close'),
  },

  /** Desktop update status events pushed by the main process */
  desktopUpdate: {
    onStatusChanged: (handler: (status: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown) => handler(status)
      ipcRenderer.on('desktop-update:status-changed', listener)
      return () => {
        ipcRenderer.removeListener('desktop-update:status-changed', listener)
      }
    },
  },

  /** Desktop tray action bridge */
  desktopTray: {
    performAction: (actionId: string, payload?: unknown) => ipcRenderer.invoke('desktop-tray:perform-action', actionId, payload),
    consumePendingActionRequests: () => ipcRenderer.invoke('desktop-tray:consume-pending-actions'),
    onActionRequested: (handler: (request: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: unknown) => handler(request)
      ipcRenderer.on('desktop-tray:action-requested', listener)
      return () => {
        ipcRenderer.removeListener('desktop-tray:action-requested', listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('cradle', cradleElectron)

// Type declaration for renderer access
export type CradleElectronAPI = typeof cradleElectron
