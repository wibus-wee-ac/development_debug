// Input: window.electron.ipcRenderer from preload, createIpcProxy from @cradle/ipc/client
// Output: ipc — typed IPC proxy for renderer
// Position: Shared IPC entry point for renderer process

import { createIpcProxy } from '@cradle/ipc/client'

type IpcServices = typeof window.ipc

export const ipc = createIpcProxy<IpcServices>(window.electron.ipcRenderer, {
  captureStack: true,
})
