import type { SystemAgentContext } from './context-schema'

const RE_CONTEXT_TAG = /<\/?cradle_context>/gi
const RE_WHITESPACE = /\s+/g

function contextValue(value: string): string {
  return value
    .replace(RE_CONTEXT_TAG, tag => tag.replaceAll('<', '[').replaceAll('>', ']'))
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(RE_WHITESPACE, ' ')
    .trim()
}

function getOtherTabLabels(ctx: SystemAgentContext): string[] {
  let activeSkipped = false
  return ctx.openTabs.flatMap((tab) => {
    if (
      ctx.activeTab
      && !activeSkipped
      && tab.type === ctx.activeTab.type
      && tab.label === ctx.activeTab.label
    ) {
      activeSkipped = true
      return []
    }
    return [contextValue(tab.label || tab.type)]
  })
}

/**
 * Formats a SystemAgentContext snapshot into a concise text block
 * that gets prepended to the user message for agent awareness.
 *
 * Design constraints:
 * - Must NOT go in system prompt (breaks KV cache)
 * - Prepended to user message via ingress:before hook
 * - Keep it short — every token counts
 */
export function formatContextForAgent(ctx: SystemAgentContext): string {
  const lines: string[] = []

  // Active tab
  if (ctx.activeTab) {
    const tabDesc = contextValue(ctx.activeTab.label || ctx.activeTab.type)
    lines.push(`viewing: ${tabDesc} (${contextValue(ctx.activeTab.type)})`)
    if (Object.keys(ctx.activeTab.params).length > 0) {
      const params = Object.entries(ctx.activeTab.params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${contextValue(k)}=${contextValue(v!)}`)
        .join(', ')
      if (params) {
        lines.push(`  params: ${params}`)
      }
    }
  }
  else {
    lines.push('viewing: nothing (no active tab)')
  }

  // Open tabs summary
  if (ctx.openTabs.length > 1) {
    const others = getOtherTabLabels(ctx)
    if (others.length > 0) {
      lines.push(`other tabs: ${others.join(', ')}`)
    }
  }

  // Chat context
  if (ctx.chatContext) {
    const { sessionId, status, messageCount, recentMessages } = ctx.chatContext
    lines.push(`chat: session=${contextValue(sessionId)} status=${contextValue(status)} messages=${messageCount}`)
    if (recentMessages.length > 0) {
      const last = recentMessages.at(-1)
      if (last) {
        lines.push(`  last msg: [${contextValue(last.role)}] ${contextValue(last.contentPreview)}`)
      }
    }
  }

  // Layout awareness (only notable states)
  const layout: string[] = []
  if (ctx.layout.settingsTabId) {
    layout.push(`in settings (${contextValue(ctx.layout.settingsSection)})`)
  }
  if (ctx.layout.asideOpen) {
    layout.push(`aside open (${contextValue(ctx.layout.asideActiveTab)})`)
  }
  if (ctx.layout.bottomPanelOpen) {
    layout.push('bottom panel open')
  }
  if (ctx.layout.sidebarCollapsed) {
    layout.push('sidebar collapsed')
  }
  if (layout.length > 0) {
    lines.push(`layout: ${layout.join(', ')}`)
  }

  // Unread
  if (ctx.unreadSessionIds.length > 0) {
    lines.push(`unread: ${ctx.unreadSessionIds.length} session(s)`)
  }

  // Profile
  if (ctx.activeProfileId) {
    lines.push(`profile: ${contextValue(ctx.activeProfileId)}`)
  }

  return `<cradle_context>\n${lines.join('\n')}\n</cradle_context>`
}
