// Input: automation feature modules
// Output: Public automation UI and data hooks
// Position: Feature barrel consumed by Home

export { AutomationDashboard } from './automation-dashboard'
export type { AutomationDefinition, AutomationRun } from './types'
export { useAutomationDefinitions } from './use-automations'
