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

export const AgentRuntimeConfigJsonSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)),
  z.null().transform(() => ({})),
  z.undefined().transform(() => ({})),
]).pipe(agentRuntimeConfigSchema)

export const SessionRuntimeConfigJsonSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)),
  z.null().transform(() => ({})),
  z.undefined().transform(() => ({})),
]).pipe(sessionRuntimeConfigSchema)

export type CliTuiLaunchSpec = z.infer<typeof cliTuiLaunchSpecSchema>
export type CodexCliSessionBinding = z.infer<typeof codexCliSessionBindingSchema>
export type AgentRuntimeConfig = z.infer<typeof agentRuntimeConfigSchema>

export function buildSessionRuntimeConfigJson(input: {
  cliTuiLaunch?: CliTuiLaunchSpec | null
  codexCliSession?: CodexCliSessionBinding | null
}): string {
  const payload: Record<string, unknown> = {}
  if (input.cliTuiLaunch) {
    payload.cliTuiLaunch = {
      executable: input.cliTuiLaunch.executable,
      args: input.cliTuiLaunch.args,
      ...(input.cliTuiLaunch.env ? { env: input.cliTuiLaunch.env } : {}),
      ...(input.cliTuiLaunch.preset ? { preset: input.cliTuiLaunch.preset } : {}),
    }
  }
  if (input.codexCliSession) {
    payload.codexCliSession = input.codexCliSession
  }
  return JSON.stringify(payload)
}

export function writeCodexCliSessionBindingToSessionConfig(input: {
  configJson?: string | null
  binding: CodexCliSessionBinding
}): string {
  const config = SessionRuntimeConfigJsonSchema.parse(input.configJson)
  return JSON.stringify({
    ...config,
    codexCliSession: input.binding,
  })
}
