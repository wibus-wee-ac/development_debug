// Input: WorkspaceService
// Output: HTTP endpoints for workspace module
// Position: apps/server/src/modules/workspace/workspace.controller.ts

import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@tsuki-hono/common'
import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { WorkspaceService } from './workspace.service'

type CreateWorkspaceBody = { name?: string, path?: string }
type UpdateWorkspaceBody = { name?: string }
type WriteWorkspaceFileBody = { path?: string, content?: string }

@injectable()
@Controller('workspaces')
export class WorkspaceController {
  constructor(@inject(WorkspaceService) private readonly service: WorkspaceService) {}

  @Get('/')
  list() {
    return this.service.list()
  }

  @Post('/')
  create(@Body() body: CreateWorkspaceBody) {
    const name = requireNonBlankString(body.name, 'name')
    const path = requireNonBlankString(body.path, 'path')
    return this.service.create({ name, path })
  }

  @Post('/from-directory')
  importWorkspace(@Body() body: { path?: string }) {
    const path = requireNonBlankString(body.path, 'path')
    return this.service.addFromDirectory(path)
  }

  @Get('/resolve')
  resolve(@Query('path') path?: string) {
    const resolvedPath = requireNonBlankString(path, 'path')
    return this.service.resolveByPath(resolvedPath)
  }

  @Get('/:id/files')
  listFiles(@Param('id') id: string) {
    return this.service.listFiles(id)
  }

  @Get('/:id/files/content')
  readFile(@Param('id') id: string, @Query('path') path?: string) {
    const relativePath = requireNonBlankString(path, 'path')
    return this.service.readTextFile(id, relativePath).then(content => ({ content }))
  }

  @Put('/:id/files/content')
  writeFile(@Param('id') id: string, @Body() body?: WriteWorkspaceFileBody) {
    const relativePath = requireNonBlankString(body?.path, 'path')
    const content = ensureString(body?.content, 'content')
    return this.service.writeTextFile(id, relativePath, content).then(success => ({ success }))
  }

  @Get('/:id')
  get(@Param('id') id: string) {
    return this.service.get(id)
  }

  @Patch('/:id')
  update(@Param('id') id: string, @Body() body: UpdateWorkspaceBody) {
    const name = requireNonBlankString(body.name, 'name')
    return this.service.update({ id, name })
  }

  @Delete('/:id')
  remove(@Param('id') id: string) {
    this.service.delete(id)
    return { ok: true }
  }
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new AppError({
      code: 'invalid_workspace_input',
      status: 400,
      message: `${field} is required`,
    })
  }
  return trimmed
}

function ensureString(value: string | undefined, field: string): string {
  if (typeof value !== 'string') {
    throw new AppError({
      code: 'invalid_workspace_input',
      status: 400,
      message: `${field} must be a string`,
    })
  }
  return value
}
