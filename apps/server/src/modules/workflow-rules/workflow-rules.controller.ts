// Input: workflow-rules service
// Output: HTTP endpoints for workflow-rules capability
// Position: apps/server/src/modules/workflow-rules/workflow-rules.controller.ts

import { Body, Controller, Delete, Get, Param, Put, Query } from '@tsuki-hono/common'

import { AppError } from '../../errors/app-error'
import { WorkflowRulesService } from './workflow-rules.service'

type SaveWorkflowRuleBody = {
  agentProfileId?: string | null
  content?: string
}

@Controller('workflow-rules')
export class WorkflowRulesController {
  constructor(private readonly service: WorkflowRulesService) {}

  @Get('/:workspaceId/list')
  list(@Param('workspaceId') workspaceId: string) {
    return this.service.list(normalizeRequiredId(workspaceId, 'workspaceId'))
  }

  @Get('/:workspaceId')
  get(@Param('workspaceId') workspaceId: string, @Query('agentProfileId') agentProfileId?: string) {
    return this.service.get(
      normalizeRequiredId(workspaceId, 'workspaceId'),
      normalizeOptionalId(agentProfileId, 'agentProfileId'),
    )
  }

  @Put('/:workspaceId')
  async save(@Param('workspaceId') workspaceId: string, @Body() body: SaveWorkflowRuleBody) {
    await this.service.save(
      normalizeRequiredId(workspaceId, 'workspaceId'),
      normalizeOptionalNullableId(body.agentProfileId, 'agentProfileId'),
      requireContent(body.content),
    )
    return { ok: true }
  }

  @Delete('/:workspaceId')
  async remove(@Param('workspaceId') workspaceId: string, @Query('agentProfileId') agentProfileId?: string) {
    await this.service.delete(
      normalizeRequiredId(workspaceId, 'workspaceId'),
      normalizeOptionalId(agentProfileId, 'agentProfileId') ?? null,
    )
    return { ok: true }
  }
}

function normalizeRequiredId(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw invalidWorkflowRuleId(`${field} is required`)
  }
  return trimmed
}

function normalizeOptionalId(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  return normalizeRequiredId(value, field)
}

function normalizeOptionalNullableId(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) {
    return null
  }
  return normalizeRequiredId(value, field)
}

function requireContent(content: string | undefined): string {
  if (typeof content !== 'string') {
    throw new AppError({
      code: 'invalid_workflow_rule_input',
      status: 400,
      message: 'content must be a string',
    })
  }
  return content
}

function invalidWorkflowRuleId(message: string): AppError {
  return new AppError({
    code: 'invalid_workflow_rule_id',
    status: 400,
    message,
  })
}
