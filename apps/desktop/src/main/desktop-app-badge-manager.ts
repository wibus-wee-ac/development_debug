// Output: Electron app-icon badge IPC owned by the desktop main process.
// Input: Renderer-projected unread counts from the app shell.
// Position: Desktop app chrome boundary for native Dock/taskbar badge state, separate from tray ownership.

import { app, ipcMain } from 'electron'

const DESKTOP_APP_BADGE_UNREAD_COUNT_CHANNEL = 'desktop-app-badge:set-unread-count'

export class DesktopAppBadgeManager {
  initialize(): void {
    ipcMain.handle(DESKTOP_APP_BADGE_UNREAD_COUNT_CHANNEL, (_event, count: unknown) => {
      this.setUnreadCount(count)
    })
    this.clear()
  }

  destroy(): void {
    ipcMain.removeHandler(DESKTOP_APP_BADGE_UNREAD_COUNT_CHANNEL)
    this.clear()
  }

  setUnreadCount(count: unknown): void {
    if (process.platform !== 'darwin') {
      return
    }
    const normalizedCount = normalizeCount(count)
    app.dock?.setBadge(normalizedCount > 0 ? String(normalizedCount) : '')
  }

  private clear(): void {
    if (process.platform === 'darwin') {
      app.dock?.setBadge('')
    }
  }
}

function normalizeCount(count: unknown): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return 0
  }
  return Math.max(0, Math.floor(count))
}

export { DESKTOP_APP_BADGE_UNREAD_COUNT_CHANNEL }
