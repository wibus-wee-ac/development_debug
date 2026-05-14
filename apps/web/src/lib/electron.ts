// Input: window.cradle (injected by Electron preload)
// Output: Electron environment detection + native API wrappers
// Position: apps/web/src/lib/electron.ts

import { createIpcProxy } from '@cradle/ipc/client'

/**
 * Whether we're running inside Electron.
 */
export const isElectron = !!window.cradle?.env?.isElectron

/**
 * The server URL — from Electron preload or Vite env.
 */
export function getServerUrl(): string {
  if (window.cradle?.env?.serverUrl) {
    return window.cradle.env.serverUrl
  }
  return import.meta.env.VITE_SERVER_URL ?? 'http://127.0.0.1:21423'
}

/**
 * Whether this is a tearoff window (session-specific).
 */
const isTearoff = !!window.cradle?.env?.isTearoff

/**
 * The session ID for tearoff windows.
 */
const tearoffSessionId = window.cradle?.env?.sessionId ?? null

/**
 * The OS platform.
 */
const platform = window.cradle?.env?.platform ?? 'darwin'

// ── IPC Proxy (typed) ─────────────────────────────────────────────────────────

interface NativeServiceMethods {
  showOpenDialog: (options: {
    title?: string
    defaultPath?: string
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>
    filters?: Array<{ name: string, extensions: string[] }>
  }) => Promise<{ canceled: boolean, filePaths: string[] }>

  showSaveDialog: (options: {
    title?: string
    defaultPath?: string
    filters?: Array<{ name: string, extensions: string[] }>
  }) => Promise<{ canceled: boolean, filePath?: string }>

  openExternal: (url: string) => Promise<void>
  showItemInFolder: (fullPath: string) => Promise<void>
}

interface WindowServiceMethods {
  tearOffSession: (sessionId: string, screenX: number, screenY: number) => Promise<void>
  focusSession: (sessionId: string) => Promise<boolean>
  closeSession: (sessionId: string) => Promise<void>
  getOpenSessions: () => Promise<string[]>
}

interface CradleIpcServices {
  native: NativeServiceMethods
  window: WindowServiceMethods
}

/**
 * Typed IPC proxy for native services.
 * Returns null when not in Electron.
 */
export const nativeIpc = createIpcProxy<CradleIpcServices>(
  window.cradle?.ipc ?? null,
)
