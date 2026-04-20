// Input: IpcService decorator framework, ChatEngine singleton
// Output: ChatService IPC surface — thin forwarder delegating to ChatEngine
// Position: Main-process IPC layer (L2 surface) for chat feature

import { IpcMethod, IpcService } from '@cradle/ipc'

import type { ChatMessage, EnsureLiveResult } from '../lib/chat-engine'
import { ChatEngine } from '../lib/chat-engine'

export class ChatService extends IpcService {
  static readonly groupName = 'chat'
  private get engine(): ChatEngine {
    return ChatEngine.getInstance()
  }

  @IpcMethod()
  async createAndSend(opts: {
    agentId: string
    workspaceId: string
    cwd: string
    text: string
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
  async ensureLive(chatSessionId: string): Promise<EnsureLiveResult> {
    return this.engine.ensureLive(chatSessionId)
  }
}
