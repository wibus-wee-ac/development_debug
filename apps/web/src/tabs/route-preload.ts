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
