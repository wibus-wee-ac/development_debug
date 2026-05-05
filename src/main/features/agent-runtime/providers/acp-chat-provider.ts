// Input: AcpConnectionManager, AgentProfile, and typed runtime provider contracts
// Output: AcpChatProvider implementing ChatRuntimeProvider for ACP-based agents
// Position: Concrete chat provider for acp-chat profiles; wraps existing ACP transport

import { acpConnectionManager } from '../../../platform/acp/acp-connection'
import type { TimelineInputEvent } from '../../backend-control-plane/timeline-events'
import type {
  AgentProfile,
  AgentProvider,
  CancelTurnInput,
  ChatRuntimeProvider,
  ModelDescriptor,
  ProviderProbeResult,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
  TokenUsage,
} from '../runtime-provider-types'

interface AcpConfig {
  distributionType?: string
  installPath?: string | null
  cmd?: string
  packageName?: string
  args?: string[]
  env?: Record<string, string>
}

function parseAcpConfig(configJson: string): AcpConfig {
  try {
    const parsed = JSON.parse(configJson) as AcpConfig
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  }
  catch {
    return {}
  }
}

function buildConnectionRecord(configJson: string): {
  distributionType: string
  installPath: string | null
  cmd: string | null
  args: string
  env: string
} {
  const config = parseAcpConfig(configJson)
  return {
    distributionType: config.distributionType ?? 'npx',
    installPath: config.installPath ?? null,
    cmd: config.cmd ?? config.packageName ?? '',
    args: JSON.stringify(Array.isArray(config.args) ? config.args : []),
    env: JSON.stringify(config.env && typeof config.env === 'object' ? config.env : {}),
  }
}

export class AcpChatProvider implements ChatRuntimeProvider {
  readonly providerKind = 'acp-chat' as const

  private get connMgr() {
    return acpConnectionManager
  }

  get lastUsage(): TokenUsage | null {
    return this.connMgr.lastUsage ?? null
  }

  async probe(profile: AgentProfile): Promise<ProviderProbeResult> {
    const config = parseAcpConfig(profile.configJson)
    const cmd = config.cmd ?? config.packageName ?? ''
    if (!cmd) {
      return {
        ok: false,
        label: profile.name,
        version: null,
        details: {},
        errorText: 'ACP agent command (cmd) is required in configJson',
      }
    }
    return {
      ok: true,
      label: profile.name,
      version: null,
      details: { distributionType: config.distributionType ?? 'npx', cmd },
      errorText: null,
    }
  }

  async listModels(profile: AgentProfile): Promise<ModelDescriptor[]> {
    // ACP models are dynamic and only advertised after session creation;
    // ensure the agent process is running before starting a probe session.
    await this.ensureConnected(profile)
    const resp = await this.connMgr.newSession(profile.id, '/')
    const availableModels = resp.models?.availableModels ?? []
    return availableModels.map(m => ({
      id: String(m.modelId),
      label: m.name,
      providerKind: this.providerKind,
      contextWindow: null,
    }))
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const { profile, workspacePath, modelId } = input
    await this.ensureConnected(profile)
    const resp = await this.connMgr.newSession(
      profile.id,
      workspacePath,
    )
    // ACP model is selected after session creation via a separate protocol call
    if (modelId && resp.sessionId) {
      try {
        await this.connMgr.setSessionModel(profile.id, resp.sessionId, modelId)
      }
      catch (err) {
        console.warn('[AcpChatProvider] setSessionModel failed (will use default):', err)
      }
    }
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      agentProfileId: profile.id,
      providerKind: this.providerKind,
      providerSessionId: resp.sessionId,
      providerStateSnapshot: JSON.stringify({ models: resp.models, configOptions: resp.configOptions }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const { profile, runtimeSession, workspacePath } = input
    const storedAcpSessionId = runtimeSession.providerSessionId
    if (!storedAcpSessionId) {
      return this.startChatSession({
        chatSessionId: runtimeSession.chatSessionId,
        profile,
        workspacePath,
      })
    }
    await this.ensureConnected(profile)
    // Try resume, then load, then fall back to new session
    if (this.connMgr.supportsResumeSession(profile.id)) {
      try {
        const response = await this.connMgr.resumeSession(
          profile.id,
          storedAcpSessionId,
          workspacePath,
        )
        return {
          ...runtimeSession,
          providerStateSnapshot: JSON.stringify({
            models: response.models ?? null,
            configOptions: response.configOptions ?? [],
          }),
        }
      }
      catch {
        // fall through
      }
    }
    if (this.connMgr.supportsLoadSession(profile.id)) {
      try {
        const response = await this.connMgr.loadSession(
          profile.id,
          storedAcpSessionId,
          workspacePath,
        )
        return {
          ...runtimeSession,
          providerStateSnapshot: JSON.stringify({
            models: response.models ?? null,
            configOptions: response.configOptions ?? [],
          }),
        }
      }
      catch {
        // fall through
      }
    }
    return this.startChatSession({
      chatSessionId: runtimeSession.chatSessionId,
      profile,
      workspacePath,
    })
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<TimelineInputEvent, void, void> {
    const { runtimeSession, profile, message } = input
    const acpSessionId = runtimeSession.providerSessionId
    if (!acpSessionId) {
      throw new Error('Cannot stream turn: no ACP session ID in runtime session')
    }
    await this.ensureConnected(profile)
    const gen = this.connMgr.prompt(profile.id, acpSessionId, message)
    for await (const event of gen) {
      yield event
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const { runtimeSession, profile } = input
    const acpSessionId = runtimeSession.providerSessionId
    if (!acpSessionId) {
      return
    }
    try {
      await this.connMgr.cancel(profile.id, acpSessionId)
    }
    catch {
      // cancel errors are non-fatal
    }
  }

  private async ensureConnected(profile: AgentProfile): Promise<void> {
    if (this.connMgr.isConnected(profile.id)) {
      return
    }
    await this.connMgr.connect(profile.id, buildConnectionRecord(profile.configJson))
  }
}

// Satisfy AgentProvider type (AcpChatProvider already implements it via ChatRuntimeProvider)
export const acpChatProvider: AgentProvider = new AcpChatProvider()
