import type { SystemAgentContext } from './context-schema'

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
    const tabDesc = ctx.activeTab.label || ctx.activeTab.type
    lines.push(`viewing: ${tabDesc} (${ctx.activeTab.type})`)
    if (Object.keys(ctx.activeTab.params).length > 0) {
      const params = Object.entries(ctx.activeTab.params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
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
    const others = ctx.openTabs
      .filter(t => t.label !== ctx.activeTab?.label)
      .map(t => t.label || t.type)
    if (others.length > 0) {
      lines.push(`other tabs: ${others.join(', ')}`)
    }
  }

  // Chat context
  if (ctx.chatContext) {
    const { sessionId, status, messageCount, recentMessages } = ctx.chatContext
    lines.push(`chat: session=${sessionId} status=${status} messages=${messageCount}`)
    if (recentMessages.length > 0) {
      const last = recentMessages.at(-1)
      if (last) {
        lines.push(`  last msg: [${last.role}] ${last.contentPreview}`)
      }
    }
  }

  // Layout awareness (only notable states)
  const layout: string[] = []
  if (ctx.layout.settingsTabId) {
    layout.push(`in settings (${ctx.layout.settingsSection})`)
  }
  if (ctx.layout.asideOpen) {
    layout.push(`aside open (${ctx.layout.asideActiveTab})`)
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
    lines.push(`profile: ${ctx.activeProfileId}`)
  }

  return `<cradle_context>\n${lines.join('\n')}\n</cradle_context>`
}
