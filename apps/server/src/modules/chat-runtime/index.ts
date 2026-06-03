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
      contextParts: body.contextParts,
      messages: body.messages as Parameters<typeof ChatRuntime.streamResponse>[0]['messages'],
      providerTargetId: body.providerTargetId?.trim() || undefined,
      modelId: body.modelId?.trim() || undefined,
      thinkingEffort: body.thinkingEffort,
      permissionMode: body.permissionMode,
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
          description: 'Server-sent event stream encoded as AI SDK UIMessageChunk JSON frames. The stream emits chunks such as `start`, `text-start`, `text-delta`, `tool-input-available`, `tool-approval-request`, `tool-output-available`, `finish`, `abort`, and `error`.',
          content: {
            'text/event-stream': {
              schema: {
                type: 'string',
              },
              example: 'data: {"type":"start","messageId":"msg_main"}\n\ndata: {"type":"text-start","id":"text_1"}\n\ndata: {"type":"text-delta","id":"text_1","delta":"Hello"}\n\ndata: {"type":"text-end","id":"text_1"}\n\ndata: {"type":"finish","finishReason":"stop"}\n\ndata: [DONE]\n\n',
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
    const activeRun = ChatRuntime.getActiveSessionRun(params.sessionId)
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        ...(activeRun ? { 'x-cradle-run-id': activeRun.runId } : {}),
      },
    })
  }, {
    detail: {
      summary: 'Subscribe to the active chat run stream for an existing session',
      responses: {
        200: {
          description: 'AI SDK UIMessageChunk SSE stream for the currently active chat run. The stream replays buffered protocol chunks before forwarding live chunks, so late subscribers can rebuild the active assistant message through the AI SDK stream reader.',
          content: {
            'text/event-stream': {
              schema: {
                type: 'string',
              },
              example: 'data: {"type":"text-delta","id":"text_1","delta":" world"}\n\ndata: {"type":"text-end","id":"text_1"}\n\ndata: {"type":"finish","finishReason":"stop"}\n\ndata: [DONE]\n\n',
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
      contextParts: body.contextParts,
      providerTargetId: body.providerTargetId?.trim() || undefined,
      modelId: body.modelId?.trim() || undefined,
      thinkingEffort: body.thinkingEffort,
      permissionMode: body.permissionMode,
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
  // GET /chat/draft-runtime-capabilities?runtimeKind=... -> provider-owned pre-session composer capabilities
  .get('/draft-runtime-capabilities', ({ query }) => {
    return ChatRuntime.getDraftRuntimeCapabilities(query.runtimeKind)
  }, {
    detail: {
      summary: 'Get draft chat runtime capabilities',
    },
    query: ChatRuntimeModel.draftRuntimeCapabilitiesQuery,
    response: { 200: ChatRuntimeModel.capabilities },
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
  // GET /chat/sessions/:sessionId/ui-slot-states -> provider-owned composer-adjacent state
  .get('/sessions/:sessionId/ui-slot-states', ({ params }) => {
    return ChatRuntime.getUiSlotStates(params.sessionId)
  }, {
    detail: {
      summary: 'Get provider-owned chat UI slot states',
    },
    params: ChatRuntimeModel.sessionIdParams,
    response: { 200: ChatRuntimeModel.uiSlotStates },
  })
  // GET /chat/sessions/:sessionId/runtime-status → server-owned runtime session/run status
  .get('/sessions/:sessionId/runtime-status', ({ params }) => {
    return ChatRuntime.getRuntimeSessionStatus(params.sessionId)
  }, {
    detail: {
      summary: 'Get chat runtime session status',
    },
    params: ChatRuntimeModel.sessionIdParams,
    response: { 200: ChatRuntimeModel.runtimeStatus },
  })
  // GET /chat/sessions/:sessionId/codex/app-server/capabilities -> generated Codex app-server surface
  .get('/sessions/:sessionId/codex/app-server/capabilities', ({ params }) => {
    ChatRuntime.getRuntimeSessionStatus(params.sessionId)
    return ChatRuntime.getCodexAppServerCapabilityManifest()
  }, {
    detail: {
      summary: 'Get Codex app-server protocol capabilities exposed by Cradle',
    },
    params: ChatRuntimeModel.sessionIdParams,
    response: { 200: ChatRuntimeModel.codexAppServerCapabilities },
  })
  // POST /chat/sessions/:sessionId/codex/app-server/invoke -> invoke any generated app-server method
  .post('/sessions/:sessionId/codex/app-server/invoke', async ({ params, body }) => {
    return await ChatRuntime.invokeCodexAppServer({
      sessionId: params.sessionId,
      method: body.method,
      params: body.params,
      providerTargetId: body.providerTargetId?.trim() || undefined,
      modelId: body.modelId?.trim() || undefined,
    })
  }, {
    detail: {
      summary: 'Invoke a Codex app-server JSON-RPC method through the session runtime',
    },
    params: ChatRuntimeModel.sessionIdParams,
    body: ChatRuntimeModel.codexAppServerInvokeBody,
    response: { 200: ChatRuntimeModel.codexAppServerInvokeResponse },
  })
  // POST /chat/sessions/:sessionId/codex/app-server/stream -> invoke app-server method and stream notifications
  .post('/sessions/:sessionId/codex/app-server/stream', async ({ params, body }) => {
    const stream = await ChatRuntime.openCodexAppServerStream({
      sessionId: params.sessionId,
      method: body.method,
      params: body.params,
      providerTargetId: body.providerTargetId?.trim() || undefined,
      modelId: body.modelId?.trim() || undefined,
      closeOnMethods: body.closeOnMethods,
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
      summary: 'Invoke a Codex app-server method and stream raw notifications as SSE',
      responses: {
        200: {
          description: 'Server-sent events with `request_started`, `notification`, `server_request`, `result`, `error`, and `done` events.',
          content: {
            'text/event-stream': {
              schema: { type: 'string' },
            },
          },
        },
      },
    },
    params: ChatRuntimeModel.sessionIdParams,
    body: ChatRuntimeModel.codexAppServerStreamBody,
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
  // POST /chat/sessions/:sessionId/permission-mode → switch runtime permission mode (bypass/plan)
  .post('/sessions/:sessionId/permission-mode', async ({ params, body }) => {
    const ok = await ChatRuntime.setSessionPermissionMode({
      sessionId: params.sessionId,
      mode: body.mode,
    })
    return { ok }
  }, {
    detail: {
      'summary': 'Switch runtime permission mode (bypassPermissions ↔ plan)',
    },
    params: ChatRuntimeModel.sessionIdParams,
    body: ChatRuntimeModel.permissionModeBody,
    response: { 200: ChatRuntimeModel.permissionModeResponse },
  })
