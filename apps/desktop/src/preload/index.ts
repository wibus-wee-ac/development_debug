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

const CHAT_STREAM_CHUNK_CHANNEL = 'chat-stream:chunk'
const CHAT_STREAM_CLOSED_CHANNEL = 'chat-stream:closed'
const CHAT_STREAM_ERROR_CHANNEL = 'chat-stream:error'

function subscribeIpc<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

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
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    isElectron: true as const,
  },

  /** Window controls (for custom titlebar if needed) */
  window: {
    minimize: () => ipcRenderer.invoke('window.minimize'),
    maximize: () => ipcRenderer.invoke('window.maximize'),
    close: () => ipcRenderer.invoke('window.close'),
    startPointerMonitor: () => ipcRenderer.invoke('window.startPointerMonitor'),
    stopPointerMonitor: () => ipcRenderer.invoke('window.stopPointerMonitor'),
    onTearoffSessionClosed: (handler: (sessionId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, sessionId: string) => handler(sessionId)
      ipcRenderer.on('window:tearoff-session-closed', listener)
      return () => {
        ipcRenderer.removeListener('window:tearoff-session-closed', listener)
      }
    },
    onPointerOutsideWindow: (handler: (screenX: number, screenY: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, screenX: number, screenY: number) => handler(screenX, screenY)
      ipcRenderer.on('window:pointer-outside-window', listener)
      return () => {
        ipcRenderer.removeListener('window:pointer-outside-window', listener)
      }
    },
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

  /** Desktop-owned long-lived chat stream bridge */
  chatStream: {
    startResponse: (request: unknown) => ipcRenderer.invoke('chatStream.startResponse', request),
    subscribeSession: (request: unknown) => ipcRenderer.invoke('chatStream.subscribeSession', request),
    abort: (request: unknown) => ipcRenderer.invoke('chatStream.abort', request),
    diagnostics: () => ipcRenderer.invoke('chatStream.diagnostics'),
    onChunk: (handler: (event: unknown) => void) => subscribeIpc(CHAT_STREAM_CHUNK_CHANNEL, handler),
    onClosed: (handler: (event: unknown) => void) => subscribeIpc(CHAT_STREAM_CLOSED_CHANNEL, handler),
    onError: (handler: (event: unknown) => void) => subscribeIpc(CHAT_STREAM_ERROR_CHANNEL, handler),
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
