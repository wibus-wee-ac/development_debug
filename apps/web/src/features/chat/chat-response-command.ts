// Input: chat session id, response request body, renderer server URL
// Output: Feature-owned command for starting a chat response POST request
// Position: Shared request boundary for chat response startup across chat entry points

import type { PostChatSessionsBySessionIdResponseData } from '~/api-gen/types.gen'
import { getServerUrl } from '~/lib/electron'

const SERVER_BASE = getServerUrl()

export type ChatResponseRequestBody = PostChatSessionsBySessionIdResponseData['body']

export function buildChatResponseRequestBody(
  body: ChatResponseRequestBody,
): ChatResponseRequestBody {
  return {
    text: body.text,
    modelId: body.modelId ?? undefined,
    thinkingEffort: body.thinkingEffort ?? undefined,
  }
}

export async function startChatResponse(args: {
  sessionId: string
  body: ChatResponseRequestBody
  signal?: AbortSignal
}): Promise<Response> {
  return fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildChatResponseRequestBody(args.body)),
    signal: args.signal,
  })
}