import { Elysia } from 'elysia'

import { AppError } from '../../errors/app-error'
import { ChatRuntimeModel } from './model'
import * as ChatRuntime from './service'

export const chatRuntime = new Elysia({
  prefix: '/chat',
  detail: { tags: ['chat-runtime'] },
})
  .post('/sessions/:sessionId/runs', async ({ params, body }) => {
    return ChatRuntime.createRun({
      sessionId: params.sessionId,
      text: body.text,
      modelId: body.modelId?.trim() || undefined,
      thinkingEffort: body.thinkingEffort,
    })
  }, {
    detail: { summary: 'Create a chat run' },
    params: ChatRuntimeModel.sessionIdParams,
    body: ChatRuntimeModel.createRunBody,
    response: { 200: ChatRuntimeModel.createRunResponse },
  })
  .get('/sessions/:sessionId/timeline', ({ params }) => {
    return ChatRuntime.getTimeline(params.sessionId)
  }, {
    detail: { summary: 'Get chat timeline' },
    params: ChatRuntimeModel.sessionIdParams,
  })
  .get('/runs/:runId/stream', ({ params }) => {
    const stream = ChatRuntime.openRunStream(params.runId)
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      },
    })
  }, {
    detail: { summary: 'Stream run events via SSE' },
    params: ChatRuntimeModel.runIdParams,
  })
  .patch('/runs/:runId', async ({ params, body }) => {
    if (body.status !== 'aborted') {
      throw new AppError({
        code: 'invalid_chat_runtime_input',
        status: 400,
        message: 'Only status "aborted" is supported',
      })
    }
    await ChatRuntime.abortRun(params.runId)
    return { ok: true as const }
  }, {
    detail: { summary: 'Update run status' },
    params: ChatRuntimeModel.runIdParams,
    body: ChatRuntimeModel.updateRunBody,
    response: { 200: ChatRuntimeModel.updateRunResponse },
  })
