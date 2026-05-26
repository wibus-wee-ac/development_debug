// Output: Pure tab renderer retention policy helpers.
// Input: Tab instances, tab contexts, active tab id, and render policy options.
// Position: Shared policy layer used by TabRenderer and renderer policy tests.
import type { TabContextState, TabInstance, TabRenderPolicy } from './types'

export const DEFAULT_TAB_RENDER_POLICY: TabRenderPolicy = {
  strategy: 'activity-pool',
  maxMountedTabs: 5,
  keepPinnedMounted: true,
}

export function chooseMountedTabIds(
  tabs: TabInstance[],
  contexts: TabContextState[],
  activeTabId: string | null,
  policy: TabRenderPolicy = DEFAULT_TAB_RENDER_POLICY,
): string[] {
  if (!activeTabId) {
    return []
  }

  if (policy.strategy === 'single') {
    return tabs.some(tab => tab.id === activeTabId) ? [activeTabId] : []
  }

  const maxMountedTabs = Math.max(1, policy.maxMountedTabs ?? 5)
  const contextById = new Map(contexts.map(context => [context.id, context]))
  const mounted = new Set<string>([activeTabId])

  if (policy.keepPinnedMounted !== false) {
    for (const tab of tabs) {
      const context = contextById.get(tab.id)
      if (tab.pinned || context?.keepAlive === 'always') {
        mounted.add(tab.id)
      }
    }
  }

  const candidates: Array<{ tab: TabInstance, context: TabContextState | undefined }> = []
  for (const tab of tabs) {
    if (mounted.has(tab.id)) {
      continue
    }
    const context = contextById.get(tab.id)
    if (context?.keepAlive === 'discardable') {
      continue
    }
    candidates.push({ tab, context })
  }
  candidates.sort((a, b) => (b.context?.lastActiveAt ?? 0) - (a.context?.lastActiveAt ?? 0))

  for (const candidate of candidates) {
    if (mounted.size >= maxMountedTabs) {
      break
    }
    mounted.add(candidate.tab.id)
  }

  const mountedIds: string[] = []
  for (const tab of tabs) {
    if (mounted.has(tab.id)) {
      mountedIds.push(tab.id)
    }
  }
  return mountedIds
}
