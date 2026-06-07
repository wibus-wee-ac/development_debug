import { defineTab, useTabsContext } from '@cradle/tabs-next'
import { useQuery } from '@tanstack/react-query'
import { FolderOpenIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo } from 'react'

import { getWorkspacesById } from '~/api-gen/sdk.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import type { Workspace } from '~/features/workspace/types'

const WorkspaceDetailPage = lazy(() => import('~/features/workspace-detail/workspace-detail-page').then(m => ({ default: m.WorkspaceDetailPage })))

function loadTerminalPanelView() {
  return import('~/features/tui/bottom-terminal-panel').then(module => ({ default: module.BottomTerminalPanel }))
}

const BottomTerminalPanel = lazy(loadTerminalPanelView)

function WorkspaceDetailLayoutSlots({
  workspaceId,
  workspacePath,
}: {
  workspaceId: string
  workspacePath: string | null
}) {
  'use no memo'

  const hasWorkspace = !!workspacePath
  const panel = useMemo(
    () => (
      <Suspense fallback={null}>
        {hasWorkspace
? (
          <BottomTerminalPanel
            ownerId={`workspace:${workspaceId}`}
            cwd={workspacePath!}
          />
        )
: null}
      </Suspense>
    ),
    [hasWorkspace, workspaceId, workspacePath],
  )

  useRegisterLayoutSlots(`workspace-detail:${workspaceId}`, useMemo(() => ({
    asideWorkspaceId: workspaceId,
    hasAside: true,
    hasBrowserPanel: true,
    hasPanel: true,
    panel,
  }), [panel, workspaceId]))

  return null
}

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

  useEffect(() => {
    if (workspace?.path) {
      void loadTerminalPanelView()
    }
  }, [workspace?.path])

  return (
    <>
      <WorkspaceDetailLayoutSlots workspaceId={params.workspaceId} workspacePath={workspace?.path ?? null} />
      <Suspense fallback={null}>
        <WorkspaceDetailPage workspaceId={params.workspaceId} />
      </Suspense>
    </>
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
