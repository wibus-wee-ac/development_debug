// Input: CodexAppServerProvider with fake command resolver and RPC connection factory
// Output: Unit tests for Codex App Server probing, model mapping, thread lifecycle, and turn streaming
// Position: Provider test coverage for local Codex App Server integration

import { describe, expect, it, vi } from 'vitest'

import { CodexAppServerProvider } from '../providers/codex-app-server-provider'
import type { AgentProfile } from '../types'

const profile: AgentProfile = {
  id: 'local-codex',
  name: 'Local Codex',
  providerKind: 'codex-app-server',
  enabled: true,
  configJson: '{"executable":"codex","args":["app-server"]}',
  credentialRef: null,
  createdAt: 1,
  updatedAt: 1,
}

function makeClient(overrides: {
  request?: ReturnType<typeof vi.fn>
  onNotification?: ReturnType<typeof vi.fn>
}) {
  const notify = vi.fn().mockResolvedValue(undefined)
  const onNotification = overrides.onNotification ?? vi.fn().mockReturnValue(() => {})
  const request = overrides.request ?? vi.fn().mockResolvedValue({})
  return { request, onNotification, notify }
}

describe('codexAppServerProvider', () => {
  it('returns a structured probe failure when the codex executable is missing', async () => {
    const provider = new CodexAppServerProvider({
      resolveCommand: () => null,
      connect: vi.fn(),
    })

    await expect(provider.probe(profile)).resolves.toEqual({
      ok: false,
      label: 'Local Codex',
      version: null,
      details: { executable: 'codex' },
      errorText: 'codex executable not found',
    })
  })

  it('maps model/list results to unified model descriptors (legacy models[] format)', async () => {
    const request = vi.fn().mockResolvedValue({
      models: [
        { id: 'gpt-5.1-codex', name: 'GPT 5.1 Codex', context_window: 256000 },
        'fallback-model',
      ],
    })
    const provider = new CodexAppServerProvider({
      resolveCommand: () => '/usr/local/bin/codex',
      connect: async () => makeClient({ request }),
    })

    await expect(provider.listModels(profile)).resolves.toEqual([
      {
        id: 'gpt-5.1-codex',
        label: 'GPT 5.1 Codex',
        providerKind: 'codex-app-server',
        contextWindow: 256000,
      },
      {
        id: 'fallback-model',
        label: 'fallback-model',
        providerKind: 'codex-app-server',
        contextWindow: null,
      },
    ])
    expect(request).toHaveBeenCalledWith('model/list', {})
  })

  it('maps model/list results using v2 data[] format with displayName', async () => {
    const request = vi.fn().mockResolvedValue({
      data: [
        { id: 'gpt-5.4', displayName: 'GPT-5.4', isDefault: true },
        { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini' },
      ],
      nextCursor: null,
    })
    const provider = new CodexAppServerProvider({
      resolveCommand: () => '/usr/local/bin/codex',
      connect: async () => makeClient({ request }),
    })

    await expect(provider.listModels(profile)).resolves.toEqual([
      {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        providerKind: 'codex-app-server',
        contextWindow: null,
      },
      {
        id: 'gpt-5.4-mini',
        label: 'GPT-5.4 Mini',
        providerKind: 'codex-app-server',
        contextWindow: null,
      },
    ])
  })

  it('parses thread id from thread/start { thread: { id } } response', async () => {
    const request = vi.fn().mockResolvedValue({ thread: { id: 'thr_abc123' } })
    const provider = new CodexAppServerProvider({
      resolveCommand: () => '/usr/local/bin/codex',
      connect: async () => makeClient({ request }),
    })

    const session = await provider.startChatSession({
      chatSessionId: 'sess-1',
      profile,
      workspacePath: '/home/project',
    })

    expect(session.providerSessionId).toBe('thr_abc123')
    expect(request).toHaveBeenCalledWith('thread/start', { cwd: '/home/project' })
  })

  it('passes model to thread/start when provided', async () => {
    const request = vi.fn().mockResolvedValue({ thread: { id: 'thr_xyz' } })
    const provider = new CodexAppServerProvider({
      resolveCommand: () => '/usr/local/bin/codex',
      connect: async () => makeClient({ request }),
    })

    await provider.startChatSession({
      chatSessionId: 'sess-2',
      profile,
      workspacePath: '/home/project',
      modelId: 'gpt-5.4',
    })

    expect(request).toHaveBeenCalledWith('thread/start', { cwd: '/home/project', model: 'gpt-5.4' })
  })

  it('resumes an existing thread via thread/resume', async () => {
    const request = vi.fn().mockResolvedValue({ thread: { id: 'thr_abc123' } })
    const provider = new CodexAppServerProvider({
      resolveCommand: () => '/usr/local/bin/codex',
      connect: async () => makeClient({ request }),
    })

    const storedSession = {
      id: 'sess-1',
      chatSessionId: 'sess-1',
      agentProfileId: profile.id,
      providerKind: 'codex-app-server' as const,
      providerSessionId: 'thr_abc123',
      providerStateSnapshot: null,
    }

    const resumed = await provider.resumeChatSession({
      runtimeSession: storedSession,
      profile,
      workspacePath: '/home/project',
    })

    expect(resumed.providerSessionId).toBe('thr_abc123')
    expect(request).toHaveBeenCalledWith('thread/resume', { threadId: 'thr_abc123', cwd: '/home/project' })
  })

  it('falls back to a new thread when thread/resume fails', async () => {
    let callCount = 0
    const request = vi.fn().mockImplementation(async (method: string) => {
      callCount++
      if (method === 'thread/resume') {
        throw new Error('thread not found: thr_old')
      }
      // thread/start
      return { thread: { id: 'thr_new' } }
    })
    const provider = new CodexAppServerProvider({
      resolveCommand: () => '/usr/local/bin/codex',
      connect: async () => makeClient({ request }),
    })

    const storedSession = {
      id: 'sess-1',
      chatSessionId: 'sess-1',
      agentProfileId: profile.id,
      providerKind: 'codex-app-server' as const,
      providerSessionId: 'thr_old',
      providerStateSnapshot: null,
    }

    const fresh = await provider.resumeChatSession({
      runtimeSession: storedSession,
      profile,
      workspacePath: '/home/project',
    })

    expect(fresh.providerSessionId).toBe('thr_new')
    expect(callCount).toBe(2)
  })

  it('passes thinking_effort to turn/start when specified', async () => {
    const notificationHandlers: Record<string, (params: unknown) => void> = {}
    const request = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'turn/start') {
        setImmediate(() => {
          notificationHandlers['turn/status']?.({ threadId: 'thr_1', status: 'completed' })
        })
      }
      return {}
    })
    const onNotification = vi.fn().mockImplementation((method: string, handler: (params: unknown) => void) => {
      notificationHandlers[method] = handler
      return () => { delete notificationHandlers[method] }
    })

    const provider = new CodexAppServerProvider({
      resolveCommand: () => '/usr/local/bin/codex',
      connect: async () => makeClient({ request, onNotification }),
    })

    const runtimeSession = {
      id: 'sess-1',
      chatSessionId: 'sess-1',
      agentProfileId: profile.id,
      providerKind: 'codex-app-server' as const,
      providerSessionId: 'thr_1',
      providerStateSnapshot: null,
    }

    // eslint-disable-next-line no-empty
    for await (const _event of provider.streamTurn({ runtimeSession, profile, message: 'test', thinkingEffort: 'high' })) {}

    expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      threadId: 'thr_1',
      effort: 'high',
    }))
  })

  it('streams turn/item notifications and terminates on turn/status completed', async () => {
    // Notification handlers registered by streamTurn, captured so we can invoke them
    const notificationHandlers: Record<string, (params: unknown) => void> = {}
    const request = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'turn/start') {
        // After turn/start, simulate server pushing notifications asynchronously
        setImmediate(() => {
          notificationHandlers['turn/item']?.({
            threadId: 'thread-1',
            item: { type: 'text', text: 'hello ' },
          })
          notificationHandlers['turn/item']?.({
            threadId: 'thread-1',
            item: { type: 'text', text: 'world' },
          })
          notificationHandlers['turn/status']?.({
            threadId: 'thread-1',
            status: 'completed',
          })
        })
        return {}
      }
      return {}
    })
    const onNotification = vi.fn().mockImplementation((method: string, handler: (params: unknown) => void) => {
      notificationHandlers[method] = handler
      return () => {
        delete notificationHandlers[method]
      }
    })

    const provider = new CodexAppServerProvider({
      resolveCommand: () => '/usr/local/bin/codex',
      connect: async () => makeClient({ request, onNotification }),
    })

    const runtimeSession = {
      id: 'session-1',
      chatSessionId: 'session-1',
      agentProfileId: profile.id,
      providerKind: 'codex-app-server' as const,
      providerSessionId: 'thread-1',
      providerStateSnapshot: null,
    }

    const events: string[] = []
    for await (const event of provider.streamTurn({ runtimeSession, profile, message: 'hi' })) {
      events.push(event.type)
    }

    // Should have: output_item.added, two output_text.delta, output_item.done
    expect(events).toEqual([
      'response.output_item.added',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_item.done',
    ])
    // Ensure the generator terminates (no hang)
    expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ threadId: 'thread-1' }))
  })
})
