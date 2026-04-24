import { AppHeader } from '@renderer/components/layout/app-header'
import { AppLayout } from '@renderer/components/layout/app-layout'
import { KanbanSidebar } from '@renderer/features/kanban/kanban-sidebar'
import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { LayoutDashboardIcon } from 'lucide-react'

export const Route = createFileRoute('/kanban')({
  component: RouteComponent,
})

function RouteComponent() {
  const pathname = useRouterState({ select: s => s.location.pathname })
  const atRoot = pathname === '/kanban'

  return (
    <AppLayout header={<AppHeader title="看板" hasAside={false} hasPanel={false} />}>
      <div className="flex h-full overflow-hidden">
        <KanbanSidebar />
        <div className="flex flex-1 overflow-hidden">
          {atRoot
            ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                <LayoutDashboardIcon className="size-10 opacity-30" />
                <p className="text-sm">从左侧选择或创建一个看板</p>
              </div>
            )
            : <Outlet />}
        </div>
      </div>
    </AppLayout>
  )
}
