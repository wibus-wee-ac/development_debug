// Input: credential-backed runtime profile store and concrete providers
// Output: runtime provider registry for chat-runtime module
// Position: apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts

import { record as recordObservability } from '../observability/service'
import type { ProviderKind } from '../providers/types'
import * as Secrets from '../secrets/service'
import { AcpConnectionManager } from './providers/acp/connection-manager'
import { AcpProcessManager } from './providers/acp/process-manager'
import { AcpChatProvider } from './providers/acp/provider'
import { wireAcpIntegration } from './providers/acp/runtime-integration'
import { ClaudeAgentProvider } from './providers/claude-agent/provider'
import { CodexProvider } from './providers/codex/provider'
import { OpenAICompatibleProvider } from './providers/openai-compatible/provider'
import type { ChatRuntimeProvider } from './runtime-provider-types'

export class ChatRuntimeProviderRegistry {
  private readonly providers = new Map<ProviderKind, ChatRuntimeProvider>()

  register(provider: ChatRuntimeProvider): void {
    this.providers.set(provider.providerKind, provider)
  }

  get(providerKind: ProviderKind): ChatRuntimeProvider | undefined {
    return this.providers.get(providerKind)
  }
}

let registry: ChatRuntimeProviderRegistry | null = null

export function getProviderRegistry(): ChatRuntimeProviderRegistry {
  if (!registry) {
    registry = new ChatRuntimeProviderRegistry()
    const acpRuntime = new AcpConnectionManager(new AcpProcessManager())
    wireAcpIntegration(acpRuntime)
    registry.register(new AcpChatProvider({ runtime: acpRuntime }))
    registry.register(new OpenAICompatibleProvider({
      readSecret: secretRef => Secrets.readSecret(secretRef),
    }))
    registry.register(new ClaudeAgentProvider({
      readSecret: secretRef => Secrets.readSecret(secretRef),
    }))
    registry.register(new CodexProvider({
      readSecret: secretRef => Secrets.readSecret(secretRef),
      recordObservability,
    }))
  }
  return registry
}

export function registerProvider(provider: ChatRuntimeProvider): void {
  getProviderRegistry().register(provider)
}
