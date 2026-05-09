// Input: providers service
// Output: HTTP endpoints for provider health checks and model discovery
// Position: apps/server/src/modules/providers/providers.controller.ts

import { Body, Controller, Post, ZodSchema } from '@tsuki-hono/common'
import { inject } from 'tsyringe'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { acpChatConfigSchema, cliTuiConfigSchema } from '../../helpers/provider-config-schemas'
import {
  ClaudeAgentConfigSchema,
  CodexConfigSchema,
  OpenAICompatibleConfigSchema,
} from './provider-base'
import type { ProviderRequest } from './types'
import { ProvidersService } from './providers.service'

const nullableRefSchema = z.string().trim().min(1).nullable().optional()

const providerBodySchema = z.discriminatedUnion('providerKind', [
  z.object({
    providerKind: z.literal('openai-compatible'),
    label: z.string().trim().min(1),
    config: OpenAICompatibleConfigSchema,
    secretRef: nullableRefSchema,
    profileId: nullableRefSchema,
  }),
  z.object({
    providerKind: z.literal('codex'),
    label: z.string().trim().min(1),
    config: CodexConfigSchema,
    secretRef: nullableRefSchema,
    profileId: nullableRefSchema,
  }),
  z.object({
    providerKind: z.literal('claude-agent'),
    label: z.string().trim().min(1),
    config: ClaudeAgentConfigSchema,
    secretRef: nullableRefSchema,
    profileId: nullableRefSchema,
  }),
  z.object({
    providerKind: z.literal('acp-chat'),
    label: z.string().trim().min(1),
    config: acpChatConfigSchema,
    secretRef: nullableRefSchema,
    profileId: nullableRefSchema,
  }),
  z.object({
    providerKind: z.literal('cli-tui'),
    label: z.string().trim().min(1),
    config: cliTuiConfigSchema,
    secretRef: nullableRefSchema,
    profileId: nullableRefSchema,
  }),
])

type ProviderBodyInput = z.infer<typeof providerBodySchema>

@ZodSchema(providerBodySchema)
class ProviderBody {}

@Controller('providers')
export class ProvidersController {
  constructor(@inject(ProvidersService) private readonly service: ProvidersService) {}

  @Post('/models')
  listModels(@Body() body?: ProviderBody) {
    return this.service.listModels(parseProviderBody(body as ProviderBodyInput | undefined))
  }

  @Post('/health-check')
  healthCheck(@Body() body?: ProviderBody) {
    return this.service.healthCheck(parseProviderBody(body as ProviderBodyInput | undefined))
  }
}

function normalizeNullableString(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw invalidProviderInput(`${field} must not be blank`)
  }
  return trimmed
}

function parseProviderBody(body: ProviderBodyInput | undefined): ProviderRequest {
  const parsed = providerBodySchema.safeParse(body)
  if (!parsed.success) {
    throw invalidProviderInput(parsed.error.issues.map(issue => issue.message).join('; '))
  }

  return {
    providerKind: parsed.data.providerKind,
    label: parsed.data.label,
    configJson: JSON.stringify(parsed.data.config),
    secretRef: normalizeNullableString(parsed.data.secretRef, 'secretRef'),
    profileId: normalizeNullableString(parsed.data.profileId, 'profileId'),
  }
}

function invalidProviderInput(message: string): AppError {
  return new AppError({
    code: 'invalid_provider_input',
    status: 400,
    message,
  })
}
