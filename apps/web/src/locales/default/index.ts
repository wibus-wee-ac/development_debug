// Output: Aggregated default English i18n resources.
// Input: Namespace modules under this directory.
// Position: Source of truth for i18n authoring and runtime fallback resources.

import approval from './approval'
import agentManagement from './agent-management'
import awaits from './awaits'
import chat from './chat'
import chronicle from './chronicle'
import chrome from './chrome'
import common from './common'
import devtool from './devtool'
import filesystem from './filesystem'
import git from './git'
import home from './home'
import kanban from './kanban'
import newChat from './new-chat'
import packCodebase from './pack-codebase'
import search from './search'
import settings from './settings'
import skills from './skills'
import systemAgent from './system-agent'
import usage from './usage'
import workspace from './workspace'

const resources = {
  approval,
  agentManagement,
  awaits,
  chat,
  chronicle,
  chrome,
  common,
  devtool,
  filesystem,
  git,
  home,
  kanban,
  'new-chat': newChat,
  'pack-codebase': packCodebase,
  search,
  settings,
  skills,
  'system-agent': systemAgent,
  usage,
  workspace,
} as const

export type DefaultResources = typeof resources
export type Namespace = keyof DefaultResources

export const allNamespaces = Object.keys(resources) as Namespace[]

export default resources
