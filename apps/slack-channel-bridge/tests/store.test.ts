import { describe, expect, it } from 'vitest'

import { createBridgeDatabase } from '../src/db/client'
import { BridgeStore } from '../src/store'
import { createTestStore } from './test-db'

describe('BridgeStore', () => {
  it('persists bindings, inbound events, and delivery attempts in SQLite', async () => {
    const fixture = createTestStore()
    try {
      await fixture.store.setWorkspaceBinding({
        teamId: 'T1',
        channelId: 'C1',
        cradleWorkspaceId: 'workspace_1',
        boundBySlackUserId: 'U1',
      })
      await fixture.store.createThreadBinding({
        teamId: 'T1',
        channelId: 'C1',
        threadTs: '111.222',
        cradleSessionId: 'session_1',
        cradleWorkspaceId: 'workspace_1',
        createdBySlackUserId: 'U1',
      })
      expect(await fixture.store.recordInboundEvent({
        eventId: 'Ev1',
        teamId: 'T1',
        channelId: 'C1',
        threadTs: '111.222',
        slackTs: '111.222',
        eventType: 'app_mention',
      })).toBe('created')
      expect(await fixture.store.recordInboundEvent({
        eventId: 'Ev1',
        teamId: 'T1',
        channelId: 'C1',
        threadTs: '111.222',
        slackTs: '111.222',
        eventType: 'app_mention',
      })).toBe('duplicate')
      const attempt = await fixture.store.createDeliveryAttempt({
        teamId: 'T1',
        channelId: 'C1',
        threadTs: '111.222',
        cradleSessionId: 'session_1',
        messageText: 'hello',
        messageBlocksJson: '[{"type":"rich_text","elements":[]}]',
      })
      await fixture.store.markDeliveryAttemptFailed(attempt.id, 'network')
      fixture.store.close()

      const reopenedDb = createBridgeDatabase(fixture.dbPath)
      const reopened = new BridgeStore(reopenedDb)
      try {
        expect(await reopened.getWorkspaceBinding('T1', 'C1')).toMatchObject({
          cradleWorkspaceId: 'workspace_1',
        })
        expect(await reopened.getThreadBinding({ teamId: 'T1', channelId: 'C1', threadTs: '111.222' })).toMatchObject({
          cradleSessionId: 'session_1',
        })
        expect(await reopened.listRetryableDeliveryAttempts()).toMatchObject([
          {
            messageBlocksJson: '[{"type":"rich_text","elements":[]}]',
          },
        ])
      } finally {
        reopened.close()
      }
    } finally {
      fixture.cleanup()
    }
  })

  it('updates workspace binding idempotently', async () => {
    const fixture = createTestStore()
    try {
      const first = await fixture.store.setWorkspaceBinding({
        teamId: 'T1',
        channelId: 'C1',
        cradleWorkspaceId: 'workspace_1',
        boundBySlackUserId: 'U1',
      })
      const second = await fixture.store.setWorkspaceBinding({
        teamId: 'T1',
        channelId: 'C1',
        cradleWorkspaceId: 'workspace_2',
        boundBySlackUserId: 'U2',
      })
      expect(second.id).toBe(first.id)
      expect(second.cradleWorkspaceId).toBe('workspace_2')
    } finally {
      fixture.cleanup()
    }
  })
})
