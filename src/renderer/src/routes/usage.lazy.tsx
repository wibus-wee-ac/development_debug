// Input: TanStack Router createLazyFileRoute, UsageDashboard component, AppLayout
// Output: Lazy-loaded /usage route component wrapped in AppLayout
// Position: Lazy route for the usage/cost dashboard page

import { AppLayout } from '@renderer/components/layout/app-layout'
import { UsageDashboard } from '@renderer/features/usage/usage-dashboard'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/usage')({
  component: UsageLayout,
})

function UsageLayout() {
  return (
    <AppLayout title="用量" hasAside={false} hasPanel={false}>
      <UsageDashboard />
    </AppLayout>
  )
}
