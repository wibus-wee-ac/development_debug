// Input: TanStack Router
// Output: /kanban/$boardId route config (params only)
// Position: Critical-path route definition; component lives in kanban.$boardId.lazy.tsx

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/kanban/$boardId')({})

