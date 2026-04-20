import type { AcpDevtoolEvent, IpcObservedEvent } from '@cradle/ipc'
import type { ElectronAPI } from '@electron-toolkit/preload'

import type { IpcServices } from '../main/ipc-types'

interface IpcDevtoolApi {
  getSnapshot: () => ReturnType<IpcServices['ipcDevtool']['getSnapshot']>
  clear: () => ReturnType<IpcServices['ipcDevtool']['clear']>
  getAcpSnapshot: () => ReturnType<IpcServices['ipcDevtool']['getAcpSnapshot']>
  clearAcp: () => ReturnType<IpcServices['ipcDevtool']['clearAcp']>
  onEvent: (listener: (event: IpcObservedEvent) => void) => () => void
  onAcpEvent: (listener: (event: AcpDevtoolEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    ipc: IpcServices
    ipcDevtool: IpcDevtoolApi
  }
}
