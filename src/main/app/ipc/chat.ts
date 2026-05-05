// Input: IpcService decorator framework, ChatEngine singleton
// Output: ChatService IPC surface — thin forwarder delegating to ChatEngine
// Position: Main-process IPC layer (L2 surface) for chat feature

import { getIpcContext, IpcMethod, IpcService } from '@cradle/ipc'

import type { ChatMessage, EnsureLiveResult } from '../../chat/chat-engine'
import { chatEngine } from '../../chat/chat-engine'

export class ChatService extends IpcService {
  static readonly groupName = 'chat'
  private get engine() {
    return chatEngine
  }

  @IpcMethod()
  async createAndSend(opts: {
    agentId: string
    workspaceId: string
    cwd: string
    text: string
    modelId?: string
    thinkingEffort?: 'low' | 'medium' | 'high'
    agentIdentityId?: string
  }): Promise<string> {
    return this.engine.createAndSend(opts)
  }

  @IpcMethod()
  async send(chatSessionId: string, text: string): Promise<void> {
    await this.engine.send(chatSessionId, text)
  }

  @IpcMethod()
  async abort(chatSessionId: string): Promise<void> {
    await this.engine.abort(chatSessionId)
  }

  @IpcMethod()
  getMessages(chatSessionId: string): ChatMessage[] {
    return this.engine.getMessages(chatSessionId)
  }

  @IpcMethod()
  getSessionTimeline(chatSessionId: string) {
    return this.engine.getSessionTimeline(chatSessionId)
  }

  @IpcMethod()
  async ensureLive(chatSessionId: string): Promise<EnsureLiveResult> {
    return this.engine.ensureLive(chatSessionId)
  }

  @IpcMethod()
  watchSession(chatSessionId: string): void {
    this.engine.watchSession(getIpcContext().sender, chatSessionId)
  }

  @IpcMethod()
  unwatchSession(chatSessionId: string): void {
    this.engine.unwatchSession(getIpcContext().sender, chatSessionId)
  }
}
