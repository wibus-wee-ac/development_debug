// Input: kanban service
// Output: HTTP endpoints for kanban board, status, issue, and comment core loop
// Position: apps/server/src/modules/kanban/kanban.controller.ts

import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@tsuki-hono/common'
import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { KanbanService } from './kanban.service'

type CreateBoardBody = { workspaceId?: string, name?: string, filterConfig?: string | null }
type CreateIssueBody = {
  workspaceId?: string
  title?: string
  description?: string | null
  priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  labels?: string[]
  milestoneId?: string | null
  parentIssueId?: string | null
  statusId?: string | null
}
type UpdateIssueBody = Partial<CreateIssueBody & { assigneeKind?: string | null, assigneeId?: string | null }>
type AddCommentBody = { content?: string }

type ListBoardsQuery = { workspaceId?: string }
type ListStatusesQuery = { workspaceId?: string }
type ListMilestonesQuery = { workspaceId?: string }
type ListIssuesQuery = {
  workspaceId?: string
  milestoneId?: string
  parentIssueId?: string
  priority?: string
  labels?: string[] | string
  statusId?: string
}

@injectable()
@Controller('kanban')
export class KanbanController {
  constructor(@inject(KanbanService) private readonly service: KanbanService) {}

  @Get('/boards')
  listBoards(@Query() query?: ListBoardsQuery) {
    return this.service.listBoards(normalizeOptionalString(query?.workspaceId))
  }

  @Post('/boards')
  createBoard(@Body() body?: CreateBoardBody) {
    return this.service.createBoard({
      workspaceId: requireNonBlankString(body?.workspaceId, 'workspaceId'),
      name: requireNonBlankString(body?.name, 'name'),
      filterConfig: normalizeNullableString(body?.filterConfig),
    })
  }

  @Delete('/boards/:id')
  async deleteBoard(@Param('id') id: string) {
    this.service.deleteBoard(requireNonBlankString(id, 'id'))
    return { ok: true }
  }

  @Get('/statuses')
  listStatuses(@Query() query?: ListStatusesQuery) {
    return this.service.listStatuses(requireNonBlankString(query?.workspaceId, 'workspaceId'))
  }

  @Get('/milestones')
  listMilestones(@Query() query?: ListMilestonesQuery) {
    return this.service.listMilestones(requireNonBlankString(query?.workspaceId, 'workspaceId'))
  }

  @Get('/issues')
  listIssues(@Query() query?: ListIssuesQuery) {
    return this.service.listIssues({
      workspaceId: requireNonBlankString(query?.workspaceId, 'workspaceId'),
      milestoneId: normalizeNullableString(query?.milestoneId),
      parentIssueId: normalizeNullableString(query?.parentIssueId),
      priority: normalizeOptionalString(query?.priority),
      labels: normalizeLabels(query?.labels),
      statusId: normalizeNullableString(query?.statusId),
    })
  }

  @Get('/issues/:id')
  getIssue(@Param('id') id: string) {
    return this.service.getIssue(requireNonBlankString(id, 'id'))
  }

  @Post('/issues')
  createIssue(@Body() body?: CreateIssueBody) {
    return this.service.createIssue({
      workspaceId: requireNonBlankString(body?.workspaceId, 'workspaceId'),
      title: requireNonBlankString(body?.title, 'title'),
      description: normalizeNullableString(body?.description),
      priority: body?.priority,
      labels: body?.labels,
      milestoneId: normalizeNullableString(body?.milestoneId),
      parentIssueId: normalizeNullableString(body?.parentIssueId),
      statusId: normalizeNullableString(body?.statusId),
    })
  }

  @Patch('/issues/:id')
  updateIssue(@Param('id') id: string, @Body() body?: UpdateIssueBody) {
    return this.service.updateIssue(requireNonBlankString(id, 'id'), {
      title: normalizeOptionalString(body?.title),
      description: normalizeNullableString(body?.description),
      priority: body?.priority,
      labels: body?.labels,
      milestoneId: normalizeNullableString(body?.milestoneId),
      parentIssueId: normalizeNullableString(body?.parentIssueId),
      statusId: normalizeNullableString(body?.statusId),
      assigneeKind: normalizeNullableString(body?.assigneeKind),
      assigneeId: normalizeNullableString(body?.assigneeId),
    })
  }

  @Delete('/issues/:id')
  async deleteIssue(@Param('id') id: string) {
    this.service.deleteIssue(requireNonBlankString(id, 'id'))
    return { ok: true }
  }

  @Get('/issues/:id/comments')
  listComments(@Param('id') id: string) {
    return this.service.listComments(requireNonBlankString(id, 'id'))
  }

  @Post('/issues/:id/comments')
  addComment(@Param('id') id: string, @Body() body?: AddCommentBody) {
    return this.service.addComment({
      issueId: requireNonBlankString(id, 'id'),
      content: requireNonBlankString(body?.content, 'content'),
    })
  }

  @Delete('/comments/:id')
  async deleteComment(@Param('id') id: string) {
    this.service.deleteComment(requireNonBlankString(id, 'id'))
    return { ok: true }
  }
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw invalidKanbanInput(`${field} is required`)
  }
  return trimmed
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function normalizeNullableString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeLabels(value: string[] | string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (Array.isArray(value)) {
    return value.filter(item => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
  }
  return value.split(',').map(item => item.trim()).filter(item => item.length > 0)
}

function invalidKanbanInput(message: string): AppError {
  return new AppError({ code: 'invalid_kanban_input', status: 400, message })
}
