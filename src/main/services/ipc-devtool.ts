// Input: @cradle/ipc service decorators, shared IpcDevtoolStore singleton, devtool window factory
// Output: IpcDevtoolService exposing buffered IPC events and open-window action to renderer consumers
// Position: Main-process IPC service for devtool windows and debugging renderers

import { IpcMethod, IpcService } from '@cradle/ipc'

import { getIpcDevtoolStore, openDevtoolWindow } from '../lib/ipc-devtool'

export class IpcDevtoolService extends IpcService {
  static readonly groupName = 'ipcDevtool'

  @IpcMethod()
  getSnapshot() {
    return getIpcDevtoolStore().getSnapshot()
  }

  @IpcMethod()
  clear(): void {
    getIpcDevtoolStore().clear()
  }

  @IpcMethod()
  openWindow(): { opened: boolean } {
    const win = openDevtoolWindow()
    return { opened: win !== null }
  }
}
