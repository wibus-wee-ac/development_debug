/// <reference types="vite/client" />

interface ImportMetaEnv {
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
    }
    env: {
      serverUrl: string
      sessionId: string | null
      isTearoff: boolean
      platform: 'darwin' | 'win32' | 'linux'
      isElectron: true
    }
    window: {
      minimize: () => Promise<unknown>
      maximize: () => Promise<unknown>
      close: () => Promise<unknown>
    }
    /** @deprecated Legacy subscribe API — prefer ipc */
    subscribe?: (topic: string, listener: (...args: unknown[]) => void) => () => void
  }
  // eslint-disable-next-line ts/no-explicit-any
  ipc: any
}
