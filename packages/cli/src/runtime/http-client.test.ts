// Input: requestJson runtime HTTP helper
// Output: tests for generated-command HTTP transport behavior
// Position: packages/cli runtime test suite

import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestJson } from './http-client'

describe('requestJson', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.CRADLE_CHAT_SESSION_ID
  })

  it('projects CRADLE_CHAT_SESSION_ID into the runtime context header', async () => {
    process.env.CRADLE_CHAT_SESSION_ID = 'chat-session-1'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await requestJson({
      method: 'post',
      path: {},
      query: {},
      serverUrl: 'http://localhost:21423',
      template: '/issues/issue-1/comments',
      body: { content: 'Hello' },
    })

    expect(fetchSpy).toHaveBeenCalledWith(new URL('http://localhost:21423/issues/issue-1/comments'), expect.objectContaining({
      headers: {
        'content-type': 'application/json',
        'x-cradle-chat-session-id': 'chat-session-1',
      },
    }))
  })
})
