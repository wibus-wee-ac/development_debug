/* eslint-disable react-refresh/only-export-components */
// Input: defineTab from @cradle/tabs, UsageDashboard component, AppLayout
// Output: usage tab definition
// Position: Tab type for usage/cost dashboard

import { defineTab } from '@cradle/tabs'
import { BarChart2Icon } from 'lucide-react'
import { lazy, Suspense } from 'react'

const UsageDashboard = lazy(() => import('~/features/usage/usage-dashboard').then(m => ({ default: m.UsageDashboard })))

function UsageTabContent({ params: _params }: { params: Record<string, never> }) {
  return (
    <Suspense fallback={null}>
      <UsageDashboard />
    </Suspense>
  )
}

export const usageTab = defineTab({
  type: 'usage' as const,
  label: '用量',
  icon: BarChart2Icon,
  component: UsageTabContent,
})
