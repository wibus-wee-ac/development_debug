import { Elysia } from 'elysia'

import { ChatRuntimeModel } from './model'
import * as ChatRuntime from './service'

export const chatRuntime = new Elysia({
  prefix: '/chat',
  detail: { tags: ['chat-runtime'] },
})
  // POST /chat/sessions/:sessionId/response → SSE stream (send message + get streaming response)
  .post('/sessions/:sessionId/response', async ({ params, body }) => {
    const stream = await ChatRuntime.streamResponse({
      sessionId: params.sessionId,
      text: body.text,
      modelId: body.modelId?.trim() || undefined,
      thinkingEffort: body.thinkingEffort,
    })
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      },
    })
  }, {
    detail: { summary: 'Send message and stream response via SSE' },
    params: ChatRuntimeModel.sessionIdParams,
    body: ChatRuntimeModel.responseBody,
  })
  // GET /chat/sessions/:sessionId/messages → historical message groups
  .get('/sessions/:sessionId/messages', ({ params }) => {
    return ChatRuntime.getMessageGroups(params.sessionId)
  }, {
    detail: {
      summary: 'Get chat message groups',
      'x-cradle-cli': {
        command: ['chat', 'messages'],
      },
    },
    params: ChatRuntimeModel.sessionIdParams,
  })
  // POST /chat/sessions/:sessionId/cancel → abort active run
  .post('/sessions/:sessionId/cancel', async ({ params }) => {
    await ChatRuntime.cancelSession(params.sessionId)
    return { ok: true as const }
  }, {
    detail: {
      summary: 'Cancel active run for session',
      'x-cradle-cli': {
        command: ['chat', 'cancel'],
      },
    },
    params: ChatRuntimeModel.sessionIdParams,
    response: { 200: ChatRuntimeModel.cancelResponse },
  })
