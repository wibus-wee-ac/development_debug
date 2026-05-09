// Input: usage service
// Output: HTTP endpoints for usage analytics
// Position: apps/server/src/modules/usage/usage.controller.ts

import { Controller, Get, Param, Query } from '@tsuki-hono/common'

import { AppError } from '../../errors/app-error'
import { UsageService } from './usage.service'

@Controller('usage')
export class UsageController {
  constructor(private readonly service: UsageService) {}

  @Get('/daily')
  daily(@Query('days') days?: string) {
    return this.service.getDailyUsage(parseOptionalPositiveInteger(days, 365))
  }

  @Get('/summary')
  summary() {
    return this.service.getUsageSummary()
  }

  @Get('/stats')
  stats() {
    return this.service.getUsageStats()
  }

  @Get('/sessions/:sessionId')
  sessionUsage(@Param('sessionId') sessionId: string) {
    return this.service.getSessionUsage(requireNonBlankString(sessionId, 'sessionId'))
  }
}

function parseOptionalPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError({
      code: 'invalid_usage_input',
      status: 400,
      message: 'days must be a positive integer',
    })
  }
  return parsed
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new AppError({
      code: 'invalid_usage_input',
      status: 400,
      message: `${field} is required`,
    })
  }
  return trimmed
}
