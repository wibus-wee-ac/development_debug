// Input: Provider profile, credential store
// Output: Shared utilities for all chat runtime providers - Zod config, API key resolution, model list helpers
// Position: Common base for concrete provider implementations, eliminating code duplication

import { z } from 'zod'

import type { AgentProfile, ModelDescriptor, ProviderKind } from './runtime-provider-types'

// ── Zod Config Schemas ───────────────────────────────────────────────────────

export const BaseProviderConfig = z.object({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  skillPaths: z.array(z.string()).optional(),
  additionalDirectories: z.array(z.string()).optional(),
})

export const CodexConfigSchema = BaseProviderConfig.extend({
  approvalPolicy: z.enum(['never', 'on-request', 'on-failure', 'untrusted']).optional(),
  sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
})

export const ClaudeAgentConfigSchema = BaseProviderConfig.extend({
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']).optional(),
  allowDangerouslySkipPermissions: z.boolean().optional(),
  skills: z.union([z.literal('all'), z.array(z.string())]).optional(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  maxTurns: z.number().optional(),
})

export type CodexConfig = z.infer<typeof CodexConfigSchema>
export type ClaudeAgentConfig = z.infer<typeof ClaudeAgentConfigSchema>

// ── Shared Utilities ─────────────────────────────────────────────────────────

export interface ProviderDeps {
  readSecret: (credentialRef: string) => string
  resolveSkillPaths?: (workspacePath: string) => string[]
}

/**
 * Resolve API key from credential ref → config → env var.
 */
export function resolveApiKey(
  profile: AgentProfile,
  configApiKey: string | undefined,
  envVar: string,
  deps: ProviderDeps,
): string | null {
  if (profile.credentialRef) {
    return deps.readSecret(profile.credentialRef)
  }
  if (configApiKey) {
    return configApiKey
  }
  return process.env[envVar] ?? null
}

/**
 * Parse config JSON with a Zod schema. Returns partial on failure.
 */
export function parseConfigWith<T>(configJson: string, schema: z.ZodType<T>): Partial<T> {
  try {
    const raw = JSON.parse(configJson)
    const result = schema.safeParse(raw)
    return result.success ? result.data : (raw as Partial<T>)
  }
  catch {
    return {} as Partial<T>
  }
}

/**
 * Build a fallback model list from config.model or a set of known defaults.
 */
export function buildFallbackModelList(
  providerKind: ProviderKind,
  model: string | undefined,
  defaults?: Array<{ id: string, label: string, contextWindow?: number | null }>,
): ModelDescriptor[] {
  if (model) {
    return [{ id: model, label: model, providerKind, contextWindow: null }]
  }
  if (defaults) {
    return defaults.map(d => ({
      id: d.id,
      label: d.label,
      providerKind,
      contextWindow: d.contextWindow ?? null,
    }))
  }
  return []
}

const TRAILING_SLASH_RE = /\/+$/

/**
 * Strip trailing slashes from a URL.
 */
export function normalizeBaseUrl(url: string): string {
  return url.replace(TRAILING_SLASH_RE, '')
}
