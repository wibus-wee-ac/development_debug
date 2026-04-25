import type { AcpDevtoolEvent, IpcObservedEvent } from '@cradle/ipc'
import type { ElectronAPI } from '@electron-toolkit/preload'

import type { IpcServices } from '../main/ipc-types'
import type { ChatResponseEventPayload, ChatSessionTitlePayload } from '../shared/chat-events'

interface IpcDevtoolApi {
  getSnapshot: () => ReturnType<IpcServices['ipcDevtool']['getSnapshot']>
  clear: () => ReturnType<IpcServices['ipcDevtool']['clear']>
  getAcpSnapshot: () => ReturnType<IpcServices['ipcDevtool']['getAcpSnapshot']>
  clearAcp: () => ReturnType<IpcServices['ipcDevtool']['clearAcp']>
  onEvent: (listener: (event: IpcObservedEvent) => void) => () => void
  onAcpEvent: (listener: (event: AcpDevtoolEvent) => void) => () => void
}

interface PtyPushApi {
  onData: (listener: (sessionId: string, data: string) => void) => () => void
  onTitle: (listener: (sessionId: string, title: string) => void) => () => void
  onExit: (listener: (sessionId: string, exitCode: number, signal: number | null) => void) => () => void
  onNotification: (listener: (sessionId: string, message: string) => void) => () => void
  onCommandFinish: (listener: (sessionId: string, exitCode: number) => void) => () => void
}

interface ChatPushApi {
  onResponseEvent: (listener: (payload: ChatResponseEventPayload) => void) => () => void
  onSessionTitle: (listener: (payload: ChatSessionTitlePayload) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    ipc: IpcServices
    ipcDevtool: IpcDevtoolApi
    ptyPush: PtyPushApi
    chatPush: ChatPushApi
  }
}
