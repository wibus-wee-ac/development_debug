export type TrayMetricTone = 'neutral' | 'active' | 'warning' | 'danger'

export type TrayActionId =
  | 'open-app'
  | 'open-chat'
  | 'new-chat'
  | 'global-search'
  | 'open-resident'
  | 'open-running'
  | 'open-approvals'
  | 'open-awaits'
  | 'open-automation'
  | 'open-workspaces'
  | 'open-agents'
  | 'open-providers'
  | 'open-chronicle'
  | 'open-usage'
  | 'open-plugins'
  | 'open-desktop-settings'
  | 'quit'

export interface TraySessionItem {
  id: string
  sessionId: string
  title: string
  workspaceId: string | null
  workspaceName: string
  runtimeKind: string
  modelId: string | null
  updatedAt: number
  detail: string
}

export interface TrayMetric {
  id: string
  label: string
  value: string
  tone: TrayMetricTone
}

export interface TrayQuickAction {
  id: TrayActionId
  label: string
  description: string
  accelerator: string | null
  badge: string | null
  enabled: boolean
}

export interface TraySnapshot {
  generatedAt: number
  running: TraySessionItem[]
  resident: TraySessionItem[]
  metrics: TrayMetric[]
  quickActions: TrayQuickAction[]
}

export interface TrayAwaitItem {
  id: string
  sessionId: string
  title: string
  workspaceId: string | null
  workspaceName: string
  source: string
  reason: string | null
  createdAt: number
}

export interface TrayActionRequest {
  actionId: TrayActionId
  payload?: unknown
}
