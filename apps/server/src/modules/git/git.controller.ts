// Input: git service
// Output: workspace-owned HTTP endpoints for git status, branches, graph, checkout, create-branch, and fetch
// Position: apps/server/src/modules/git/git.controller.ts

import { Body, Controller, Get, Param, Post, Query } from '@tsuki-hono/common'
import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { GitService } from './git.service'

type CheckoutBody = { branch?: string }
type CreateBranchBody = { name?: string, from?: string }

@injectable()
@Controller('workspaces')
export class GitController {
  constructor(@inject(GitService) private readonly service: GitService) {}

  @Get('/:workspaceId/git/status')
  status(@Param('workspaceId') workspaceId: string) {
    return this.service.getStatus(requireNonBlankString(workspaceId, 'workspaceId'))
  }

  @Get('/:workspaceId/git/branches')
  branches(@Param('workspaceId') workspaceId: string) {
    return this.service.getBranches(requireNonBlankString(workspaceId, 'workspaceId'))
  }

  @Get('/:workspaceId/git/graph')
  graph(@Param('workspaceId') workspaceId: string, @Query('limit') limit?: string) {
    return this.service.getGraph(requireNonBlankString(workspaceId, 'workspaceId'), parseLimit(limit))
  }

  @Post('/:workspaceId/git/checkout')
  async checkout(@Param('workspaceId') workspaceId: string, @Body() body?: CheckoutBody) {
    await this.service.checkout(
      requireNonBlankString(workspaceId, 'workspaceId'),
      requireNonBlankString(body?.branch, 'branch'),
    )
    return { ok: true }
  }

  @Post('/:workspaceId/git/branches')
  async createBranch(@Param('workspaceId') workspaceId: string, @Body() body?: CreateBranchBody) {
    await this.service.createBranch(
      requireNonBlankString(workspaceId, 'workspaceId'),
      requireNonBlankString(body?.name, 'name'),
      normalizeOptionalString(body?.from),
    )
    return { ok: true }
  }

  @Post('/:workspaceId/git/fetch')
  async fetch(@Param('workspaceId') workspaceId: string) {
    await this.service.fetch(requireNonBlankString(workspaceId, 'workspaceId'))
    return { ok: true }
  }
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new AppError({
      code: 'invalid_git_input',
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

function parseLimit(value: string | undefined): number {
  if (!value) {
    return 100
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError({
      code: 'invalid_git_input',
      status: 400,
      message: 'limit must be a positive integer',
    })
  }
  return parsed
}
