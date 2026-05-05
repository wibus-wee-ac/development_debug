// Input: WindowManager
// Output: WindowService IPC — exposes session window management to renderer
// Position: Main-process IPC service for window management

import { IpcMethod, IpcService } from '@cradle/ipc'

import { WindowManager } from '../../platform/window/window-manager'

export class WindowService extends IpcService {
  static readonly groupName = 'window'

  @IpcMethod()
  tearOffSession(sessionId: string, x: number, y: number): void {
    WindowManager.getInstance().openSessionWindow(sessionId, x, y)
  }
}
