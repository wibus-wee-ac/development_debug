// Input: Electron preload API contracts, IPC service types, and shared chat push payloads
// Output: Global Window typing for preload-exposed bridges used by the renderer
// Position: Type declaration surface for the isolated preload bridge

import type { AcpDevtoolEvent, AgentContextEvent, IpcObservedEvent } from '@cradle/ipc'
import type { ElectronAPI } from '@electron-toolkit/preload'

import type { IpcServices } from '../main/ipc-types'
import type {
  ChatSessionActivityPayload,
  ChatSessionTitlePayload,
  ChatTimelineEventPayload,
} from '../shared/chat-events'

interface IpcDevtoolApi {
  getSnapshot: () => ReturnType<IpcServices['ipcDevtool']['getSnapshot']>
  clear: () => ReturnType<IpcServices['ipcDevtool']['clear']>
  getAcpSnapshot: () => ReturnType<IpcServices['ipcDevtool']['getAcpSnapshot']>
  clearAcp: () => ReturnType<IpcServices['ipcDevtool']['clearAcp']>
  onEvent: (listener: (event: IpcObservedEvent) => void) => () => void
  onAcpEvent: (listener: (event: AcpDevtoolEvent) => void) => () => void
  getAgentContextSnapshot: () => ReturnType<IpcServices['ipcDevtool']['getAgentContextSnapshot']>
  clearAgentContext: () => ReturnType<IpcServices['ipcDevtool']['clearAgentContext']>
  onAgentContextEvent: (listener: (event: AgentContextEvent) => void) => () => void
}

interface PtyPushApi {
  onData: (listener: (sessionId: string, data: string) => void) => () => void
  onTitle: (listener: (sessionId: string, title: string) => void) => () => void
  onExit: (listener: (sessionId: string, exitCode: number, signal: number | null) => void) => () => void
  onNotification: (listener: (sessionId: string, message: string) => void) => () => void
  onCommandFinish: (listener: (sessionId: string, exitCode: number) => void) => () => void
}

interface ChatPushApi {
  onTimelineEvent: (listener: (payload: ChatTimelineEventPayload) => void) => () => void
  onSessionTitle: (listener: (payload: ChatSessionTitlePayload) => void) => () => void
  onSessionActivity: (listener: (payload: ChatSessionActivityPayload) => void) => () => void
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
