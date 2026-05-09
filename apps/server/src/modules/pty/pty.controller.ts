// Input: pty service
// Output: HTTP endpoints for session-owned terminal runtime and SSE stream
// Position: apps/server/src/modules/pty/pty.controller.ts

import { Body, Controller, Delete, Get, Param, Post } from '@tsuki-hono/common'
import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { PtyService } from './pty.service'

type StartBody = { cols?: number, rows?: number }
type InputBody = { data?: string }
type ResizeBody = { cols?: number, rows?: number }

@injectable()
@Controller('terminal-sessions')
export class PtyController {
  constructor(@inject(PtyService) private readonly service: PtyService) {}

  @Post('/:sessionId/start-or-attach')
  startOrAttach(@Param('sessionId') sessionId: string, @Body() body?: StartBody) {
    return this.service.startOrAttach({
      sessionId: requireNonBlankString(sessionId, 'sessionId'),
      cols: requirePositiveInteger(body?.cols, 'cols'),
      rows: requirePositiveInteger(body?.rows, 'rows'),
    })
  }

  @Get('/:sessionId/stream')
  stream(@Param('sessionId') sessionId: string) {
    return new Response(this.service.openStream(requireNonBlankString(sessionId, 'sessionId')), {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }

  @Post('/:sessionId/input')
  async input(@Param('sessionId') sessionId: string, @Body() body?: InputBody) {
    this.service.writeInput({
      sessionId: requireNonBlankString(sessionId, 'sessionId'),
      data: requireNonBlankString(body?.data, 'data'),
    })
    return { ok: true }
  }

  @Post('/:sessionId/resize')
  async resize(@Param('sessionId') sessionId: string, @Body() body?: ResizeBody) {
    this.service.resize({
      sessionId: requireNonBlankString(sessionId, 'sessionId'),
      cols: requirePositiveInteger(body?.cols, 'cols'),
      rows: requirePositiveInteger(body?.rows, 'rows'),
    })
    return { ok: true }
  }

  @Delete('/:sessionId')
  async stop(@Param('sessionId') sessionId: string) {
    this.service.stop(requireNonBlankString(sessionId, 'sessionId'))
    return { ok: true }
  }
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new AppError({
      code: 'invalid_terminal_input',
      status: 400,
      message: `${field} is required`,
    })
  }
  return trimmed
}

function requirePositiveInteger(value: number | undefined, field: string): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    throw new AppError({
      code: 'invalid_terminal_input',
      status: 400,
      message: `${field} must be a positive integer`,
    })
  }
  return value
}
