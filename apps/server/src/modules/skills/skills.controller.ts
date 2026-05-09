// Input: skills service
// Output: HTTP endpoints for skills capability
// Position: apps/server/src/modules/skills/skills.controller.ts

import { Body, Controller, Delete, Get, Post, Put, Query } from '@tsuki-hono/common'
import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { SkillsService } from './skills.service'
import type { SkillScope } from './skills-paths'

const skillScopes = ['builtin', 'legacy', 'global', 'workspace', 'agent'] as const satisfies readonly SkillScope[]

type ListSkillsQuery = { workspaceId?: string, agentId?: string }
type SkillLookupQuery = { scope?: SkillScope, name?: string, workspaceId?: string, agentId?: string }
type CreateSkillBody = {
  scope?: SkillScope
  name?: string
  description?: string
  body?: string
  workspaceId?: string | null
  agentId?: string | null
  frontmatter?: Record<string, unknown>
}
type UpdateSkillBody = {
  scope?: SkillScope
  name?: string
  workspaceId?: string | null
  agentId?: string | null
  document?: {
    name?: string
    description?: string
    body?: string
    frontmatter?: Record<string, unknown>
  }
}
type ImportSkillBody = {
  scope?: SkillScope
  sourceDir?: string
  overwrite?: boolean
  workspaceId?: string | null
  agentId?: string | null
}
type ExportSkillBody = {
  scope?: SkillScope
  name?: string
  destinationDir?: string
  overwrite?: boolean
  workspaceId?: string | null
  agentId?: string | null
}
type FetchSourceBody = { source?: string }
type ImportFromFetchBody = {
  sessionId?: string
  selectedDirs?: string[]
  scope?: SkillScope
  overwrite?: boolean
  workspaceId?: string | null
  agentId?: string | null
}

type CancelFetchBody = { sessionId?: string }

@injectable()
@Controller('skills')
export class SkillsController {
  constructor(@inject(SkillsService) private readonly service: SkillsService) {}

  @Get('/')
  list(@Query() query?: ListSkillsQuery) {
    return this.service.list({
      workspaceId: normalizeOptionalString(query?.workspaceId),
      agentId: normalizeOptionalString(query?.agentId),
    })
  }

  @Get('/document')
  get(@Query() query?: SkillLookupQuery) {
    return this.service.get({
      scope: requireScope(query?.scope),
      name: requireNonBlankString(query?.name, 'name'),
      workspaceId: normalizeOptionalString(query?.workspaceId),
      agentId: normalizeOptionalString(query?.agentId),
    })
  }

  @Post('/')
  create(@Body() body?: CreateSkillBody) {
    return this.service.create({
      scope: requireScope(body?.scope),
      name: requireNonBlankString(body?.name, 'name'),
      description: requireNonBlankString(body?.description, 'description'),
      body: requireString(body?.body, 'body'),
      workspaceId: normalizeOptionalNullableString(body?.workspaceId),
      agentId: normalizeOptionalNullableString(body?.agentId),
      frontmatter: body?.frontmatter,
    })
  }

  @Put('/document')
  update(@Body() body?: UpdateSkillBody) {
    return this.service.update({
      scope: requireScope(body?.scope),
      name: requireNonBlankString(body?.name, 'name'),
      workspaceId: normalizeOptionalNullableString(body?.workspaceId),
      agentId: normalizeOptionalNullableString(body?.agentId),
      document: {
        name: requireNonBlankString(body?.document?.name, 'document.name'),
        description: requireNonBlankString(body?.document?.description, 'document.description'),
        body: requireString(body?.document?.body, 'document.body'),
        frontmatter: body?.document?.frontmatter,
      },
    })
  }

  @Delete('/document')
  async remove(@Query() query?: SkillLookupQuery) {
    await this.service.delete({
      scope: requireScope(query?.scope),
      name: requireNonBlankString(query?.name, 'name'),
      workspaceId: normalizeOptionalString(query?.workspaceId),
      agentId: normalizeOptionalString(query?.agentId),
    })
    return { ok: true }
  }

  @Post('/import')
  import(@Body() body?: ImportSkillBody) {
    return this.service.import({
      scope: requireScope(body?.scope),
      sourceDir: requireNonBlankString(body?.sourceDir, 'sourceDir'),
      overwrite: body?.overwrite,
      workspaceId: normalizeOptionalNullableString(body?.workspaceId),
      agentId: normalizeOptionalNullableString(body?.agentId),
    })
  }

  @Post('/export')
  async export(@Body() body?: ExportSkillBody) {
    const destinationDir = await this.service.export({
      scope: requireScope(body?.scope),
      name: requireNonBlankString(body?.name, 'name'),
      destinationDir: requireNonBlankString(body?.destinationDir, 'destinationDir'),
      overwrite: body?.overwrite,
      workspaceId: normalizeOptionalNullableString(body?.workspaceId),
      agentId: normalizeOptionalNullableString(body?.agentId),
    })
    return { destinationDir }
  }

  @Post('/fetch-source')
  fetchSource(@Body() body?: FetchSourceBody) {
    return this.service.fetchSource(requireNonBlankString(body?.source, 'source'))
  }

  @Post('/import-from-fetch')
  importFromFetch(@Body() body?: ImportFromFetchBody) {
    return this.service.importFromFetch({
      sessionId: requireNonBlankString(body?.sessionId, 'sessionId'),
      selectedDirs: requireStringArray(body?.selectedDirs, 'selectedDirs'),
      scope: requireScope(body?.scope),
      overwrite: body?.overwrite,
      workspaceId: normalizeOptionalNullableString(body?.workspaceId),
      agentId: normalizeOptionalNullableString(body?.agentId),
    })
  }

  @Post('/cancel-fetch')
  async cancelFetch(@Body() body?: CancelFetchBody) {
    await this.service.cancelFetch(requireNonBlankString(body?.sessionId, 'sessionId'))
    return { ok: true }
  }
}

function requireScope(value: SkillScope | undefined): SkillScope {
  if (!value || !skillScopes.includes(value)) {
    throw invalidSkillsInput(`scope must be one of: ${skillScopes.join(', ')}`)
  }
  return value
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw invalidSkillsInput(`${field} is required`)
  }
  return trimmed
}

function requireString(value: string | undefined, field: string): string {
  if (typeof value !== 'string') {
    throw invalidSkillsInput(`${field} must be a string`)
  }
  return value
}

function requireStringArray(value: string[] | undefined, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || item.trim().length === 0)) {
    throw invalidSkillsInput(`${field} must be a non-empty string array`)
  }
  return value
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function normalizeOptionalNullableString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null
  }
  return requireNonBlankString(value, 'value')
}

function invalidSkillsInput(message: string): AppError {
  return new AppError({
    code: 'invalid_skills_input',
    status: 400,
    message,
  })
}
