import { z } from 'zod'

export const BaseProviderConfig = z.object({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  enabledModels: z.array(z.string()).default([]),
  skillPaths: z.array(z.string()).default([]),
  additionalDirectories: z.array(z.string()).default([]),
})

export const OpenAICompatibleConfigSchema = BaseProviderConfig.pick({
  baseUrl: true,
  model: true,
  enabledModels: true,
}).extend({
  baseUrl: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  maxMessages: z.number().default(50),
  /** 'responses' uses OpenAI Responses API (supports reasoning); 'chat-completions' uses legacy Chat Completions API */
  apiMode: z.enum(['responses', 'chat-completions']).optional(),
})

export const CodexConfigSchema = BaseProviderConfig.extend({
  approvalPolicy: z.enum(['never', 'on-request', 'on-failure', 'untrusted']).default('on-failure'),
  sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).default('workspace-write'),
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).default('high'),
})

const ClaudeAgentModelEnvValueSchema = z.string().trim()

export const ClaudeAgentConfigSchema = BaseProviderConfig.extend({
  claudeAgent: z.object({
    modelAliases: z.object({
      haiku: ClaudeAgentModelEnvValueSchema.optional(),
      sonnet: ClaudeAgentModelEnvValueSchema.optional(),
      opus: ClaudeAgentModelEnvValueSchema.optional(),
    }).optional(),
    subagentModel: ClaudeAgentModelEnvValueSchema.optional(),
  }).optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']).default('acceptEdits'),
  allowDangerouslySkipPermissions: z.boolean().optional(),
  skills: z.union([z.literal('all'), z.array(z.string())]).optional(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  maxTurns: z.number().default(100),
})

export const SystemAgentConfigSchema = z.object({
  /** Upstream provider for jar-core (e.g. "openai", "anthropic", "google") */
  provider: z.string().nullable().default(null),
  /** Model ID to use */
  model: z.string().nullable().default(null),
  /** Base URL override for the upstream provider */
  baseUrl: z.string().nullable().default(null),
  /** API key (inline, or resolved from secretRef/credentialRef) */
  apiKey: z.string().nullable().default(null),
  /** API protocol type (e.g. "openai-completions", "anthropic-messages", "google-generative-ai") */
  api: z.string().nullable().default(null),
  /** Custom HTTP headers to pass to the upstream provider */
  headers: z.record(z.string(), z.string()).default({}),
  /** Provider-specific compatibility options */
  compat: z.record(z.string(), z.unknown()).default({}),
  /** Thinking level: how much reasoning budget to give */
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).default('medium'),
  /** Max turns before the agent stops */
  maxTurns: z.number().default(20),
})

export const OpenAICompatibleConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(OpenAICompatibleConfigSchema)

export const CodexConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(CodexConfigSchema)

export const ClaudeAgentConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(ClaudeAgentConfigSchema)

export const SystemAgentConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(SystemAgentConfigSchema)

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

const SecretRefCarrierSchema = z.object({
  credentialRef: z.string().nullable().optional(),
  secretRef: z.string().nullable().optional(),
}).transform((input) => {
  if (input.secretRef !== undefined) {
    return { secretRef: input.secretRef }
  }
  if (input.credentialRef !== undefined) {
    return { secretRef: input.credentialRef }
  }
  return { secretRef: null }
})

export function resolveApiKey(
  rawInput: SecretRefCarrier,
  configApiKey: string | undefined,
  envVar: string,
  deps: ProviderDeps,
): string | null {
  const { secretRef } = SecretRefCarrierSchema.parse(rawInput)
  if (secretRef) {
    return deps.readSecret(secretRef)
  }
  if (configApiKey) {
    return configApiKey
  }
  return process.env[envVar] ?? null
}

const TRAILING_SLASH_RE = /\/+$/

export function normalizeBaseUrl(url: string): string {
  return url.replace(TRAILING_SLASH_RE, '')
}
