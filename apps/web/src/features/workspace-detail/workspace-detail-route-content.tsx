import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useMemo } from 'react'

import { getWorkspacesById } from '~/api-gen/sdk.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { useSurfaceStore } from '~/navigation/surface-store'
import type { Workspace } from '~/features/workspace/types'

const WorkspaceDetailPage = lazy(() => import('./workspace-detail-page').then(m => ({ default: m.WorkspaceDetailPage })))

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

export function WorkspaceDetailRouteContent({ workspaceId }: { workspaceId: string }) {
  'use no memo'

  const updateSurfaceTitle = useSurfaceStore(state => state.updateSurfaceTitle)
  const { data: workspace } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesById({ path: { id: workspaceId } })
      return data as Workspace | undefined
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (workspace?.name) {
      updateSurfaceTitle(`workspace:${workspaceId}`, workspace.name)
    }
  }, [updateSurfaceTitle, workspace?.name, workspaceId])

  useEffect(() => {
    if (workspace?.path) {
      void loadTerminalPanelView()
    }
  }, [workspace?.path])

  return (
    <>
      <WorkspaceDetailLayoutSlots workspaceId={workspaceId} workspacePath={workspace?.path ?? null} />
      <Suspense fallback={null}>
        <WorkspaceDetailPage workspaceId={workspaceId} />
      </Suspense>
    </>
  )
}
