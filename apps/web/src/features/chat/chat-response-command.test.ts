/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { listChatSessionQueue } from './chat-response-command'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listChatSessionQueue', () => {
  it('normalizes unsupported queue thinking effort to null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      items: [{
        id: 'queue-1',
        sessionId: 'session-1',
        mode: 'queue',
        status: 'pending',
        text: 'Continue',
        files: [],
        contextParts: [],
        providerTargetId: null,
        modelId: null,
        thinkingEffort: 'minimal',
        runtimeSettings: { accessMode: 'full-access', interactionMode: 'default' },
        position: 1,
        sourceRunId: null,
        startedRunId: null,
        errorText: null,
        createdAt: 1,
        updatedAt: 1,
      }],
    })))

    await expect(listChatSessionQueue('session-1')).resolves.toMatchObject({
      items: [{
        id: 'queue-1',
        thinkingEffort: null,
      }],
    })
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
