// Input: issue-agent service
// Output: kanban issue-scoped delegation and agent-session listing endpoints
// Position: apps/server/src/modules/issue-agent/kanban-issue-delegation.controller.ts

import { Body, Controller, Delete, Get, Param, Post } from '@tsuki-hono/common'
import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { IssueAgentService } from './issue-agent.service'

type DelegationBody = { agentProfileId?: string, agentId?: string }

@injectable()
@Controller('kanban/issues')
export class KanbanIssueDelegationController {
  constructor(@inject(IssueAgentService) private readonly service: IssueAgentService) {}

  @Get('/:issueId/delegation')
  getDelegation(@Param('issueId') issueId: string) {
    return this.service.getDelegation(requireNonBlankString(issueId, 'issueId'))
  }

  @Post('/:issueId/delegation')
  delegate(@Param('issueId') issueId: string, @Body() body?: DelegationBody) {
    return this.service.delegateIssue({
      issueId: requireNonBlankString(issueId, 'issueId'),
      agentProfileId: requireNonBlankString(body?.agentProfileId, 'agentProfileId'),
      agentId: normalizeOptionalString(body?.agentId),
    })
  }

  @Delete('/:issueId/delegation')
  async undelegate(@Param('issueId') issueId: string) {
    await this.service.undelegateIssue(requireNonBlankString(issueId, 'issueId'))
    return { ok: true }
  }

  @Get('/:issueId/agent-sessions')
  listSessions(@Param('issueId') issueId: string) {
    return this.service.listSessions(requireNonBlankString(issueId, 'issueId'))
  }
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new AppError({
      code: 'invalid_issue_agent_input',
      status: 400,
      message: `${field} is required`,
    })
  }
  return trimmed
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}