import { Elysia } from 'elysia'

import { ChatRuntimeModel } from './model'
import * as ChatRuntime from './service'

export const chatRuntime = new Elysia({
  prefix: '/chat',
  detail: { tags: ['chat-runtime'] },
})
  // POST /chat/sessions/:sessionId/response → SSE stream (send message + get streaming response)
  .post('/sessions/:sessionId/response', async ({ params, body }) => {
    const response = await ChatRuntime.streamResponse({
      sessionId: params.sessionId,
      text: body.text ?? '',
      files: body.files,
      providerTargetId: body.providerTargetId?.trim() || undefined,
      modelId: body.modelId?.trim() || undefined,
      thinkingEffort: body.thinkingEffort,
    })
    return new Response(response.stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'x-cradle-run-id': response.runId,
        'x-cradle-assistant-message-id': response.assistantMessageId,
        'x-cradle-user-message-id': response.userMessageId,
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
  // GET /chat/sessions/:sessionId/stream → join the active run SSE stream
  .get('/sessions/:sessionId/stream', ({ params }) => {
    const stream = ChatRuntime.openSessionRunStream(params.sessionId)
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      },
    })
  }, {
    detail: {
      summary: 'Subscribe to the active chat run stream for an existing session',
      responses: {
        200: {
          description: 'Server-sent event stream for the currently active chat run. The stream starts at subscription time and does not replay deltas already covered by the message snapshot endpoint.',
          content: {
            'text/event-stream': {
              schema: {
                type: 'string',
              },
              example: 'data: {"type":"message_delta","data":{"messageId":"msg_main","deltas":[{"seq":7,"type":"text_append","partIndex":0,"partType":"text","text":" world"}]}}\n\ndata: {"type":"run_completed","data":{"messageId":"msg_main"}}\n\n',
            },
          },
        },
      },
    },
    params: ChatRuntimeModel.sessionIdParams,
  })
  // GET /chat/sessions/:sessionId/queue → durable continuation queue
  .get('/sessions/:sessionId/queue', ({ params }) => {
    return { items: ChatRuntime.listSessionQueueItems(params.sessionId) }
  }, {
    detail: {
      'summary': 'List pending and historical chat continuation queue items',
      'x-cradle-cli': {
        command: ['chat', 'queue'],
      },
    },
    params: ChatRuntimeModel.sessionIdParams,
    response: { 200: ChatRuntimeModel.queueListResponse },
  })
  // POST /chat/sessions/:sessionId/queue → enqueue busy-session follow-up
  .post('/sessions/:sessionId/queue', async ({ params, body }) => {
    return await ChatRuntime.enqueueSessionQueueItem({
      sessionId: params.sessionId,
      mode: body.mode,
      text: body.text,
      files: body.files,
      providerTargetId: body.providerTargetId?.trim() || undefined,
      modelId: body.modelId?.trim() || undefined,
      thinkingEffort: body.thinkingEffort,
    })
  }, {
    detail: {
      'summary': 'Enqueue a chat continuation for the session',
      'x-cradle-cli': {
        command: ['chat', 'queue', 'add'],
      },
    },
    params: ChatRuntimeModel.sessionIdParams,
    body: ChatRuntimeModel.queueEnqueueBody,
    response: { 200: ChatRuntimeModel.queueItem },
  })
  // POST /chat/sessions/:sessionId/queue/reorder → reorder pending queue items
  .post('/sessions/:sessionId/queue/reorder', ({ params, body }) => {
    return { items: ChatRuntime.reorderSessionQueueItems(params.sessionId, body.queueItemIds) }
  }, {
    detail: {
      'summary': 'Reorder pending chat continuation queue items',
      'x-cradle-cli': {
        command: ['chat', 'queue', 'reorder'],
      },
    },
    params: ChatRuntimeModel.sessionIdParams,
    body: ChatRuntimeModel.queueReorderBody,
    response: { 200: ChatRuntimeModel.queueListResponse },
  })
  // DELETE /chat/sessions/:sessionId/queue/:queueItemId → cancel pending queue item
  .delete('/sessions/:sessionId/queue/:queueItemId', ({ params }) => {
    return ChatRuntime.cancelSessionQueueItem(params.sessionId, params.queueItemId)
  }, {
    detail: {
      'summary': 'Cancel a pending chat continuation queue item',
      'x-cradle-cli': {
        command: ['chat', 'queue', 'cancel'],
      },
    },
    params: ChatRuntimeModel.queueItemParams,
    response: { 200: ChatRuntimeModel.queueItem },
  })
  // GET /chat/sessions/:sessionId/capabilities → runtime-native command/skill discovery
  .get('/sessions/:sessionId/capabilities', ({ params }) => {
    return ChatRuntime.getCapabilities(params.sessionId)
  }, {
    detail: {
      summary: 'Get chat runtime capabilities',
    },
    params: ChatRuntimeModel.sessionIdParams,
    response: { 200: ChatRuntimeModel.capabilities },
  })
  // GET /chat/sessions/:sessionId/messages → historical message snapshot rows
  .get('/sessions/:sessionId/messages', ({ params }) => {
    return ChatRuntime.getMessageGroups(params.sessionId)
  }, {
    detail: {
      'summary': 'Get chat message snapshot rows',
      'x-cradle-cli': {
        command: ['chat', 'messages'],
      },
    },
    params: ChatRuntimeModel.sessionIdParams,
    response: { 200: ChatRuntimeModel.chatMessages },
  })
  // GET /chat/runs/:runId/trace → dev-mode stream trace JSONL decoded as records
  .get('/runs/:runId/trace', ({ params }) => {
    return ChatRuntime.getRunTrace(params.runId)
  }, {
    detail: {
      'summary': 'Get chat stream trace records for a run',
      'x-cradle-cli': {
        command: ['chat', 'trace', 'run'],
      },
    },
    params: ChatRuntimeModel.runIdParams,
    response: { 200: ChatRuntimeModel.runTrace },
  })
  // GET /chat/sessions/:sessionId/traces → all dev-mode stream traces for a session
  .get('/sessions/:sessionId/traces', ({ params }) => {
    return ChatRuntime.getSessionTraces(params.sessionId)
  }, {
    detail: {
      'summary': 'Get chat stream traces for a session',
      'x-cradle-cli': {
        command: ['chat', 'trace', 'session'],
      },
    },
    params: ChatRuntimeModel.sessionIdParams,
    response: { 200: ChatRuntimeModel.sessionTraces },
  })
  // POST /chat/sessions/:sessionId/cancel → abort active run
  .post('/sessions/:sessionId/cancel', async ({ params }) => {
    await ChatRuntime.cancelSession(params.sessionId)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Cancel active run for session',
      'x-cradle-cli': {
        command: ['chat', 'cancel'],
      },
    },
    params: ChatRuntimeModel.sessionIdParams,
    response: { 200: ChatRuntimeModel.cancelResponse },
  })
