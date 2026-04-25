// Input: WorkspaceDetailPage feature, AppLayout, AppHeader, GitBranchControl
// Output: /workspace/$workspaceId route — project detail page with breadcrumb
// Position: Route for viewing and editing workspace details (README, AGENTS)

import { AppHeader } from '@renderer/components/layout/app-header'
import { AppLayout } from '@renderer/components/layout/app-layout'
import { GitBranchControl } from '@renderer/features/git/git-branch-control'
import { WorkspaceDetailPage } from '@renderer/features/workspace-detail/workspace-detail-page'
import { ipc } from '@renderer/lib/ipc'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/workspace/$workspaceId')({
  component: WorkspaceDetail,
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
