// Input: AppLayout, TanStack Router Outlet
// Output: Kanban layout lazy component for /kanban
// Position: Lazy-loaded layout chunk

import { AppLayout } from '@renderer/components/layout/app-layout'
import { RouteLoadingFallback } from '@renderer/components/ui/route-loading-fallback'
import { createLazyFileRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { LayoutDashboardIcon } from 'lucide-react'

export const Route = createLazyFileRoute('/kanban')({
  component: KanbanLayout,
  pendingComponent: RouteLoadingFallback,
})

function KanbanLayout() {
  const pathname = useRouterState({ select: s => s.location.pathname })
  const atRoot = pathname === '/kanban'

  if (!atRoot) return <Outlet />

  return (
    <AppLayout title="Kanban" hasAside={false} hasPanel={false}>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground/30">
        <LayoutDashboardIcon className="size-8" />
        <p className="text-[12px]">Select or create a board</p>
      </div>
    </AppLayout>
  )
}
