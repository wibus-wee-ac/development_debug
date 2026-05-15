// Input: credential-backed runtime profile store and concrete providers
// Output: runtime provider registry for chat-runtime module
// Position: apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts

import fs from 'node:fs'
import path from 'node:path'

import { record as recordObservability } from '../observability/service'
import type { ProviderKind } from '../providers/types'
import * as Secrets from '../secrets/service'
import { resolveScopeRoot } from '../skills/skills-paths'
import { AcpConnectionManager } from './providers/acp/connection-manager'
import { AcpProcessManager } from './providers/acp/process-manager'
import { AcpChatProvider } from './providers/acp/provider'
import { wireAcpIntegration } from './providers/acp/runtime-integration'
import { ClaudeAgentProvider } from './providers/claude-agent/provider'
import { CodexProvider } from './providers/codex/provider'
import { MockClaudeAgentProvider } from './providers/mock-claude-agent/provider'
import { OpenAICompatibleProvider } from './providers/openai-compatible/provider'
import { SystemAgentProvider } from './providers/system-agent/provider'
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

/** Resolve all skill folder paths that should be given to a provider for a workspace. */
function resolveSkillPaths(workspacePath: string): string[] {
  const roots = [
    resolveScopeRoot('builtin', {}),
    resolveScopeRoot('workspace', { workspacePath }),
  ]
  const paths: string[] = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillDir = path.join(root, entry.name)
      if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
        paths.push(skillDir)
      }
    }
  }
  return paths
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
    if (process.env.CRADLE_MOCK_LLM_URL) {
      registry.register(new MockClaudeAgentProvider())
    }
    else {
      registry.register(new ClaudeAgentProvider({
        readSecret: secretRef => Secrets.readSecret(secretRef),
        resolveSkillPaths,
      }))
    }
    registry.register(new CodexProvider({
      readSecret: secretRef => Secrets.readSecret(secretRef),
      recordObservability,
      resolveSkillPaths,
    }))
    registry.register(new SystemAgentProvider({
      readSecret: secretRef => Secrets.readSecret(secretRef),
    }))
  }
  return registry
}

export function registerProvider(provider: ChatRuntimeProvider): void {
  getProviderRegistry().register(provider)
}
