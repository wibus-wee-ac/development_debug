/* eslint-disable react-refresh/only-export-components */

import { defineTab } from '@cradle/tabs-next'
import { BarChart2Icon } from 'lucide-react'
import { lazy } from 'react'

import { loadUsageDashboard, preloadUsageDashboard } from '~/features/usage/usage-dashboard-loader'

const UsageDashboard = lazy(loadUsageDashboard)

function UsageTabContent({ params: _params }: { params: Record<string, never> }) {
  return <UsageDashboard />
}

export const usageTab = defineTab({
  type: 'usage' as const,
  label: '用量',
  icon: BarChart2Icon,
  component: UsageTabContent,
  preload: preloadUsageDashboard,
})
