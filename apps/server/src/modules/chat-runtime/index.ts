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
    detail: {
      summary: 'Send message and stream response via SSE',
      responses: {
        200: {
          description: 'Server-sent event stream for chat runtime delta events (`message_delta`, `subagent_message_delta`, `run_completed`, `run_aborted`, `run_failed`). `deltas[*].seq` is monotonically increasing within a run and subagent events carry `context.parentToolCallId` for routing.',
          content: {
            'text/event-stream': {
              schema: {
                type: 'string',
              },
              example: 'data: {"type":"message_delta","data":{"messageId":"msg_main","deltas":[{"seq":0,"type":"part_add","partIndex":0,"part":{"type":"text","text":"","state":"streaming"}},{"seq":1,"type":"text_append","partIndex":0,"partType":"text","text":"Hello"},{"seq":2,"type":"text_done","partIndex":0,"partType":"text"}]}}\n\ndata: {"type":"subagent_message_delta","data":{"context":{"messageId":"msg_sub","parentMessageId":"msg_main","parentToolCallId":"tool_1","taskId":null},"deltas":[{"seq":3,"type":"part_add","partIndex":0,"part":{"type":"text","text":"","state":"streaming"}},{"seq":4,"type":"text_append","partIndex":0,"partType":"text","text":"Working..."}]}}\n\ndata: {"type":"run_completed","data":{"messageId":"msg_main"}}\n\n',
            },
          },
        },
      },
    },
    params: ChatRuntimeModel.sessionIdParams,
    body: ChatRuntimeModel.responseBody,
  })
  // GET /chat/sessions/:sessionId/messages → historical message snapshot rows
  .get('/sessions/:sessionId/messages', ({ params }) => {
    return ChatRuntime.getMessageGroups(params.sessionId)
  }, {
    detail: {
      summary: 'Get chat message snapshot rows',
      'x-cradle-cli': {
        command: ['chat', 'messages'],
      },
    },
    params: ChatRuntimeModel.sessionIdParams,
    response: { 200: ChatRuntimeModel.chatMessages },
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
