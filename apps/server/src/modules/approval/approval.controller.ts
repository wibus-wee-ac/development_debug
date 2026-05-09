// Input: approval service
// Output: HTTP endpoints for pending approval lifecycle
// Position: apps/server/src/modules/approval

import { Body, Controller, Get, Param, Post, Query } from '@tsuki-hono/common'
import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { ApprovalService } from './approval.service'
import {
  approvalResponseSchema,
  createApprovalSchema,
} from './approval.types'
import type { ApprovalResponse, CreateApprovalInput } from './approval.types'

@injectable()
@Controller('approvals')
export class ApprovalController {
  constructor(@inject(ApprovalService) private readonly service: ApprovalService) {}

  @Get('/')
  list(@Query('chatSessionId') chatSessionId?: string) {
    return this.service.listPending({
      chatSessionId: normalizeOptionalString(chatSessionId),
    })
  }

  @Post('/')
  create(@Body() body?: CreateApprovalInput) {
    const parsed = createApprovalSchema.safeParse(body)
    if (!parsed.success) {
      throw invalidApprovalInput(parsed.error.issues.map(issue => issue.message).join('; '))
    }
    return this.service.createPending(parsed.data)
  }

  @Post('/:approvalId/respond')
  respond(@Param('approvalId') approvalId: string, @Body() body?: ApprovalResponse) {
    const parsed = approvalResponseSchema.safeParse(body)
    if (!parsed.success) {
      throw invalidApprovalInput(parsed.error.issues.map(issue => issue.message).join('; '))
    }

    this.service.respond(requireNonBlankString(approvalId, 'approvalId'), parsed.data)
    return { ok: true }
  }
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw invalidApprovalInput(`${field} is required`)
  }
  return trimmed
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function invalidApprovalInput(message: string): AppError {
  return new AppError({
    code: 'invalid_approval_input',
    status: 400,
    message,
  })
}
