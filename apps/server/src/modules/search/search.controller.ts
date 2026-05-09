// Input: search service
// Output: HTTP endpoints for thread search
// Position: apps/server/src/modules/search/search.controller.ts

import { Controller, Get, Query } from '@tsuki-hono/common'

import { AppError } from '../../errors/app-error'
import { SearchService } from './search.service'

@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get('/threads')
  searchThreads(
    @Query('query') query?: string,
    @Query('workspaceId') workspaceId?: string,
    @Query('limit') limit?: string,
    @Query('snippetsPerHit') snippetsPerHit?: string,
  ) {
    return this.service.searchThreads({
      query: requireNonBlankString(query, 'query'),
      workspaceId: normalizeOptionalString(workspaceId),
      limit: parseOptionalPositiveInteger(limit, 'limit'),
      snippetsPerHit: parseOptionalPositiveInteger(snippetsPerHit, 'snippetsPerHit'),
    })
  }
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new AppError({
      code: 'invalid_search_input',
      status: 400,
      message: `${field} is required`,
    })
  }
  return trimmed
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function parseOptionalPositiveInteger(value: string | undefined, field: string): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError({
      code: 'invalid_search_input',
      status: 400,
      message: `${field} must be a positive integer`,
    })
  }
  return parsed
}
