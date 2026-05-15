// Input: all tab definitions, createTabStore from @cradle/tabs-next
// Output: cradleRegistry (tab type map), useCradleTabStore (bound store)
// Position: Central registry connecting tab types to the store

import { createTabStore } from '@cradle/tabs-next'

import { chatTab } from './chat.tab'
import { homeTab } from './home.tab'
import { kanbanBoardTab } from './kanban-board.tab'
import { newChatTab } from './new-chat.tab'
import { usageTab } from './usage.tab'
import { workspaceDetailTab } from './workspace-detail.tab'

export const cradleRegistry = {
  'home': homeTab,
  'chat': chatTab,
  'new-chat': newChatTab,
  'kanban-board': kanbanBoardTab,
  'workspace-detail': workspaceDetailTab,
  'usage': usageTab,
} as const

export const useCradleTabStore = createTabStore(cradleRegistry)
