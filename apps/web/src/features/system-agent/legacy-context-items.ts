// Output: Adapter from legacy SystemAgentContext snapshots to typed context items.
// Input: Current Jarvis snapshot shape produced by use-context-snapshot.ts.
// Position: Transitional system-agent adapter until feature-owned providers replace the monolithic snapshot.

import type { ContextItem } from '~/features/context/context-items'
import { estimateContextTokens } from '~/features/context/context-items'
import type { SystemAgentContext } from './context-schema'

const OWNER = 'system-agent'

function createItem(input: Omit<ContextItem, 'createdAt' | 'tokenEstimate'> & { createdAt: number, tokenEstimate?: number }): ContextItem {
  const tokenEstimate = input.tokenEstimate ?? estimateContextTokens([
    input.title,
    input.summary,
    input.content ?? '',
  ].join('\n'))

  return {
    ...input,
    tokenEstimate,
  }
}

export function projectLegacyContextItems(ctx: SystemAgentContext, now: number): ContextItem[] {
  const items: ContextItem[] = []

  if (ctx.activeTab) {
    const tabLabel = ctx.activeTab.label || ctx.activeTab.type
    const params = Object.entries(ctx.activeTab.params)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ')

    items.push(createItem({
      id: `legacy:view:${ctx.activeTab.type}:${tabLabel}`,
      kind: 'view',
      owner: OWNER,
      title: 'Active view',
      summary: `User is viewing ${tabLabel} (${ctx.activeTab.type}).`,
      content: params ? `params: ${params}` : undefined,
      priority: 80,
      freshness: 'live',
      sensitivity: 'workspace',
      createdAt: now,
    }))
  }
  else {
    items.push(createItem({
      id: 'legacy:view:none',
      kind: 'view',
      owner: OWNER,
      title: 'Active view',
      summary: 'User has no active tab.',
      priority: 40,
      freshness: 'live',
      sensitivity: 'public',
      createdAt: now,
    }))
  }

  if (ctx.openTabs.length > 0) {
    items.push(createItem({
      id: 'legacy:view:open-tabs',
      kind: 'view',
      owner: OWNER,
      title: 'Open tabs',
      summary: `Open tabs: ${ctx.openTabs.map(tab => tab.label || tab.type).join(', ')}.`,
      priority: 35,
      freshness: 'live',
      sensitivity: 'workspace',
      createdAt: now,
    }))
  }

  if (ctx.chatContext) {
    const lastMessage = ctx.chatContext.recentMessages.at(-1)
    items.push(createItem({
      id: `legacy:history:chat:${ctx.chatContext.sessionId}`,
      kind: 'history',
      owner: OWNER,
      title: 'Active chat summary',
      summary: `Chat session ${ctx.chatContext.sessionId} is ${ctx.chatContext.status} with ${ctx.chatContext.messageCount} message(s).`,
      content: lastMessage
        ? `last message: [${lastMessage.role}] ${lastMessage.contentPreview}`
        : undefined,
      references: [{
        kind: 'chat-session',
        id: ctx.chatContext.sessionId,
        label: ctx.chatContext.sessionId,
      }],
      priority: 70,
      freshness: 'live',
      sensitivity: 'private',
      createdAt: now,
    }))
  }

  const layoutParts: string[] = []
  if (ctx.layout.settingsTabId) {
    layoutParts.push(`settings section: ${ctx.layout.settingsSection}`)
  }
  if (ctx.layout.asideOpen) {
    layoutParts.push(`aside open: ${ctx.layout.asideActiveTab}`)
  }
  if (ctx.layout.bottomPanelOpen) {
    layoutParts.push('bottom panel open')
  }
  if (ctx.layout.sidebarCollapsed) {
    layoutParts.push('sidebar collapsed')
  }

  if (layoutParts.length > 0) {
    items.push(createItem({
      id: 'legacy:layout:notable',
      kind: 'layout',
      owner: OWNER,
      title: 'Layout',
      summary: layoutParts.join(', '),
      priority: 25,
      freshness: 'live',
      sensitivity: 'public',
      createdAt: now,
    }))
  }

  if (ctx.unreadSessionIds.length > 0) {
    items.push(createItem({
      id: 'legacy:attention:unread-sessions',
      kind: 'attention',
      owner: OWNER,
      title: 'Unread sessions',
      summary: `${ctx.unreadSessionIds.length} session(s) have unread activity.`,
      priority: 30,
      freshness: 'recent',
      sensitivity: 'private',
      createdAt: now,
    }))
  }

  if (ctx.activeProfileId) {
    items.push(createItem({
      id: `legacy:entity:profile:${ctx.activeProfileId}`,
      kind: 'entity',
      owner: OWNER,
      title: 'Active Jarvis profile',
      summary: `Active profile: ${ctx.activeProfileId}.`,
      priority: 20,
      freshness: 'recent',
      sensitivity: 'private',
      createdAt: now,
    }))
  }

  return items
}
