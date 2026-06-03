// Output: Background preload entry for Cradle tab route code chunks.
// Input: App shell startup after initial render.
// Position: Tabs layer coordinates route-owned preload hooks without owning page data.

import { automationTab } from './automation.tab'
import { awaitsTab } from './awaits.tab'
import { newChatTab } from './new-chat.tab'
import { usageTab } from './usage.tab'

export function preloadCradleTabRoutes(): void {
  newChatTab.preload?.({})
  usageTab.preload?.({})
  awaitsTab.preload?.({})
  automationTab.preload?.({})
}
