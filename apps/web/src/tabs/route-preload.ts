// Output: Background preload entry for Cradle tab route code chunks.
// Input: App shell startup after initial render.
// Position: Tabs layer coordinates route-owned preload hooks without owning page data.

import { preloadAutomationDashboard } from '~/features/automation/automation-dashboard-loader'
import { preloadNewChatPage } from '~/features/new-chat/new-chat-page-loader'
import { preloadAwaitsOverview } from '~/features/session-await/awaits-overview-loader'
import { preloadUsageDashboard } from '~/features/usage/usage-dashboard-loader'

export function preloadCradleTabRoutes(): void {
  preloadNewChatPage()
  preloadUsageDashboard()
  preloadAwaitsOverview()
  preloadAutomationDashboard()
}
