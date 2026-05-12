// Input: Electron app/shell APIs, @cradle/ipc service decorators + handler context
// Output: DevService — dev-only main-process actions (open userData folder, hard reload caller window)
// Position: Main-process IPC service dedicated to the dev-mode bottom bar

import { getIpcContext, IpcMethod, IpcService } from '@cradle/ipc'
import { is } from '@electron-toolkit/utils'
import { app, shell } from 'electron'

export class DevService extends IpcService {
  static readonly groupName = 'dev'

  @IpcMethod()
  async openUserData(): Promise<void> {
    if (!is.dev) {
      return
    }
    await shell.openPath(app.getPath('userData'))
  }

  @IpcMethod()
  hardReload(): void {
    if (!is.dev) {
      return
    }
    try {
      getIpcContext().sender.reloadIgnoringCache()
    }
    catch {
      // Called from socket/CLI — no Electron sender available, ignore
    }
  }
}
