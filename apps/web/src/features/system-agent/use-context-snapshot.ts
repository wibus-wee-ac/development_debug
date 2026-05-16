/**
 * System Agent Context Snapshot Collector
 *
 * Provides a function to capture the current UI state as a SystemAgentContext.
 * Called when the user sends a message to the System Agent — the snapshot is
 * attached to the message payload.
 */

import { useChatStore, chatSelectors } from '~/store/chat'
import { useLayoutStore } from '~/store/layout'
import { useNewChatStore } from '~/store/new-chat'
import { useSessionActivityStore } from '~/store/session-activity'
import { useCradleTabStore } from '~/tabs/registry'

import type { SystemAgentContext } from './context-schema'

const MAX_RECENT_MESSAGES = 5
const CONTENT_PREVIEW_LENGTH = 120

function getMessageContentPreview(message: { parts?: Array<{ type: string } & Record<string, unknown>> }): string {
  const text = message.parts
    ?.filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text as string)
    .join('\n')
    .trim()

  if (!text) {
    return '[structured content]'
  }

  return text.slice(0, CONTENT_PREVIEW_LENGTH)
}

/**
 * Returns a function that captures the current UI context snapshot.
 * Not a reactive hook — call the returned function imperatively when needed.
 */
export function collectContextSnapshot(): SystemAgentContext {
  const tabState = useCradleTabStore.getState()
  const chatState = useChatStore.getState()
  const layoutState = useLayoutStore.getState()
  const newChatState = useNewChatStore.getState()
  const activityState = useSessionActivityStore.getState()

  // Active tab
  const activeTab = tabState.activeTabId
    ? tabState.tabs.find(t => t.id === tabState.activeTabId) ?? null
    : null

  // Chat context (only if active tab is a chat)
  let chatContext: SystemAgentContext['chatContext'] = null
  if (activeTab?.type === 'chat' && activeTab.params.sessionId) {
    const sessionId = activeTab.params.sessionId
    const messages = chatSelectors.messages(sessionId)(chatState)
    const status = chatSelectors.visibleStatus(sessionId)(chatState)

    const recent = messages.slice(-MAX_RECENT_MESSAGES).map(m => ({
      role: m.role,
      contentPreview: getMessageContentPreview(m),
    }))

    chatContext = {
      sessionId,
      status,
      messageCount: messages.length,
      recentMessages: recent,
    }
  }

  return {
    activeTab: activeTab
      ? { type: activeTab.type, params: activeTab.params, label: activeTab.label }
      : null,
    openTabs: tabState.tabs.map(t => ({ type: t.type, label: t.label })),
    chatContext,
    layout: {
      sidebarCollapsed: layoutState.sidebarCollapsed,
      asideOpen: layoutState.asideOpen,
      asideActiveTab: layoutState.asideActiveTab,
      bottomPanelOpen: layoutState.bottomPanelOpen,
      settingsTabId: layoutState.settingsTabId,
      settingsSection: layoutState.settingsSection,
    },
    activeProfileId: newChatState.lastAgentProfileId,
    unreadSessionIds: [...activityState.unread],
  }
}
