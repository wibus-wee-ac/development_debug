// Input: AppLayout, AppHeader, NewChatHome, RightAside, ShellView, TanStack Router search state
// Output: Index route — renders the launcher and forwards the selected workspace from URL search
// Position: Root page route for the main launcher view

import { AppHeader } from '@renderer/components/layout/app-header'
import { AppLayout } from '@renderer/components/layout/app-layout'
import { RightAside } from '@renderer/components/layout/right-aside'
import { NewChatHome } from '@renderer/features/new-chat'
import { ShellView } from '@renderer/features/tui/shell-view'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/')({
  component: App,
  validateSearch: (search: Record<string, unknown>) => ({
    workspaceId: typeof search.workspaceId === 'string' ? search.workspaceId : undefined,
  }),
})

function App() {
  const { workspaceId } = Route.useSearch()
  const [workspace, setWorkspace] = useState<{ id: string; path: string } | null>(null)
  const [shellGen, setShellGen] = useState(0)

  return (
    <AppLayout
      header={(
        <AppHeader
          trafficLight
          hasAside={!!workspace}
          hasPanel={!!workspace}
        />
      )}
      aside={workspace ? <RightAside workspaceId={workspace.id} workspacePath={workspace.path} /> : undefined}
      panel={workspace
        ? (
          <ShellView
            key={`${workspace.id}:${shellGen}`}
            ptyId={`shell:home:${workspace.id}:${shellGen}`}
            cwd={workspace.path}
            onExited={() => setShellGen(g => g + 1)}
          />
        )
        : undefined}
    >
      <NewChatHome
        preferredWorkspaceId={workspaceId ?? null}
        onWorkspaceChange={setWorkspace}
      />
    </AppLayout>
  )
}
