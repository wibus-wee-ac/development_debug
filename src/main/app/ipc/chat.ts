// Input: IpcService decorator framework, chat engine shell, chat timeline query, and session watch registry
// Output: ChatService IPC surface — thin forwarder over chat commands, chat read model, and watch registration
// Position: Main-process IPC layer (L2 surface) for chat feature

import { getIpcContext, IpcMethod, IpcService } from '@cradle/ipc'

import type { ChatEngine, EnsureLiveResult } from '../../chat/chat-engine'
import { chatEngine } from '../../chat/chat-engine'
import { chatSessionWatchRegistry, type ChatSessionWatchRegistry } from '../../chat/session-watch-registry'
import { createChatTimelineQuery, type ChatTimelineQuery } from '../../chat/timeline-query'

export class ChatService extends IpcService {
  static readonly groupName = 'chat'

  constructor(
    private readonly engine: ChatEngine = chatEngine,
    private readonly query: ChatTimelineQuery = createChatTimelineQuery(),
    private readonly watchRegistry: ChatSessionWatchRegistry = chatSessionWatchRegistry,
  ) {
    super()
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
  getSessionTimeline(chatSessionId: string) {
    return this.query.getSessionTimeline(chatSessionId)
  }

  @IpcMethod()
  hasActiveTurn(chatSessionId: string): boolean {
    return this.engine.hasDraft(chatSessionId)
  }

  @IpcMethod()
  async ensureLive(chatSessionId: string): Promise<EnsureLiveResult> {
    return this.engine.ensureLive(chatSessionId)
  }

  @IpcMethod()
  watchSession(chatSessionId: string): void {
    this.watchRegistry.watchSession(getIpcContext().sender, chatSessionId)
  }

  @IpcMethod()
  unwatchSession(chatSessionId: string): void {
    this.watchRegistry.unwatchSession(getIpcContext().sender, chatSessionId)
  }
}
