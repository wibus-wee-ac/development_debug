import fs from 'node:fs'
import path from 'node:path'

import { record as recordObservability } from '../observability/service'
import { registerRuntimeProviderKinds } from '../provider-contracts/runtime-compatibility'
import type { RuntimeKind } from '../provider-contracts/types'
import * as Secrets from '../secrets/service'
import { resolveScopeRoot } from '../skills/skills-paths'
import { AcpConnectionManager } from '../chat-runtime-providers/acp/connection-manager'
import { AcpProcessManager } from '../chat-runtime-providers/acp/process-manager'
import { AcpChatProvider } from '../chat-runtime-providers/acp/provider'
import { wireAcpIntegration } from '../chat-runtime-providers/acp/runtime-integration'
import { ClaudeAgentProvider } from '../chat-runtime-providers/claude-agent/provider'
import { CodexProvider } from '../chat-runtime-providers/codex/provider'
import { MockClaudeAgentProvider } from '../chat-runtime-providers/mock-claude-agent/provider'
import { OpenAICompatibleProvider } from '../chat-runtime-providers/openai-compatible/provider'
import { SystemAgentProvider } from '../chat-runtime-providers/system-agent/provider'
import type { ChatRuntime, ChatRuntimeCatalogItem, ChatRuntimeMetadata } from './runtime-provider-types'

const SKILL_PATH_CACHE_TTL_MS = 30_000

interface SkillPathCacheEntry {
  paths: string[]
  expiresAt: number
}

export class RuntimeRegistry {
  private readonly runtimes = new Map<RuntimeKind, {
    runtime: ChatRuntime
    metadata: ChatRuntimeMetadata
    pluginOwner: string | null
  }>()

  register(runtime: ChatRuntime, metadata?: ChatRuntimeMetadata, pluginOwner: string | null = null): void {
    const existing = this.runtimes.get(runtime.runtimeKind)
    const resolvedMetadata = metadata ?? runtime.metadata ?? existing?.metadata
    if (!resolvedMetadata) {
      throw new Error(`Runtime ${runtime.runtimeKind} must declare catalog metadata.`)
    }
    if (existing && (existing.pluginOwner !== null || pluginOwner !== null)) {
      throw new Error(`Runtime ${runtime.runtimeKind} is already registered by ${existing.pluginOwner ?? 'builtin'}.`)
    }
    this.runtimes.set(runtime.runtimeKind, {
      runtime,
      metadata: {
        ...resolvedMetadata,
        providerKinds: [...resolvedMetadata.providerKinds],
        surfaces: resolvedMetadata.surfaces ? [...resolvedMetadata.surfaces] : ['chat'],
      },
      pluginOwner,
    })
    registerRuntimeProviderKinds(runtime.runtimeKind, resolvedMetadata.providerKinds)
  }

  get(runtimeKind: RuntimeKind): ChatRuntime | undefined {
    return this.runtimes.get(runtimeKind)?.runtime
  }

  unregister(runtimeKind: RuntimeKind, pluginOwner: string): void {
    const entry = this.runtimes.get(runtimeKind)
    if (entry?.pluginOwner === pluginOwner) {
      this.runtimes.delete(runtimeKind)
      registerRuntimeProviderKinds(runtimeKind, [])
    }
  }

  list(): ChatRuntimeCatalogItem[] {
    return [...this.runtimes.entries()]
      .map(([runtimeKind, entry]) => ({
        runtimeKind,
        ...entry.metadata,
        source: entry.pluginOwner ? 'plugin' as const : 'builtin' as const,
        pluginOwner: entry.pluginOwner,
      }))
      .sort((left, right) =>
        (left.sortOrder ?? 1000) - (right.sortOrder ?? 1000)
        || left.label.localeCompare(right.label)
        || left.runtimeKind.localeCompare(right.runtimeKind),
      )
  }
}

const skillPathCache = new Map<string, SkillPathCacheEntry>()

/** Resolve all skill folder paths that should be given to a runtime for a workspace. */
export function resolveRuntimeSkillPaths(workspacePath: string): string[] {
  const now = Date.now()
  const cached = skillPathCache.get(workspacePath)
  if (cached && cached.expiresAt > now) {
    return [...cached.paths]
  }

  const roots = [
    resolveScopeRoot('builtin', {}),
    resolveScopeRoot('workspace', { workspacePath }),
  ]
  const paths: string[] = []
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }
      const skillDir = path.join(root, entry.name)
      if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
        paths.push(skillDir)
      }
    }
  }
  skillPathCache.set(workspacePath, {
    paths,
    expiresAt: now + SKILL_PATH_CACHE_TTL_MS,
  })
  return [...paths]
}

let registry: RuntimeRegistry | null = null

export function getRuntimeRegistry(): RuntimeRegistry {
  if (!registry) {
    registry = new RuntimeRegistry()
    const acpRuntime = new AcpConnectionManager(new AcpProcessManager())
    wireAcpIntegration(acpRuntime)
    registry.register(new AcpChatProvider({ runtime: acpRuntime }), {
      label: 'ACP Chat',
      description: 'Cloud Agent SDK runtime',
      providerKinds: ['openai-compatible', 'anthropic', 'universal'],
      iconKey: 'custom',
      surfaces: ['chat', 'jarvis'],
      sortOrder: 40,
    })
    registry.register(new OpenAICompatibleProvider({
      readSecret: secretRef => Secrets.readSecret(secretRef),
    }), {
      label: 'Standard',
      description: 'Direct OpenAI-compatible chat runtime',
      providerKinds: ['openai-compatible', 'universal'],
      iconKey: 'custom',
      surfaces: ['chat', 'jarvis'],
      sortOrder: 50,
    })
    if (process.env.CRADLE_MOCK_LLM_URL) {
      registry.register(new MockClaudeAgentProvider(), {
        label: 'Claude Agent',
        description: 'Claude Agent SDK runtime',
        providerKinds: ['anthropic', 'universal'],
        iconKey: 'claude-agent',
        surfaces: ['chat', 'jarvis'],
        sortOrder: 30,
      })
    }
    else {
      registry.register(new ClaudeAgentProvider({
        readSecret: secretRef => Secrets.readSecret(secretRef),
        resolveSkillPaths: resolveRuntimeSkillPaths,
      }), {
        label: 'Claude Agent',
        description: 'Claude Agent SDK runtime',
        providerKinds: ['anthropic', 'universal'],
        iconKey: 'claude-agent',
        surfaces: ['chat', 'jarvis'],
        sortOrder: 30,
      })
    }
    registry.register(new CodexProvider({
      readSecret: secretRef => Secrets.readSecret(secretRef),
      updateSecretValue: (secretRef, secret) => Secrets.updateSecretValue(secretRef, secret),
      recordObservability,
      resolveSkillPaths: resolveRuntimeSkillPaths,
    }), {
      label: 'Codex',
      description: 'Codex app-server runtime',
      providerKinds: ['openai-compatible', 'universal'],
      iconKey: 'codex',
      surfaces: ['chat', 'jarvis'],
      sortOrder: 20,
    })
    registry.register(new SystemAgentProvider({
      readSecret: secretRef => Secrets.readSecret(secretRef),
      resolveSkillPaths: resolveRuntimeSkillPaths,
    }), {
      label: 'HiJarvis',
      description: 'Multi-surface AI agent with local memory',
      providerKinds: ['openai-compatible', 'anthropic', 'universal'],
      iconKey: 'hijarvis',
      surfaces: ['jarvis'],
      sortOrder: 10,
    })
  }
  return registry
}

export function registerRuntime(runtime: ChatRuntime, metadata?: ChatRuntimeMetadata, pluginOwner: string | null = null): void {
  getRuntimeRegistry().register(runtime, metadata, pluginOwner)
}

export function unregisterRuntime(runtimeKind: RuntimeKind, pluginOwner: string): void {
  getRuntimeRegistry().unregister(runtimeKind, pluginOwner)
}

export function listRuntimeCatalog(): ChatRuntimeCatalogItem[] {
  return getRuntimeRegistry().list()
}
