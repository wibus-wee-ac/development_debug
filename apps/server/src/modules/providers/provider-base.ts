// Input: provider config input, secret store, and env fallback
// Output: shared utilities for SDK-backed provider metadata/runtime implementations
// Position: apps/server/src/modules/providers/provider-base.ts

import { z } from 'zod'

export const BaseProviderConfig = z.object({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  enabledModels: z.array(z.string()).optional(),
  skillPaths: z.array(z.string()).optional(),
  additionalDirectories: z.array(z.string()).optional(),
})

export const OpenAICompatibleConfigSchema = BaseProviderConfig.pick({
  baseUrl: true,
  model: true,
  enabledModels: true,
}).extend({
  maxMessages: z.number().optional(),
  /** 'responses' uses OpenAI Responses API (supports reasoning); 'chat-completions' uses legacy Chat Completions API */
  apiMode: z.enum(['responses', 'chat-completions']).optional(),
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

export const SystemAgentConfigSchema = z.object({
  /** Upstream provider for jar-core (e.g. "openai", "anthropic", "google") */
  provider: z.string(),
  /** Model ID to use */
  model: z.string(),
  /** Base URL override for the upstream provider */
  baseUrl: z.string().optional(),
  /** API key (inline, or resolved from secretRef/credentialRef) */
  apiKey: z.string().optional(),
  /** Thinking level: how much reasoning budget to give */
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).default('medium'),
  /** Max turns before the agent stops */
  maxTurns: z.number().default(20),
})

export type BaseProviderConfigInput = z.infer<typeof BaseProviderConfig>
export type OpenAICompatibleConfig = z.infer<typeof OpenAICompatibleConfigSchema>
export type CodexConfig = z.infer<typeof CodexConfigSchema>
export type ClaudeAgentConfig = z.infer<typeof ClaudeAgentConfigSchema>
export type SystemAgentConfig = z.infer<typeof SystemAgentConfigSchema>

export interface ProviderDeps {
  readSecret: (secretRef: string) => string
  resolveSkillPaths?: (workspacePath: string) => string[]
}

export interface SecretRefCarrier {
  credentialRef?: string | null
  secretRef?: string | null
}

export function resolveApiKey(
  input: SecretRefCarrier,
  configApiKey: string | undefined,
  envVar: string,
  deps: ProviderDeps,
): string | null {
  const secretRef = input.secretRef ?? input.credentialRef ?? null
  if (secretRef) {
    return deps.readSecret(secretRef)
  }
  if (configApiKey) {
    return configApiKey
  }
  return process.env[envVar] ?? null
}

export function parseConfigWith<Schema extends z.ZodTypeAny>(
  configJson: string,
  schema: Schema,
): Partial<z.output<Schema>> {
  try {
    const raw = JSON.parse(configJson)
    const result = schema.safeParse(raw)
    return result.success ? result.data : {}
  }
  catch {
    return {}
  }
}

const TRAILING_SLASH_RE = /\/+$/

export function normalizeBaseUrl(url: string): string {
  return url.replace(TRAILING_SLASH_RE, '')
}
