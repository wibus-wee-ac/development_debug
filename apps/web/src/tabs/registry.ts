import { createTabStore } from '@cradle/tabs-next'

import { isTearoffWindow, tearoffSessionId } from '~/lib/electron'

import { automationTab } from './automation.tab'
import { awaitsTab } from './awaits.tab'
import { chatTab } from './chat.tab'
import { homeTab } from './home.tab'
import { kanbanBoardTab } from './kanban-board.tab'
import { newChatTab } from './new-chat.tab'
import { onboardingTab } from './onboarding.tab'
import { pluginPanelTab } from './plugin-panel.tab'
import { installTerminalPanelTabLifecycle } from './terminal-panel-tab-lifecycle'
import { usageTab } from './usage.tab'
import { workspaceDetailTab } from './workspace-detail.tab'

export const cradleRegistry = {
  'home': homeTab,
  'chat': chatTab,
  'new-chat': newChatTab,
  'awaits': awaitsTab,
  'automation': automationTab,
  'kanban-board': kanbanBoardTab,
  'workspace-detail': workspaceDetailTab,
  'usage': usageTab,
  'plugin-panel': pluginPanelTab,
  'onboarding': onboardingTab,
} as const

const tabPersistKey = isTearoffWindow
  ? `cradle:tabs-next:tearoff:${tearoffSessionId ?? 'unknown'}:v1`
  : undefined

export const useCradleTabStore = createTabStore(
  cradleRegistry,
  tabPersistKey ? { persistKey: tabPersistKey } : undefined,
)

if (import.meta.env.DEV) {
  window.__CRADLE_TAB_STORE__ = useCradleTabStore
}

installTerminalPanelTabLifecycle(useCradleTabStore)
