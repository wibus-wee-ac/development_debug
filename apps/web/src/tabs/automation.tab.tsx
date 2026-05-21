import { defineTab } from '@cradle/tabs-next'
import { CalendarClockIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'

const AutomationDashboard = lazy(() => import('~/features/automation').then(m => ({ default: m.AutomationDashboard })))

function AutomationTabContent({ params: _params }: { params: Record<string, never> }) {
  return (
    <Suspense fallback={null}>
      <AutomationDashboard />
    </Suspense>
  )
}

export const automationTab = defineTab({
  type: 'automation' as const,
  label: 'Automations',
  icon: CalendarClockIcon,
  component: AutomationTabContent,
})
