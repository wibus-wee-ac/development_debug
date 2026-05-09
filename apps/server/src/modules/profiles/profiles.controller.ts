// Input: profiles service
// Output: HTTP endpoints for saved profile lifecycle
// Position: apps/server/src/modules/profiles/profiles.controller.ts

import { Body, Controller, Delete, Get, Param, Put, ZodSchema } from '@tsuki-hono/common'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { acpChatConfigSchema, cliTuiConfigSchema } from '../../helpers/provider-config-schemas'
import {
  ClaudeAgentConfigSchema,
  CodexConfigSchema,
  OpenAICompatibleConfigSchema,
} from '../providers/provider-base'
import { ProfilesService } from './profiles.service'

const nullableRefSchema = z.string().trim().min(1).nullable().optional()

const upsertProfileBodySchema = z.discriminatedUnion('providerKind', [
  z.object({
    name: z.string().trim().min(1),
    providerKind: z.literal('openai-compatible'),
    enabled: z.boolean(),
    config: OpenAICompatibleConfigSchema,
    credentialRef: nullableRefSchema,
  }),
  z.object({
    name: z.string().trim().min(1),
    providerKind: z.literal('codex'),
    enabled: z.boolean(),
    config: CodexConfigSchema,
    credentialRef: nullableRefSchema,
  }),
  z.object({
    name: z.string().trim().min(1),
    providerKind: z.literal('claude-agent'),
    enabled: z.boolean(),
    config: ClaudeAgentConfigSchema,
    credentialRef: nullableRefSchema,
  }),
  z.object({
    name: z.string().trim().min(1),
    providerKind: z.literal('acp-chat'),
    enabled: z.boolean(),
    config: acpChatConfigSchema,
    credentialRef: nullableRefSchema,
  }),
  z.object({
    name: z.string().trim().min(1),
    providerKind: z.literal('cli-tui'),
    enabled: z.boolean(),
    config: cliTuiConfigSchema,
    credentialRef: nullableRefSchema,
  }),
])

type UpsertProfileBodyInput = z.infer<typeof upsertProfileBodySchema>

@ZodSchema(upsertProfileBodySchema)
class UpsertProfileBody {}

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly service: ProfilesService) {}

  @Get('/')
  listProfiles() {
    return this.service.listProfiles()
  }

  @Get('/:id')
  getProfile(@Param('id') id: string) {
    return this.service.getProfile(requireNonBlankString(id, 'id'))
  }

  @Put('/:id')
  upsertProfile(@Param('id') id: string, @Body() body?: UpsertProfileBody) {
    const parsed = upsertProfileBodySchema.safeParse(body as UpsertProfileBodyInput | undefined)
    if (!parsed.success) {
      throw invalidProfileInput(parsed.error.issues.map(issue => issue.message).join('; '))
    }

    return this.service.upsertProfile({
      id: requireNonBlankString(id, 'id'),
      name: parsed.data.name,
      providerKind: parsed.data.providerKind,
      enabled: parsed.data.enabled,
      configJson: JSON.stringify(parsed.data.config),
      credentialRef: normalizeNullableString(parsed.data.credentialRef, 'credentialRef'),
    })
  }

  @Delete('/:id')
  removeProfile(@Param('id') id: string) {
    this.service.removeProfile(requireNonBlankString(id, 'id'))
    return { ok: true }
  }
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw invalidProfileInput(`${field} is required`)
  }
  return trimmed
}

function normalizeNullableString(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) {
    return null
  }
  return requireNonBlankString(value, field)
}

function invalidProfileInput(message: string): AppError {
  return new AppError({
    code: 'invalid_profile_input',
    status: 400,
    message,
  })
}