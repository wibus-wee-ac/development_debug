// Input: SessionService
// Output: HTTP endpoints for session module
// Position: apps/server/src/modules/session/session.controller.ts

import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@tsuki-hono/common'
import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { SessionService } from './session.service'

type CreateSessionInput = { workspaceId?: string, title?: string, agentProfileId?: string, id?: string }
type UpdateSessionInput = { title?: string, pinned?: boolean }

function ensureNonEmpty(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new AppError({
      code: 'invalid_session_input',
      status: 400,
      message: `${field} is required`,
    })
  }
  return trimmed
}

@injectable()
@Controller('sessions')
export class SessionController {
  constructor(@inject(SessionService) private readonly service: SessionService) {}

  @Get('/')
  list(@Query('workspaceId') workspaceId?: string) {
    const resolvedWorkspaceId = ensureNonEmpty(workspaceId, 'workspaceId')
    return this.service.list(resolvedWorkspaceId)
  }

  @Get('/:id')
  get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Post('/')
  create(@Body() body: CreateSessionInput) {
    const workspaceId = ensureNonEmpty(body.workspaceId, 'workspaceId')
    const title = ensureNonEmpty(body.title, 'title')
    const agentProfileId = ensureNonEmpty(body.agentProfileId, 'agentProfileId')
    return this.service.create({ id: body.id, workspaceId, title, agentProfileId })
  }

  @Patch('/:id')
  update(@Param('id') id: string, @Body() body: UpdateSessionInput) {
    const title = body.title === undefined ? undefined : ensureNonEmpty(body.title, 'title')
    const pinned = body.pinned

    if (title === undefined && pinned === undefined) {
      throw new AppError({
        code: 'invalid_session_input',
        status: 400,
        message: 'at least one of title or pinned is required',
      })
    }

    const session = this.service.update({
      id,
      title,
      pinned,
    })

    if (!session) {
      throw new AppError({
        code: 'session_not_found',
        status: 404,
        message: 'Session not found',
      })
    }

    return session
  }

  @Delete('/:id')
  remove(@Param('id') id: string) {
    this.service.delete(id)
    return { ok: true }
  }

  @Get('/:id/messages')
  getMessages(@Param('id') id: string) {
    return this.service.getMessages(id)
  }

  @Get('/:id/export/markdown')
  exportMarkdown(@Param('id') id: string) {
    return { markdown: this.service.exportMarkdown(id) }
  }
}
