import { z } from 'zod'

const DEFAULT_CLAUDE_AGENT_ALIASES = {
  haiku: '',
  sonnet: '',
  opus: '',
}

const DEFAULT_CLAUDE_AGENT_CONFIG = {
  modelAliases: DEFAULT_CLAUDE_AGENT_ALIASES,
}

export const CliTuiLaunchConfigSchema = z.object({
  preset: z.string().optional(),
  executable: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
})

export const ClaudeAgentModelAliasesSchema = z.object({
  haiku: z.string().default(DEFAULT_CLAUDE_AGENT_ALIASES.haiku),
  sonnet: z.string().default(DEFAULT_CLAUDE_AGENT_ALIASES.sonnet),
  opus: z.string().default(DEFAULT_CLAUDE_AGENT_ALIASES.opus),
})

export const ClaudeAgentConfigSchema = z.object({
  modelAliases: ClaudeAgentModelAliasesSchema.default(DEFAULT_CLAUDE_AGENT_ALIASES),
}).passthrough()

export const AgentRuntimeConfigSchema = z.object({
  systemPrompt: z.string().default(''),
  cliTui: CliTuiLaunchConfigSchema.nullable().default(null),
  claudeAgent: ClaudeAgentConfigSchema.default(DEFAULT_CLAUDE_AGENT_CONFIG),
}).passthrough()

export const AgentRuntimeConfigJsonSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)),
  z.null().transform(() => ({})),
  z.undefined().transform(() => ({})),
]).pipe(AgentRuntimeConfigSchema)

export type AgentRuntimeConfig = z.infer<typeof AgentRuntimeConfigSchema>
export type ClaudeAgentConfig = z.infer<typeof ClaudeAgentConfigSchema>
