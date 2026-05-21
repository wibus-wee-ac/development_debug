/* eslint-disable react-refresh/only-export-components */

import { defineTab, useTabsContext } from '@cradle/tabs-next'
import { useQuery } from '@tanstack/react-query'
import { FolderOpenIcon } from 'lucide-react'
import { lazy, Suspense, useEffect } from 'react'

import { getWorkspacesById } from '~/api-gen/sdk.gen'
import type { Workspace } from '~/lib/types'

const WorkspaceDetailPage = lazy(() => import('~/features/workspace-detail/workspace-detail-page').then(m => ({ default: m.WorkspaceDetailPage })))

function WorkspaceDetailTabContent({ params }: { params: { workspaceId: string } }) {
  const { store } = useTabsContext()
  const { data: workspace } = useQuery({
    queryKey: ['workspace', params.workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesById({ path: { id: params.workspaceId } })
      return data as Workspace | undefined
    },
    enabled: !!params.workspaceId,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!workspace?.name) {
      return
    }

    const tab = store.getState().tabs.find(
      t => t.type === 'workspace-detail' && t.params.workspaceId === params.workspaceId,
    )

    if (tab) {
      store.getState().updateTabLabel(tab.id, workspace.name)
    }
  }, [params.workspaceId, store, workspace?.name])

  return (
    <Suspense fallback={null}>
      <WorkspaceDetailPage workspaceId={params.workspaceId} />
    </Suspense>
  )
}

export const workspaceDetailTab = defineTab({
  type: 'workspace-detail' as const,
  label: 'Workspace',
  icon: FolderOpenIcon,
  component: WorkspaceDetailTabContent,
  serialize: params => params.workspaceId,
  deserialize: path => path ? { workspaceId: path } : null,
})
