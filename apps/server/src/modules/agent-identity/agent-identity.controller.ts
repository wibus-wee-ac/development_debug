// Input: AgentIdentityService
// Output: HTTP endpoints for agent identity module
// Position: apps/server/src/modules/agent-identity/agent-identity.controller.ts

import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@tsuki-hono/common'
import { injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { AgentIdentityService } from './agent-identity.service'

type ThinkingEffort = 'low' | 'medium' | 'high' | 'auto'

type CreateAgentBody = {
  name?: string
  description?: string | null
  avatarStyle?: string
  avatarSeed?: string
  agentProfileId?: string
  modelId?: string | null
  thinkingEffort?: ThinkingEffort
  configJson?: string
}

type UpdateAgentBody = {
  name?: string
  description?: string | null
  avatarStyle?: string
  avatarSeed?: string
  agentProfileId?: string
  modelId?: string | null
  thinkingEffort?: ThinkingEffort
  configJson?: string
  enabled?: boolean
}

@injectable()
@Controller('agents')
export class AgentIdentityController {
  constructor(private readonly service: AgentIdentityService) {}

  @Get('/')
  list(@Query('enabled') enabled?: string, @Query('agentProfileId') agentProfileId?: string) {
    return this.service.list({
      enabled: parseOptionalBooleanFlag(enabled),
      agentProfileId: normalizeOptionalText(agentProfileId, 'agentProfileId'),
    })
  }

  @Get('/:id')
  get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('/')
  create(@Body() body: CreateAgentBody) {
    return this.service.create({
      name: requireNonBlankString(body.name, 'name'),
      description: normalizeNullableText(body.description),
      avatarStyle: requireNonBlankString(body.avatarStyle, 'avatarStyle'),
      avatarSeed: requireNonBlankString(body.avatarSeed, 'avatarSeed'),
      agentProfileId: requireNonBlankString(body.agentProfileId, 'agentProfileId'),
      modelId: normalizeNullableText(body.modelId),
      thinkingEffort: readOptionalThinkingEffort(body.thinkingEffort),
      configJson: readOptionalString(body.configJson, 'configJson'),
    })
  }

  @Patch('/:id')
  update(@Param('id') id: string, @Body() body: UpdateAgentBody) {
    return this.service.update(id, {
      name: readOptionalNonBlankString(body.name, 'name'),
      description: body.description === undefined ? undefined : normalizeNullableText(body.description),
      avatarStyle: readOptionalNonBlankString(body.avatarStyle, 'avatarStyle'),
      avatarSeed: readOptionalNonBlankString(body.avatarSeed, 'avatarSeed'),
      agentProfileId: readOptionalNonBlankString(body.agentProfileId, 'agentProfileId'),
      modelId: body.modelId === undefined ? undefined : normalizeNullableText(body.modelId),
      thinkingEffort: readOptionalThinkingEffort(body.thinkingEffort),
      configJson: body.configJson === undefined ? undefined : readOptionalString(body.configJson, 'configJson'),
      enabled: readOptionalBoolean(body.enabled, 'enabled'),
    })
  }

  @Delete('/:id')
  remove(@Param('id') id: string) {
    this.service.delete(id)
    return { ok: true }
  }
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw invalidAgentInput(`${field} is required`)
  }
  return trimmed
}

function readOptionalNonBlankString(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  return requireNonBlankString(value, field)
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function normalizeOptionalText(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  return requireNonBlankString(value, field)
}

function readOptionalString(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw invalidAgentInput(`${field} must be a string`)
  }
  return value
}

function parseOptionalBooleanFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  throw invalidAgentInput('enabled must be true or false')
}

function readOptionalBoolean(value: boolean | undefined, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'boolean') {
    throw invalidAgentInput(`${field} must be a boolean`)
  }
  return value
}

function readOptionalThinkingEffort(value: ThinkingEffort | undefined): ThinkingEffort | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === 'low' || value === 'medium' || value === 'high' || value === 'auto') {
    return value
  }

  throw invalidAgentInput('thinkingEffort must be low, medium, high, or auto')
}

function invalidAgentInput(message: string): AppError {
  return new AppError({
    code: 'invalid_agent_input',
    status: 400,
    message,
  })
}
