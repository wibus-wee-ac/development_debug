// Input: WorkspaceDetailPage feature, AppLayout, AppHeader, GitBranchControl
// Output: WorkspaceDetail lazy component for /workspace/$workspaceId
// Position: Lazy-loaded component chunk — contains Tiptap, Shiki, ProseMirror deps

import { AppHeader } from '@renderer/components/layout/app-header'
import { AppLayout } from '@renderer/components/layout/app-layout'
import { RouteLoadingFallback } from '@renderer/components/ui/route-loading-fallback'
import { GitBranchControl } from '@renderer/features/git/git-branch-control'
import { WorkspaceDetailPage } from '@renderer/features/workspace-detail/workspace-detail-page'
import { ipc } from '@renderer/lib/ipc'
import { useQuery } from '@tanstack/react-query'
import { createLazyFileRoute } from '@tanstack/react-router'

export const Route = createLazyFileRoute('/workspace/$workspaceId')({
  component: WorkspaceDetail,
  pendingComponent: RouteLoadingFallback,
})

function WorkspaceDetail() {
  const { workspaceId } = Route.useParams()

  const { data: workspace } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => ipc ? ipc.workspace.get(workspaceId) : Promise.resolve(undefined),
    enabled: !!workspaceId,
  })

  return (
    <AppLayout
      header={(
        <AppHeader
          trafficLight
          hasAside={false}
          hasPanel={false}
          workspace={workspace?.name}
          title="项目"
          gitBranch={workspace?.path ? <GitBranchControl workspacePath={workspace.path} /> : undefined}
        />
      )}
    >
      <WorkspaceDetailPage workspaceId={workspaceId} />
    </AppLayout>
  )
}
