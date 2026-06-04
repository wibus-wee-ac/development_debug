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
    browser?: {
      open: (input: {
        threadId: string
        initialUrl?: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      close: (input: {
        threadId: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      hide: (input: { threadId: string }) => Promise<void>
      getState: (input: {
        threadId: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      setBounds: (input: {
        threadId: string
        surface?: 'native'
        bounds: { x: number; y: number; width: number; height: number } | null
      }) => void
      captureScreenshot: (input: { threadId: string; tabId?: string }) => Promise<{
        name: string
        mimeType: 'image/png'
        sizeBytes: number
        bytes: Uint8Array
      }>
      copyScreenshotToClipboard: (input: { threadId: string; tabId?: string }) => Promise<void>
      executeCdp: (input: {
        threadId: string
        tabId?: string
        method: string
        params?: Record<string, unknown>
      }) => Promise<unknown>
      navigate: (input: {
        threadId: string
        tabId?: string
        url: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      reload: (input: {
        threadId: string
        tabId?: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      goBack: (input: {
        threadId: string
        tabId?: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      goForward: (input: {
        threadId: string
        tabId?: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      newTab: (input: {
        threadId: string
        url?: string
        activate?: boolean
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      closeTab: (input: {
        threadId: string
        tabId?: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      selectTab: (input: {
        threadId: string
        tabId?: string
      }) => Promise<import('~/store/browser-panel').ThreadBrowserState>
      openDevTools: (input: { threadId: string; tabId?: string }) => Promise<void>
      onState: (
        handler: (state: import('~/store/browser-panel').ThreadBrowserState) => void
      ) => () => void
    }
    // eslint-disable-next-line ts/no-explicit-any
    chatStream?: any
    desktopTray: {
      performAction: (actionId: string, payload?: unknown) => Promise<unknown>
      consumePendingActionRequests: () => Promise<unknown>
      onActionRequested: (handler: (request: unknown) => void) => () => void
    }
  }
  codex?: {
    sendPrompt: (
      input:
        | string
        | {
            attachments?: Array<
              | string
              | Blob
              | {
                  dataURL?: string
                  dataUrl?: string
                  filename?: string
                  mediaType?: string
                  mimeType?: string
                  name?: string
                  type?: string
                  url?: string
                }
            >
            files?: Array<
              | string
              | Blob
              | {
                  dataURL?: string
                  dataUrl?: string
                  filename?: string
                  mediaType?: string
                  mimeType?: string
                  name?: string
                  type?: string
                  url?: string
                }
            >
            prompt?: string
            text?: string
          },
      attachments?: Array<
        | string
        | Blob
        | {
            dataURL?: string
            dataUrl?: string
            filename?: string
            mediaType?: string
            mimeType?: string
            name?: string
            type?: string
            url?: string
          }
      >
    ) => Promise<void>
  }
  __cradleBrowserUseCreateTab?: (url?: string) => string | Promise<string>
  __cradleBrowserUseActivateTab?: (tabId: string) => boolean | Promise<boolean>
  __cradleBrowserUseGoOffScreen?: (tabId?: string) => boolean | Promise<boolean>
  __cradleBrowserUseGetActiveTab?: () => string | undefined | Promise<string | undefined>
  // eslint-disable-next-line ts/no-explicit-any
  __CRADLE_TAB_STORE__?: any
  // eslint-disable-next-line ts/no-explicit-any
  ipc: any
}
