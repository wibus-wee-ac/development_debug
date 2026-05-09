// Input: ACP connection manager and chat-runtime provider contracts
// Output: ACP Chat provider bound to the unified server `/chat` runtime
// Position: apps/server chat-runtime ACP provider implementation

import type {
  CancelTurnInput,
  ChatRuntimeProvider,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
  TimelineInputEvent,
  TokenUsage,
} from '../../runtime-provider-types'
import { buildAcpConnectionRecord } from './config'
import { AcpConnectionManager } from './connection-manager'

interface AcpChatProviderDeps {
  runtime: AcpConnectionManager
}

export class AcpChatProvider implements ChatRuntimeProvider {
  readonly providerKind = 'acp-chat' as const

  private _lastUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  constructor(private readonly deps: AcpChatProviderDeps) {}

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    await this.ensureConnected(input.profile.id, input.profile.configJson)
    const response = await this.deps.runtime.newSession(input.profile.id, input.workspacePath)

    if (input.modelId && response.sessionId) {
      try {
        await this.deps.runtime.setSessionModel(input.profile.id, response.sessionId, input.modelId)
      }
      catch {
        // ACP agents may reject explicit model changes and keep their default.
      }
    }

    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      agentProfileId: input.profile.id,
      providerKind: this.providerKind,
      providerSessionId: response.sessionId,
      providerStateSnapshot: JSON.stringify({
        models: response.models ?? null,
        configOptions: response.configOptions ?? [],
      }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const storedSessionId = input.runtimeSession.providerSessionId
    if (!storedSessionId) {
      return this.startChatSession({
        chatSessionId: input.runtimeSession.chatSessionId,
        profile: input.profile,
        workspacePath: input.workspacePath,
        modelId: input.modelId,
      })
    }

    await this.ensureConnected(input.profile.id, input.profile.configJson)

    if (this.deps.runtime.supportsResumeSession(input.profile.id)) {
      try {
        const response = await this.deps.runtime.resumeSession(input.profile.id, storedSessionId, input.workspacePath)
        return {
          ...input.runtimeSession,
          providerStateSnapshot: JSON.stringify({
            models: response.models ?? null,
            configOptions: response.configOptions ?? [],
          }),
        }
      }
      catch {
        // fall back to load/new session below
      }
    }

    if (this.deps.runtime.supportsLoadSession(input.profile.id)) {
      try {
        const response = await this.deps.runtime.loadSession(input.profile.id, storedSessionId, input.workspacePath)
        return {
          ...input.runtimeSession,
          providerStateSnapshot: JSON.stringify({
            models: response.models ?? null,
            configOptions: response.configOptions ?? [],
          }),
        }
      }
      catch {
        // fall back to new session below
      }
    }

    return this.startChatSession({
      chatSessionId: input.runtimeSession.chatSessionId,
      profile: input.profile,
      workspacePath: input.workspacePath,
      modelId: input.modelId,
    })
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<TimelineInputEvent, void, void> {
    const acpSessionId = input.runtimeSession.providerSessionId
    if (!acpSessionId) {
      throw new Error('Cannot stream ACP turn without a provider session ID')
    }

    await this.ensureConnected(input.profile.id, input.profile.configJson)
    this._lastUsage = null

    for await (const event of this.deps.runtime.prompt(input.profile.id, acpSessionId, input.message)) {
      yield event
    }

    this._lastUsage = this.deps.runtime.getLastUsage(input.profile.id, acpSessionId)
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const acpSessionId = input.runtimeSession.providerSessionId
    if (!acpSessionId) {
      return
    }

    try {
      await this.deps.runtime.cancel(input.profile.id, acpSessionId)
    }
    catch {
      // ACP cancel failures are non-fatal for the unified chat runtime.
    }
  }

  private async ensureConnected(agentId: string, configJson: string): Promise<void> {
    if (this.deps.runtime.isConnected(agentId)) {
      return
    }
    await this.deps.runtime.connect(agentId, buildAcpConnectionRecord(configJson))
  }
}