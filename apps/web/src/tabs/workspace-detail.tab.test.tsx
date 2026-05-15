// @vitest-environment jsdom
//
// Input: React Testing Library, Vitest mocks, workspace-detail tab definition
// Output: Regression test for workspace-detail tab label synchronization
// Position: Tabs unit test ensuring workspace tabs adopt workspace names after data loads

import { render, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { workspaceDetailTab } from './workspace-detail.tab'

const mockedDeps = vi.hoisted(() => ({
  updateTabLabel: vi.fn(),
  workspaceGet: vi.fn(),
  storeState: {
    tabs: [
      {
        id: 'tab-1',
        type: 'workspace-detail',
        params: { workspaceId: 'workspace-1' },
      },
      {
        id: 'tab-2',
        type: 'workspace-detail',
        params: { workspaceId: 'workspace-2' },
      },
    ],
    updateTabLabel: vi.fn(),
  },
}))

vi.mock('@cradle/tabs-next', () => ({
  defineTab: <T,>(definition: T) => definition,
  useTabsContext: () => ({
    store: {
      getState: () => mockedDeps.storeState,
    },
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ enabled }: { enabled?: boolean }) => ({
    data: enabled
      ? {
          id: 'workspace-1',
          name: 'Workspace Alpha',
          path: '/tmp/workspace-alpha',
        }
      : undefined,
  }),
}))

vi.mock('~/lib/ipc', () => ({
  ipc: {
    workspace: {
      get: mockedDeps.workspaceGet,
    },
  },
}))

vi.mock('~/features/workspace-detail/workspace-detail-page', () => ({
  WorkspaceDetailPage: ({ workspaceId }: { workspaceId: string }) => <div>{workspaceId}</div>,
}))

describe('workspaceDetailTab', () => {
  beforeEach(() => {
    mockedDeps.storeState.updateTabLabel.mockClear()
    mockedDeps.workspaceGet.mockReset()
  })

  it('updates the matching workspace tab label to the workspace name after the workspace loads', async () => {
    const WorkspaceDetailTabContent = workspaceDetailTab.component as ComponentType<{
      params: { workspaceId: string }
    }>

    render(<WorkspaceDetailTabContent params={{ workspaceId: 'workspace-1' }} />)

    await waitFor(() => {
      expect(mockedDeps.storeState.updateTabLabel).toHaveBeenCalledWith('tab-1', 'Workspace Alpha')
    })

    expect(mockedDeps.storeState.updateTabLabel).not.toHaveBeenCalledWith('tab-2', 'Workspace Alpha')
  })
})
