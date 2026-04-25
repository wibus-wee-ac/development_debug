// Input: AppLayout, AppHeader, HomeDashboard, TanStack Router search state
// Output: Index route — renders the dashboard hub
// Position: Root page route for the main launcher view

import { AppHeader } from '@renderer/components/layout/app-header'
import { AppLayout } from '@renderer/components/layout/app-layout'
import { HomeDashboard } from '@renderer/features/home/home-dashboard'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: App,
  validateSearch: (search: Record<string, unknown>) => ({
    workspaceId: typeof search.workspaceId === 'string' ? search.workspaceId : undefined,
  }),
})

function App() {
  return (
    <AppLayout
      header={(
        <AppHeader
          trafficLight
          hasAside={false}
          hasPanel={false}
        />
      )}
    >
      <HomeDashboard />
    </AppLayout>
  )
}
