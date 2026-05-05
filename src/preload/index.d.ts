// Input: Electron preload API contracts, PushEventMap, IPC service types
// Output: Global Window typing for the unified signal bridge
// Position: Type declaration surface for the isolated preload bridge

import type { AcpDevtoolEvent, AgentContextEvent, IpcObservedEvent } from '@cradle/ipc'
import type { ElectronAPI } from '@electron-toolkit/preload'

import type { IpcServices } from '../main/ipc-types'
import type { PushEventMap, PushTopic } from '../shared/push-events'

// ── Unified Signal Bridge ─────────────────────────────────────────────────────

interface CradleBridge {
  subscribe: <T extends PushTopic>(
    topic: T,
    listener: (payload: PushEventMap[T]) => void,
  ) => () => void
}

// ── Devtool (observability) ───────────────────────────────────────────────────

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

declare global {
  interface Window {
    electron: ElectronAPI
    ipc: IpcServices
    cradle: CradleBridge
    ipcDevtool: IpcDevtoolApi
  }
}
