// Input: AppLayout, TanStack Router Outlet
// Output: Kanban layout route for /kanban
// Position: Layout route — passes through to children, shows placeholder at root

import { AppLayout } from '@renderer/components/layout/app-layout'
import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { LayoutDashboardIcon } from 'lucide-react'

export const Route = createFileRoute('/kanban')({
  component: KanbanLayout,
})

function KanbanLayout() {
  const pathname = useRouterState({ select: s => s.location.pathname })
  const atRoot = pathname === '/kanban'

  if (!atRoot) {
    return <Outlet />
  }

  return (
    <AppLayout title="看板" hasAside={false} hasPanel={false}>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <LayoutDashboardIcon className="size-10 opacity-30" />
        <p className="text-sm">从左侧选择或创建一个看板</p>
      </div>
    </AppLayout>
  )
}
