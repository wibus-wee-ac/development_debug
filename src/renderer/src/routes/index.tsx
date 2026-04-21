// Input: AppLayout, AppHeader, NewChatHome, TanStack Router search state
// Output: Index route — renders the launcher and forwards the selected workspace from URL search
// Position: Root page route for the main launcher view

import { AppHeader } from '@renderer/components/layout/app-header'
import { AppLayout } from '@renderer/components/layout/app-layout'
import { NewChatHome } from '@renderer/features/new-chat'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: App,
  validateSearch: (search: Record<string, unknown>) => ({
    workspaceId: typeof search.workspaceId === 'string' ? search.workspaceId : undefined,
  }),
})

function App() {
  const { workspaceId } = Route.useSearch()

  return (
    <AppLayout
      header={<AppHeader />}
      panel={undefined}
    >
      <NewChatHome preferredWorkspaceId={workspaceId ?? null} />
    </AppLayout>
  )
}
