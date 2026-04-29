/* eslint-disable react-refresh/only-export-components */
// Input: defineTab from @cradle/tabs, WorkspaceDetailPage component, AppLayout
// Output: workspace-detail tab definition
// Position: Tab type for workspace detail page

import { defineTab } from '@cradle/tabs'
import { FolderOpenIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'

const WorkspaceDetailPage = lazy(() => import('@renderer/features/workspace-detail/workspace-detail-page').then(m => ({ default: m.WorkspaceDetailPage })))

function WorkspaceDetailTabContent({ params }: { params: { workspaceId: string } }) {
  return (
    <Suspense fallback={null}>
      <WorkspaceDetailPage workspaceId={params.workspaceId} />
    </Suspense>
  )
}

export const workspaceDetailTab = defineTab({
  type: 'workspace-detail' as const,
  label: (params: { workspaceId: string }) => `Workspace: ${params.workspaceId.slice(0, 8)}`,
  icon: FolderOpenIcon,
  component: WorkspaceDetailTabContent,
  serialize: params => params.workspaceId,
  deserialize: path => path ? { workspaceId: path } : null,
})
