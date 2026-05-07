// Input: @cradle/ipc service decorators, shared IPC/ACP devtool stores, devtool window factory
// Output: IpcDevtoolService exposing buffered runtime events and open-window action to renderer consumers
// Position: Main-process IPC service for devtool windows and debugging renderers

import { IpcMethod, IpcService } from '@cradle/ipc'

import { getAcpDevtoolStore } from '../../devtools/acp-devtool-store'
import { getAgentContextDevtoolStore } from '../../devtools/agent-context-devtool-store'
import { getIpcDevtoolStore, openDevtoolWindow } from '../../devtools/ipc-devtool'
import { getObservabilityService } from '../../observability/service'

export class IpcDevtoolService extends IpcService {
  static readonly groupName = 'ipcDevtool'

  @IpcMethod()
  getSnapshot() {
    return getIpcDevtoolStore().getSnapshot()
  }

  @IpcMethod()
  clear(): void {
    getIpcDevtoolStore().clear()
  }

  @IpcMethod()
  getAcpSnapshot() {
    return getAcpDevtoolStore().getSnapshot()
  }

  @IpcMethod()
  clearAcp(): void {
    getAcpDevtoolStore().clear()
  }

  @IpcMethod()
  getAgentContextSnapshot() {
    return getAgentContextDevtoolStore().getSnapshot()
  }

  @IpcMethod()
  clearAgentContext(): void {
    getAgentContextDevtoolStore().clear()
  }

  @IpcMethod()
  getObservabilitySnapshot() {
    return getObservabilityService().getDevtoolSnapshot()
  }

  @IpcMethod()
  clearObservability(): void {
    getObservabilityService().clearDevtoolBuffer()
  }

  @IpcMethod()
  async flushObservability(): Promise<void> {
    await getObservabilityService().flushEvents()
  }

  @IpcMethod()
  exportObservabilityBundle(input: {
    chatSessionId?: string
    runId?: string
    sinceUnix?: number
  }) {
    return getObservabilityService().exportBundle(input ?? {})
  }

  @IpcMethod()
  openWindow(): { opened: boolean } {
    const win = openDevtoolWindow()
    return { opened: win !== null }
  }
}
