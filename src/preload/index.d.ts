import type { IpcObservedEvent } from '@cradle/ipc'
import type { ElectronAPI } from '@electron-toolkit/preload'

import type { IpcServices } from '../main/ipc-types'

interface IpcDevtoolApi {
  getSnapshot: () => ReturnType<IpcServices['ipcDevtool']['getSnapshot']>
  clear: () => ReturnType<IpcServices['ipcDevtool']['clear']>
  onEvent: (listener: (event: IpcObservedEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    ipc: IpcServices
    ipcDevtool: IpcDevtoolApi
  }
}
