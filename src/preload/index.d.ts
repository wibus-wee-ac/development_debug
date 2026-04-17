import type { ElectronAPI } from '@electron-toolkit/preload'

import type { IpcServices } from '../main/ipc-types'

declare global {
  interface Window {
    electron: ElectronAPI
    ipc: IpcServices
  }
}
