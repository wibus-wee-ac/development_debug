// Input: @cradle/ipc observer registration, Electron BrowserWindow/WebContents, IPC + ACP devtool stores, preload path
// Output: Shared main-process devtool backend — observer wiring, store access, and devtool window factory
// Position: Devtool capability integration point that connects runtime instrumentation to the devtool window

import { join } from 'node:path'

import type { IpcObservedEvent } from '@cradle/ipc'
import { setIpcObserver } from '@cradle/ipc'
import { is } from '@electron-toolkit/utils'
import type { WebContents } from 'electron'
import { BrowserWindow } from 'electron'

import { subscribeAcpDevtool } from './acp-devtool-store'
import { subscribeAgentContextDevtool } from './agent-context-devtool-store'
import { IpcDevtoolStore } from './ipc-devtool-store'
import { subscribeObservabilityDevtool } from './observability-devtool-store'

export const IPC_DEVTOOL_EVENT_CHANNEL = 'ipc-devtool:event'

const store = new IpcDevtoolStore({ eventChannel: IPC_DEVTOOL_EVENT_CHANNEL })

let devtoolWindow: BrowserWindow | null = null

export function initializeIpcDevtool(): IpcDevtoolStore {
  setIpcObserver((event: IpcObservedEvent) => {
    store.record(event)
  })

  return store
}

export function getIpcDevtoolStore(): IpcDevtoolStore {
  return store
}

export function subscribeIpcDevtool(webContents: WebContents): () => void {
  return store.subscribe(webContents)
}

export function subscribeRuntimeDevtools(webContents: WebContents): Array<() => void> {
  return [
    subscribeIpcDevtool(webContents),
    subscribeAcpDevtool(webContents),
    subscribeAgentContextDevtool(webContents),
    subscribeObservabilityDevtool(webContents),
  ]
}

export function openDevtoolWindow(): BrowserWindow | null {
  if (!is.dev) {
    return null
  }

  if (devtoolWindow && !devtoolWindow.isDestroyed()) {
    devtoolWindow.focus()
    return devtoolWindow
  }

  const win = new BrowserWindow({
    width: 1100,
    height: 680,
    title: 'IPC Devtool',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  win.on('closed', () => {
    if (devtoolWindow === win) {
      devtoolWindow = null
    }
  })

  win.webContents.once('did-finish-load', () => {
    subscribeRuntimeDevtools(win.webContents)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#/devtool`)
  }
 else {
    win.loadFile(join(__dirname, '../../renderer/index.html'), { hash: '/devtool' })
  }

  devtoolWindow = win
  return win
}
