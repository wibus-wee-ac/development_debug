// Input: issue-agent service
// Output: issue-agent-session resource endpoints for activities and reruns
// Position: apps/server/src/modules/issue-agent/issue-agent-session.controller.ts

import { Body, Controller, Get, Param, Post } from '@tsuki-hono/common'
import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { IssueAgentService } from './issue-agent.service'

type RerunBody = { agentId?: string }

@injectable()
@Controller('issue-agent-sessions')
export class IssueAgentSessionController {
  constructor(@inject(IssueAgentService) private readonly service: IssueAgentService) {}

  @Get('/:agentSessionId/activities')
  listActivities(@Param('agentSessionId') agentSessionId: string) {
    return this.service.listActivities(requireNonBlankString(agentSessionId, 'agentSessionId'))
  }

  @Post('/:agentSessionId/rerun')
  rerun(@Param('agentSessionId') agentSessionId: string, @Body() body?: RerunBody) {
    return this.service.rerunSession({
      agentSessionId: requireNonBlankString(agentSessionId, 'agentSessionId'),
      agentId: normalizeOptionalString(body?.agentId),
    })
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