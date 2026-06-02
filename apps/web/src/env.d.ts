/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PACKAGE_VERSION?: string
  readonly VITE_SERVER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Stub out Electron-only window properties so devtool code compiles in web context.
// These features are non-functional in the web build but won't crash.
interface Window {
  // eslint-disable-next-line ts/no-explicit-any
  ipcDevtool: any
  // eslint-disable-next-line ts/no-explicit-any
  electron: any
  cradle?: {
    ipc: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, handler: (...args: unknown[]) => void) => () => void
    }
    env: {
      serverUrl: string
      sessionId: string | null
      isTearoff: boolean
      surface: string | null
      platform: 'darwin' | 'win32' | 'linux'
      isElectron: true
    }
    window: {
      minimize: () => Promise<unknown>
      maximize: () => Promise<unknown>
      close: () => Promise<unknown>
      startPointerMonitor: () => Promise<unknown>
      stopPointerMonitor: () => Promise<unknown>
      onTearoffSessionClosed: (handler: (sessionId: string) => void) => () => void
      onPointerOutsideWindow: (handler: (screenX: number, screenY: number) => void) => () => void
    }
    desktopUpdate: {
      onStatusChanged: (handler: (status: unknown) => void) => () => void
    }
    desktopAppBadge?: {
      setUnreadCount: (count: number) => Promise<unknown>
    }
    // eslint-disable-next-line ts/no-explicit-any
    chatStream?: any
    desktopTray: {
      performAction: (actionId: string, payload?: unknown) => Promise<unknown>
      consumePendingActionRequests: () => Promise<unknown>
      onActionRequested: (handler: (request: unknown) => void) => () => void
    }
    /** @deprecated Legacy subscribe API — prefer ipc */
    subscribe?: (topic: string, listener: (...args: unknown[]) => void) => () => void
  }
  codex?: {
    sendPrompt: (
      input: string | {
        attachments?: Array<string | Blob | {
          dataURL?: string
          dataUrl?: string
          filename?: string
          mediaType?: string
          mimeType?: string
          name?: string
          type?: string
          url?: string
        }>
        files?: Array<string | Blob | {
          dataURL?: string
          dataUrl?: string
          filename?: string
          mediaType?: string
          mimeType?: string
          name?: string
          type?: string
          url?: string
        }>
        prompt?: string
        text?: string
      },
      attachments?: Array<string | Blob | {
        dataURL?: string
        dataUrl?: string
        filename?: string
        mediaType?: string
        mimeType?: string
        name?: string
        type?: string
        url?: string
      }>,
    ) => Promise<void>
  }
  __cradleBrowserUseCreateTab?: (url?: string) => string
  __cradleBrowserUseActivateTab?: (tabId: string) => boolean
  __cradleBrowserUseGoOffScreen?: (tabId?: string) => boolean
  __cradleBrowserUseGetActiveTab?: () => string | undefined
  // eslint-disable-next-line ts/no-explicit-any
  __CRADLE_TAB_STORE__?: any
  // eslint-disable-next-line ts/no-explicit-any
  ipc: any
}
