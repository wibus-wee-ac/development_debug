// Input: AppLayout from layout components, TanStack Router
// Output: Index route — composes AppLayout with page-specific aside/panel content
// Position: Root page route, demonstrates composition-based slot pattern

import { AppLayout } from '@renderer/components/layout/app-layout'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <AppLayout
      aside={undefined}
      panel={undefined}
    >
      {/* Main content area — will hold workspace view later */}
    </AppLayout>
  )
}

