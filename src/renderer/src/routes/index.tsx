// Input: AppLayout from layout components, NewChatHome from workspace feature, TanStack Router
// Output: Index route — composes AppLayout with NewChatHome as main content
// Position: Root page route, demonstrates composition-based slot pattern

import { AppLayout } from '@renderer/components/layout/app-layout'
import { NewChatHome } from '@renderer/features/new-chat'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <AppLayout
      aside={undefined}
      panel={undefined}
    >
      <NewChatHome />
    </AppLayout>
  )
}
