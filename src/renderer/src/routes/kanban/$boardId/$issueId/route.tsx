// Input: TanStack Router redirect
// Output: Redirect from old /kanban/$boardId/$issueId to new ?issue= pattern
// Position: Backward-compatible redirect for the old issue detail route

import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/kanban/$boardId/$issueId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/kanban/$boardId',
      params: { boardId: params.boardId },
      search: { issue: params.issueId },
      replace: true,
    })
  },
  component: () => null,
})
