// Input: agent and session config JSON payloads
// Output: typed runtime config helpers for CLI TUI launch ownership
// Position: cross-module helper that normalizes agent-owned and session-owned runtime config

import { z } from 'zod'

export const cliTuiLaunchSpecSchema = z.object({
  preset: z.string().trim().min(1).optional(),
  executable: z.string().trim().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
})

const agentRuntimeConfigSchema = z.object({
  systemPrompt: z.string().optional(),
  cliTui: cliTuiLaunchSpecSchema.optional(),
}).passthrough()

const sessionRuntimeConfigSchema = z.object({
  cliTuiLaunch: cliTuiLaunchSpecSchema.optional(),
}).passthrough()

export type CliTuiLaunchSpec = z.infer<typeof cliTuiLaunchSpecSchema>
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

export function buildSessionRuntimeConfigJson(input: { cliTuiLaunch?: CliTuiLaunchSpec | null }): string {
  const payload: Record<string, unknown> = {}
  if (input.cliTuiLaunch) {
    payload.cliTuiLaunch = {
      executable: input.cliTuiLaunch.executable,
      args: input.cliTuiLaunch.args ?? [],
      ...(input.cliTuiLaunch.env ? { env: input.cliTuiLaunch.env } : {}),
      ...(input.cliTuiLaunch.preset ? { preset: input.cliTuiLaunch.preset } : {}),
    }
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
