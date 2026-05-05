// Input: MockLlmServer E2E support utility and Node fetch streaming APIs
// Output: Contract tests for success, error, and restart isolation behavior of the mock LLM server
// Position: Node-level regression tests guarding deterministic E2E mock provider behavior

import { afterEach, describe, expect, it } from 'vitest'

import { MockLlmServer } from '../../../e2e/src/support/mock-llm-server'

const activeServers: MockLlmServer[] = []

afterEach(async () => {
  await Promise.all(activeServers.map(server => server.stop()))
  activeServers.length = 0
})

async function readStreamText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Expected response body reader for mock stream')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const line = frame
        .split('\n')
        .find(candidate => candidate.startsWith('data: '))

      if (!line || line === 'data: [DONE]') {
        continue
      }

      const payload = JSON.parse(line.slice(6)) as {
        choices?: Array<{ delta?: { content?: string } }>
      }
      text += payload.choices?.[0]?.delta?.content ?? ''
    }
  }

  return text
}

describe('mockLlmServer', () => {
  it('streams assistant text and records handled requests', async () => {
    const server = new MockLlmServer({ responseText: 'Hello from deterministic mock server' })
    activeServers.push(server)

    const baseUrl = await server.start()
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true }),
    })

    expect(response.status).toBe(200)
    await expect(readStreamText(response)).resolves.toContain('Hello from deterministic mock server')
    expect(server.getRequestLog()).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/v1/chat/completions',
        body: expect.stringContaining('"hi"'),
      }),
    ])
  })

  it('can emulate provider HTTP failures with a deterministic error payload', async () => {
    const server = new MockLlmServer({
      failureMode: 'http-error',
      errorStatusCode: 503,
      errorMessage: 'Mock LLM forced failure',
    })
    activeServers.push(server)

    const baseUrl = await server.start()
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'boom' }], stream: true }),
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: {
        message: 'Mock LLM forced failure',
      },
    })
  })

  it('resets request history after stop/start so scenarios do not share mutable mock state', async () => {
    const server = new MockLlmServer()
    activeServers.push(server)

    const firstBaseUrl = await server.start()
    await fetch(`${firstBaseUrl}/models`)
    expect(server.getRequestLog()).toHaveLength(1)

    await server.stop()

    const secondBaseUrl = await server.start()
    expect(server.getRequestLog()).toEqual([])

    await fetch(`${secondBaseUrl}/models`)
    expect(server.getRequestLog()).toHaveLength(1)
  })
})