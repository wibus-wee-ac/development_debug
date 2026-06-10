import { describe, expect, it, vi } from 'vitest'

import {
  CRADLE_SESSION_MODEL_SELECT_ACTION,
  CRADLE_SESSION_TARGET_SELECT_ACTION,
  handleCradleCommand,
  handleCradleSessionModelSelectAction,
  handleCradleSessionTargetSelectAction,
  type SlackResponder,
} from '../src/slack/commands'
import type { SlackBlockMessage } from '../src/slack/format'
import { createTestStore } from './test-db'

describe('handleCradleCommand', () => {
  it('binds, reports status, and unbinds a workspace', async () => {
    const fixture = createTestStore()
    const responses: Array<{ text: string, blocks?: SlackBlockMessage['blocks'], response_type?: 'ephemeral' | 'in_channel' }> = []
    const respond: SlackResponder = async message => {
      responses.push(message)
    }
    try {
      const cradle = {
        verifyWorkspace: vi.fn(async () => true),
        listSessionTargets: vi.fn(async () => [{
          kind: 'agent' as const,
          id: 'agent_1',
          label: 'Codex',
          description: null,
          runtimeKind: 'codex',
          providerTargetId: 'provider_1',
          modelId: null,
        }]),
        listProviderTargetModels: vi.fn(async () => [{
          id: 'gpt-5',
          label: 'GPT-5',
        }]),
        getSessionSummary: vi.fn(async (sessionId: string) => ({
          id: sessionId,
          title: 'Investigate deployment failures',
        })),
      }
      await handleCradleCommand({
        team_id: 'T1',
        channel_id: 'C1',
        user_id: 'U1',
        text: 'bind workspace workspace_1',
      }, respond, { store: fixture.store, cradle })

      expect(await fixture.store.getWorkspaceBinding('T1', 'C1')).toMatchObject({
        cradleWorkspaceId: 'workspace_1',
      })
      expect(responses.at(-1)).toMatchObject({ response_type: 'in_channel' })
      await fixture.store.createThreadBinding({
        teamId: 'T1',
        channelId: 'C1',
        threadTs: '1765180800.000',
        cradleSessionId: 'session_deploy_failures',
        cradleWorkspaceId: 'workspace_1',
        createdBySlackUserId: 'U1',
      })

      await handleCradleCommand({
        team_id: 'T1',
        channel_id: 'C1',
        user_id: 'U1',
        text: 'status',
      }, respond, { store: fixture.store, cradle })
      expect(responses.at(-1)?.text).toContain('workspace_1')
      expect(responses.at(-1)?.text).toContain('Investigate deployment failures')
      expect(responses.at(-1)?.blocks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'header',
          text: {
            type: 'plain_text',
            text: 'Cradle Slack Bridge',
          },
        }),
        expect.objectContaining({
          type: 'section',
          text: expect.objectContaining({
            text: expect.stringContaining('*workspace_1*'),
          }),
        }),
        expect.objectContaining({
          type: 'section',
          text: expect.objectContaining({
            text: expect.stringContaining('*Investigate deployment failures*'),
          }),
        }),
        expect.objectContaining({
          type: 'actions',
          elements: expect.arrayContaining([
            expect.objectContaining({
              type: 'static_select',
            }),
          ]),
        }),
      ]))

      await handleCradleCommand({
        team_id: 'T1',
        channel_id: 'C1',
        user_id: 'U1',
        text: 'unbind',
      }, respond, { store: fixture.store, cradle })
      expect(await fixture.store.getWorkspaceBinding('T1', 'C1')).toBeNull()
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects unknown workspaces', async () => {
    const fixture = createTestStore()
    const responses: Array<{ text: string, blocks?: SlackBlockMessage['blocks'], response_type?: 'ephemeral' | 'in_channel' }> = []
    try {
      await handleCradleCommand({
        team_id: 'T1',
        channel_id: 'C1',
        user_id: 'U1',
        text: 'bind workspace missing',
      }, async message => {
        responses.push(message)
      }, {
        store: fixture.store,
        cradle: {
          verifyWorkspace: vi.fn(async () => false),
          listSessionTargets: vi.fn(async () => []),
          listProviderTargetModels: vi.fn(async () => []),
          getSessionSummary: vi.fn(async () => null),
        },
      })
      expect(await fixture.store.getWorkspaceBinding('T1', 'C1')).toBeNull()
      expect(responses.at(-1)).toMatchObject({ response_type: 'ephemeral' })
    } finally {
      fixture.cleanup()
    }
  })

  it('stores the selected Cradle runtime for the channel', async () => {
    const fixture = createTestStore()
    const responses: Array<{ text: string, blocks?: SlackBlockMessage['blocks'], response_type?: 'ephemeral' | 'in_channel', replace_original?: boolean }> = []
    const respond: SlackResponder = async message => {
      responses.push(message)
    }
    const cradle = {
      verifyWorkspace: vi.fn(async () => true),
      listSessionTargets: vi.fn(async () => [{
        kind: 'agent' as const,
        id: 'agent_1',
        label: 'Codex',
        description: null,
        runtimeKind: 'codex',
        providerTargetId: 'provider_1',
        modelId: 'gpt-5',
      }]),
      listProviderTargetModels: vi.fn(async () => [{
        id: 'gpt-5',
        label: 'GPT-5',
      }]),
      getSessionSummary: vi.fn(async () => null),
    }

    try {
      await fixture.store.setWorkspaceBinding({
        teamId: 'T1',
        channelId: 'C1',
        cradleWorkspaceId: 'workspace_1',
        boundBySlackUserId: 'U1',
      })
      await handleCradleSessionTargetSelectAction({
        team: { id: 'T1' },
        channel: { id: 'C1' },
        user: { id: 'U1' },
        actions: [{
          action_id: CRADLE_SESSION_TARGET_SELECT_ACTION,
          selected_option: { value: 'agent:agent_1' },
        }],
      }, respond, { store: fixture.store, cradle })

      expect(await fixture.store.getWorkspaceBinding('T1', 'C1')).toMatchObject({
        sessionAgentId: 'agent_1',
        sessionProviderTargetId: null,
        sessionModelId: null,
      })
      expect(responses.at(-1)).toMatchObject({
        response_type: 'ephemeral',
        replace_original: true,
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('stores the selected provider-backed runtime for the channel', async () => {
    const fixture = createTestStore()
    const responses: Array<{ text: string, blocks?: SlackBlockMessage['blocks'], response_type?: 'ephemeral' | 'in_channel', replace_original?: boolean }> = []
    const respond: SlackResponder = async message => {
      responses.push(message)
    }
    const cradle = {
      verifyWorkspace: vi.fn(async () => true),
      listSessionTargets: vi.fn(async () => [{
        kind: 'provider-target' as const,
        id: 'provider_1',
        label: 'OpenAI',
        description: 'openai-compatible',
        runtimeKind: 'codex',
        runtimeLabel: 'Codex',
        providerTargetId: 'provider_1',
        modelId: null,
      }, {
        kind: 'provider-target' as const,
        id: 'provider_1',
        label: 'OpenAI',
        description: 'openai-compatible',
        runtimeKind: 'standard',
        runtimeLabel: 'Standard',
        providerTargetId: 'provider_1',
        modelId: null,
      }]),
      listProviderTargetModels: vi.fn(async () => [{
        id: 'gpt-5',
        label: 'GPT-5',
      }]),
      getSessionSummary: vi.fn(async () => null),
    }

    try {
      await fixture.store.setWorkspaceBinding({
        teamId: 'T1',
        channelId: 'C1',
        cradleWorkspaceId: 'workspace_1',
        boundBySlackUserId: 'U1',
      })
      await handleCradleSessionTargetSelectAction({
        team: { id: 'T1' },
        channel: { id: 'C1' },
        user: { id: 'U1' },
        actions: [{
          action_id: CRADLE_SESSION_TARGET_SELECT_ACTION,
          selected_option: { value: 'provider-target:codex:provider_1' },
        }],
      }, respond, { store: fixture.store, cradle })

      expect(await fixture.store.getWorkspaceBinding('T1', 'C1')).toMatchObject({
        sessionAgentId: null,
        sessionProviderTargetId: 'provider_1',
        sessionRuntimeKind: 'codex',
        sessionModelId: null,
      })
      expect(responses.at(-1)?.text).toContain('Codex: OpenAI')
      expect(responses.at(-1)).toMatchObject({
        response_type: 'ephemeral',
        replace_original: true,
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('stores the selected model for the channel runtime', async () => {
    const fixture = createTestStore()
    const responses: Array<{ text: string, blocks?: SlackBlockMessage['blocks'], response_type?: 'ephemeral' | 'in_channel', replace_original?: boolean }> = []
    const respond: SlackResponder = async message => {
      responses.push(message)
    }
    const cradle = {
      verifyWorkspace: vi.fn(async () => true),
      listSessionTargets: vi.fn(async () => [{
        kind: 'provider-target' as const,
        id: 'provider_1',
        label: 'OpenAI',
        description: 'openai-compatible',
        runtimeKind: 'standard',
        providerTargetId: 'provider_1',
        modelId: null,
      }]),
      listProviderTargetModels: vi.fn(async () => [{
        id: 'gpt-5',
        label: 'GPT-5',
      }]),
      getSessionSummary: vi.fn(async () => null),
    }

    try {
      await fixture.store.setWorkspaceBinding({
        teamId: 'T1',
        channelId: 'C1',
        cradleWorkspaceId: 'workspace_1',
        boundBySlackUserId: 'U1',
        sessionProviderTargetId: 'provider_1',
        sessionRuntimeKind: 'standard',
      })
      await handleCradleSessionModelSelectAction({
        team: { id: 'T1' },
        channel: { id: 'C1' },
        user: { id: 'U1' },
        actions: [{
          action_id: CRADLE_SESSION_MODEL_SELECT_ACTION,
          selected_option: { value: 'gpt-5' },
        }],
      }, respond, { store: fixture.store, cradle })

      expect(await fixture.store.getWorkspaceBinding('T1', 'C1')).toMatchObject({
        sessionProviderTargetId: 'provider_1',
        sessionModelId: 'gpt-5',
      })
      expect(responses.at(-1)).toMatchObject({
        response_type: 'ephemeral',
        replace_original: true,
      })
    } finally {
      fixture.cleanup()
    }
  })
})
