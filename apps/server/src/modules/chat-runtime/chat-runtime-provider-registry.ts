// Input: credential-backed runtime profile store and concrete providers
// Output: runtime provider registry for chat-runtime module
// Position: apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts

import { inject, injectable } from 'tsyringe'

import { ObservabilityService } from '../observability/observability.service'
import type { ProviderKind } from '../providers/types'
import { SecretsService } from '../secrets/secrets.service'
import { AcpConnectionManager } from './providers/acp/connection-manager'
import { AcpChatProvider } from './providers/acp/provider'
import { AcpRuntimeIntegration } from './providers/acp/runtime-integration'
import { ClaudeAgentProvider } from './providers/claude-agent/provider'
import { CodexProvider } from './providers/codex/provider'
import { OpenAICompatibleProvider } from './providers/openai-compatible/provider'
import type { ChatRuntimeProvider } from './runtime-provider-types'

@injectable()
export class ChatRuntimeProviderRegistry {
  private readonly providers = new Map<ProviderKind, ChatRuntimeProvider>()

  constructor(
    @inject(SecretsService) secrets: SecretsService,
    @inject(ObservabilityService) observability: ObservabilityService,
    @inject(AcpConnectionManager) acpRuntime: AcpConnectionManager,
    @inject(AcpRuntimeIntegration) _acpRuntimeIntegration: AcpRuntimeIntegration,
  ) {
    this.register(new AcpChatProvider({ runtime: acpRuntime }))
    this.register(new OpenAICompatibleProvider({
      readSecret: secretRef => secrets.readSecret(secretRef),
    }))
    this.register(new ClaudeAgentProvider({
      readSecret: secretRef => secrets.readSecret(secretRef),
    }))
    this.register(new CodexProvider({
      readSecret: secretRef => secrets.readSecret(secretRef),
      observability,
    }))
  }

  register(provider: ChatRuntimeProvider): void {
    this.providers.set(provider.providerKind, provider)
  }

  get(providerKind: ProviderKind): ChatRuntimeProvider | undefined {
    return this.providers.get(providerKind)
  }
}
