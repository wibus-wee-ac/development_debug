// Input: TanStack Router redirect
// Output: Settings redirect — /settings redirects to / since settings are sidebar-driven
// Position: Kept for URL compatibility; sidebar handles settings state internally

import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  beforeLoad: () => {
    throw redirect({ to: '/', search: { workspaceId: undefined } })
  },
  component: () => null,
  validateSearch: (search: Record<string, unknown>) => ({
    section: (search.section as string | undefined) ?? 'appearance',
  }),
})
