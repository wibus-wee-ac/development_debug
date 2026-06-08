import { describe, expect, it, vi } from 'vitest'

import { handleCradleCommand, type SlackResponder } from '../src/slack/commands'
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
          getSessionSummary: vi.fn(async () => null),
        },
      })
      expect(await fixture.store.getWorkspaceBinding('T1', 'C1')).toBeNull()
      expect(responses.at(-1)).toMatchObject({ response_type: 'ephemeral' })
    } finally {
      fixture.cleanup()
    }
  })
})
