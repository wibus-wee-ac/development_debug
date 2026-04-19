// Input: electron screen/window APIs and electron-store persistence
// Output: appStore plus helpers for persisting window bounds and app preferences
// Position: Main-process persistent preference store for native application state

import type { StoredChatPreferences } from '@shared/chat-preferences'
import type { BrowserWindow } from 'electron'
import { screen } from 'electron'
import Store from 'electron-store'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

interface AppPreferences {
  lastWorkspaceId?: string
  chatPreferences: StoredChatPreferences
  /** Persisted bounds keyed by a stable window identifier (e.g. "main"). */
  windows: Record<string, WindowBounds>
}

// ── Store instance ────────────────────────────────────────────────────────────

export const appStore = new Store<AppPreferences>({
  name: 'app-preferences',
  defaults: {
    chatPreferences: {
      modelId: null,
      configSelections: {},
    },
    windows: {},
  },
})

export function getChatPreferences(): StoredChatPreferences {
  return appStore.get('chatPreferences')
}

export function setChatPreferences(preferences: StoredChatPreferences): void {
  appStore.set('chatPreferences', preferences)
}

// ── Window state helpers ──────────────────────────────────────────────────────

/**
 * Returns true when the given bounds overlap with at least one display's work
 * area — ensures we never restore a window onto an unplugged monitor.
 */
function isBoundsVisible(bounds: WindowBounds): boolean {
  return screen.getAllDisplays().some(({ workArea: wa }) => {
    return (
      bounds.x < wa.x + wa.width
      && bounds.x + bounds.width > wa.x
      && bounds.y < wa.y + wa.height
      && bounds.y + bounds.height > wa.y
    )
  })
}

/**
 * Persists the current bounds of `win` under `windowId`.
 * Call this from the window's `'close'` event.
 */
export function saveWindowState(windowId: string, win: BrowserWindow): void {
  const { x, y, width, height } = win.getBounds()
  appStore.set(`windows.${windowId}`, {
    x,
    y,
    width,
    height,
    isMaximized: win.isMaximized(),
  })
}

/**
 * Restores previously saved bounds for `windowId` onto `win`.
 * Silently skips if no state is saved or if the bounds are off-screen.
 */
export function restoreWindowState(windowId: string, win: BrowserWindow): void {
  const saved = appStore.get(`windows.${windowId}`)
  if (!saved) {
    return
  }
  if (!isBoundsVisible(saved)) {
    return
  }

  win.setBounds({ x: saved.x, y: saved.y, width: saved.width, height: saved.height })
  if (saved.isMaximized) {
    win.maximize()
  }
}
