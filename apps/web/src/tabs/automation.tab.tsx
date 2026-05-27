import { defineTab } from '@cradle/tabs-next'
import { CalendarClockIcon } from 'lucide-react'
import { lazy } from 'react'

import { loadAutomationDashboard, preloadAutomationDashboard } from '~/features/automation/automation-dashboard-loader'

const AutomationDashboard = lazy(loadAutomationDashboard)

function AutomationTabContent({ params: _params }: { params: Record<string, never> }) {
  return <AutomationDashboard />
}

export const automationTab = defineTab({
  type: 'automation' as const,
  label: 'Automations',
  icon: CalendarClockIcon,
  component: AutomationTabContent,
  preload: preloadAutomationDashboard,
})
