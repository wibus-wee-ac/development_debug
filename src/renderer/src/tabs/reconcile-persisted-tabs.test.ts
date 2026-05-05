import type { TabInstance } from '@cradle/tabs'
import { describe, expect, it } from 'vitest'

import { reconcilePersistedTabs } from './reconcile-persisted-tabs'

describe('reconcilePersistedTabs', () => {
  it('drops chat/workspace tabs whose backing records no longer exist and repairs active tab selection', () => {
    const tabs: TabInstance[] = [
      { id: 'home', type: 'home', params: {}, label: 'Home', pinned: true },
      { id: 'chat-stale', type: 'chat', params: { sessionId: 'missing-session' }, label: 'Missing chat', pinned: false },
      { id: 'workspace-ok', type: 'workspace-detail', params: { workspaceId: 'workspace-1' }, label: 'Workspace', pinned: false },
      { id: 'workspace-stale', type: 'workspace-detail', params: { workspaceId: 'workspace-x' }, label: 'Missing workspace', pinned: false },
    ]

    expect(reconcilePersistedTabs({
      tabs,
      activeTabId: 'workspace-stale',
      existingSessionIds: new Set(['session-1']),
      existingWorkspaceIds: new Set(['workspace-1']),
    })).toEqual({
      tabs: [
        { id: 'home', type: 'home', params: {}, label: 'Home', pinned: true },
        { id: 'workspace-ok', type: 'workspace-detail', params: { workspaceId: 'workspace-1' }, label: 'Workspace', pinned: false },
      ],
      activeTabId: 'workspace-ok',
    })
  })
})