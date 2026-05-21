import { z } from 'zod'

export const cliTuiLaunchSpecSchema = z.object({
  preset: z.string().trim().min(1).optional(),
  executable: z.string().trim().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
})

export const codexCliSessionBindingSchema = z.object({
  sessionId: z.uuid(),
  capturedAt: z.number().int().positive(),
  startedAt: z.number().int().positive(),
  workspacePath: z.string().trim().min(1),
  sourcePath: z.string().trim().min(1),
})

const agentRuntimeConfigSchema = z.object({
  systemPrompt: z.string().optional(),
  cliTui: cliTuiLaunchSpecSchema.optional(),
}).passthrough()

const sessionRuntimeConfigSchema = z.object({
  cliTuiLaunch: cliTuiLaunchSpecSchema.optional(),
  codexCliSession: codexCliSessionBindingSchema.optional(),
}).passthrough()

export type CliTuiLaunchSpec = z.infer<typeof cliTuiLaunchSpecSchema>
export type CodexCliSessionBinding = z.infer<typeof codexCliSessionBindingSchema>
export type AgentRuntimeConfig = z.infer<typeof agentRuntimeConfigSchema>

export function parseAgentRuntimeConfig(configJson?: string | null): AgentRuntimeConfig {
  try {
    const parsed = agentRuntimeConfigSchema.safeParse(JSON.parse(configJson ?? '{}'))
    return parsed.success ? parsed.data : {}
  }
  catch {
    return {}
  }
}

export function readCliTuiLaunchSpecFromAgentConfig(configJson?: string | null): CliTuiLaunchSpec | null {
  const config = parseAgentRuntimeConfig(configJson)
  return config.cliTui ?? null
}

export function buildSessionRuntimeConfigJson(input: {
  cliTuiLaunch?: CliTuiLaunchSpec | null
  codexCliSession?: CodexCliSessionBinding | null
}): string {
  const payload: Record<string, unknown> = {}
  if (input.cliTuiLaunch) {
    payload.cliTuiLaunch = {
      executable: input.cliTuiLaunch.executable,
      args: input.cliTuiLaunch.args ?? [],
      ...(input.cliTuiLaunch.env ? { env: input.cliTuiLaunch.env } : {}),
      ...(input.cliTuiLaunch.preset ? { preset: input.cliTuiLaunch.preset } : {}),
    }
  }
  if (input.codexCliSession) {
    payload.codexCliSession = input.codexCliSession
  }
  return JSON.stringify(payload)
}

export function readCliTuiLaunchSpecFromSessionConfig(configJson?: string | null): CliTuiLaunchSpec | null {
  try {
    const parsed = sessionRuntimeConfigSchema.safeParse(JSON.parse(configJson ?? '{}'))
    return parsed.success ? parsed.data.cliTuiLaunch ?? null : null
  }
  catch {
    return null
  }
}

export function readCodexCliSessionBindingFromSessionConfig(configJson?: string | null): CodexCliSessionBinding | null {
  try {
    const parsed = sessionRuntimeConfigSchema.safeParse(JSON.parse(configJson ?? '{}'))
    return parsed.success ? parsed.data.codexCliSession ?? null : null
  }
  catch {
    return null
  }
}

export function writeCodexCliSessionBindingToSessionConfig(input: {
  configJson?: string | null
  binding: CodexCliSessionBinding
}): string {
  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(input.configJson ?? '{}')
    payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  }
  catch {
    payload = {}
  }

  payload.codexCliSession = input.binding
  return JSON.stringify(payload)
}
