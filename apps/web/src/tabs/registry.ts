import { createTabStore } from '@cradle/tabs-next'

import { isTearoffWindow, tearoffSessionId } from '~/lib/electron'

import { approvalsTab } from './approvals.tab'
import { automationTab } from './automation.tab'
import { awaitsTab } from './awaits.tab'
import { chatTab } from './chat.tab'
import { homeTab } from './home.tab'
import { kanbanBoardTab } from './kanban-board.tab'
import { newChatTab } from './new-chat.tab'
import { pluginPanelTab } from './plugin-panel.tab'
import { usageTab } from './usage.tab'
import { workspaceDetailTab } from './workspace-detail.tab'
import { installTerminalPanelTabLifecycle } from './terminal-panel-tab-lifecycle'

export const cradleRegistry = {
  'home': homeTab,
  'chat': chatTab,
  'new-chat': newChatTab,
  'approvals': approvalsTab,
  'awaits': awaitsTab,
  'automation': automationTab,
  'kanban-board': kanbanBoardTab,
  'workspace-detail': workspaceDetailTab,
  'usage': usageTab,
  'plugin-panel': pluginPanelTab,
} as const

const tabPersistKey = isTearoffWindow
  ? `cradle:tabs-next:tearoff:${tearoffSessionId ?? 'unknown'}:v1`
  : undefined

export const useCradleTabStore = createTabStore(
  cradleRegistry,
  tabPersistKey ? { persistKey: tabPersistKey } : undefined,
)

installTerminalPanelTabLifecycle(useCradleTabStore)
