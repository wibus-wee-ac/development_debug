/* eslint-disable react-refresh/only-export-components */
// Input: defineTab from @cradle/tabs, HomeDashboard component
// Output: home tab definition
// Position: Tab type for the home/dashboard page

import { defineTab } from '@cradle/tabs'
import { HomeIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'

const HomeDashboard = lazy(() => import('@renderer/features/home/home-dashboard').then(m => ({ default: m.HomeDashboard })))

function HomeTabContent({ params: _params }: { params: Record<string, never> }) {
  return (
    <Suspense fallback={null}>
      <HomeDashboard />
    </Suspense>
  )
}

export const homeTab = defineTab({
  type: 'home' as const,
  label: '首页',
  icon: HomeIcon,
  pinned: true,
  component: HomeTabContent,
})
