export type TrayActionId
  = | 'open-app'
    | 'open-chat'
    | 'new-chat'
    | 'global-search'
    | 'open-resident'
    | 'open-running'
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
