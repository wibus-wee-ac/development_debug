// Input: chat-runtime service
// Output: HTTP endpoints for chat-runtime capability, including SSE streaming
// Position: apps/server/src/modules/chat-runtime/chat-runtime.controller.ts

import { Body, Controller, Get, Param, Patch, Post } from '@tsuki-hono/common'
import { inject, injectable } from 'tsyringe'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { ChatRuntimeService } from './chat-runtime.service'

type CreateRunBody = {
  text?: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high'
}

const updateRunBodySchema = z.object({
  status: z.literal('aborted'),
})

type UpdateRunBody = z.infer<typeof updateRunBodySchema>

@injectable()
@Controller('chat')
export class ChatRuntimeController {
  constructor(@inject(ChatRuntimeService) private readonly service: ChatRuntimeService) {}

  @Post('/sessions/:sessionId/runs')
  createRun(@Param('sessionId') sessionId: string, @Body() body?: CreateRunBody) {
    return this.service.createRun({
      sessionId: requireNonBlankString(sessionId, 'sessionId'),
      text: requireNonBlankString(body?.text, 'text'),
      modelId: normalizeOptionalString(body?.modelId),
      thinkingEffort: body?.thinkingEffort,
    })
  }

  @Get('/sessions/:sessionId/timeline')
  timeline(@Param('sessionId') sessionId: string) {
    return this.service.getTimeline(requireNonBlankString(sessionId, 'sessionId'))
  }

  @Get('/runs/:runId/stream')
  stream(@Param('runId') runId: string) {
    const stream = this.service.openRunStream(requireNonBlankString(runId, 'runId'))
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }

  @Patch('/runs/:runId')
  async updateRun(@Param('runId') runId: string, @Body() body?: UpdateRunBody) {
    const parsed = updateRunBodySchema.safeParse(body)
    if (!parsed.success) {
      throw invalidChatRuntimeInput(parsed.error.issues.map(issue => issue.message).join('; '))
    }

    await this.service.abortRun(requireNonBlankString(runId, 'runId'))
    return { ok: true }
  }
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw invalidChatRuntimeInput(`${field} is required`)
  }
  return trimmed
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function invalidChatRuntimeInput(message: string): AppError {
  return new AppError({
    code: 'invalid_chat_runtime_input',
    status: 400,
    message,
  })
}
