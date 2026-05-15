// Input: persisted TabInstance state plus the set of session/workspace ids that still exist in SQLite
// Output: Reconciled tab state with dangling chat/workspace tabs removed and active tab repaired
// Position: Renderer tab-state hygiene helper used during startup hydration

import type { TabInstance } from '@cradle/tabs-next'

interface ReconcilePersistedTabsInput {
  tabs: TabInstance[]
  activeTabId: string | null
  existingSessionIds: Set<string>
  existingWorkspaceIds: Set<string>
}

export function reconcilePersistedTabs(input: ReconcilePersistedTabsInput): {
  tabs: TabInstance[]
  activeTabId: string | null
} {
  const tabs = input.tabs.filter((tab) => {
    if (tab.type === 'chat') {
      const sessionId = tab.params.sessionId
      return typeof sessionId !== 'string' || input.existingSessionIds.has(sessionId)
    }

    if (tab.type === 'workspace-detail') {
      const workspaceId = tab.params.workspaceId
      return typeof workspaceId !== 'string' || input.existingWorkspaceIds.has(workspaceId)
    }

    return true
  })

  const activeTabId = tabs.some(tab => tab.id === input.activeTabId)
    ? input.activeTabId
    : tabs.at(-1)?.id ?? null

  return { tabs, activeTabId }
}
