import { defineTab } from '@cradle/tabs-next'
import { BarChart2Icon } from 'lucide-react'
import { lazy } from 'react'

function loadUsageDashboard() {
  return import('~/features/usage/usage-dashboard').then(module => ({ default: module.UsageDashboard }))
}

const UsageDashboard = lazy(loadUsageDashboard)

function UsageTabContent({ params: _params }: { params: Record<string, never> }) {
  return <UsageDashboard />
}

export const usageTab = defineTab({
  type: 'usage' as const,
  label: '用量',
  icon: BarChart2Icon,
  component: UsageTabContent,
  preload: () => { void loadUsageDashboard() },
})
