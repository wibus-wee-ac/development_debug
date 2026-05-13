// Input: Electron contextBridge + ipcRenderer
// Output: Exposes typesafe IPC bridge + env to renderer
// Position: apps/desktop/src/preload/index.ts

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

// Expose a minimal, typesafe API to the renderer
const cradleElectron = {
  /** IPC invoke — matches the InvokableIpc interface from @cradle/ipc/client */
  ipc: {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  },

  /** Environment info */
  env: {
    serverUrl,
    sessionId,
    isTearoff,
    platform: process.platform as 'darwin' | 'win32' | 'linux',
    isElectron: true as const,
  },

  /** Window controls (for custom titlebar if needed) */
  window: {
    minimize: () => ipcRenderer.invoke('window.minimize'),
    maximize: () => ipcRenderer.invoke('window.maximize'),
    close: () => ipcRenderer.invoke('window.close'),
  },
}

contextBridge.exposeInMainWorld('cradle', cradleElectron)

// Type declaration for renderer access
export type CradleElectronAPI = typeof cradleElectron
