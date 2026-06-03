import { defineTab } from '@cradle/tabs-next'
import { CalendarClockIcon } from 'lucide-react'
import { lazy } from 'react'

function loadAutomationDashboard() {
  return import('~/features/automation').then(module => ({ default: module.AutomationDashboard }))
}

const AutomationDashboard = lazy(loadAutomationDashboard)

function AutomationTabContent({ params: _params }: { params: Record<string, never> }) {
  return <AutomationDashboard />
}

export const automationTab = defineTab({
  type: 'automation' as const,
  label: 'Automations',
  icon: CalendarClockIcon,
  component: AutomationTabContent,
  preload: () => { void loadAutomationDashboard() },
})
