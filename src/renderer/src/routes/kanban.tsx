// Input: TanStack Router
// Output: /kanban layout route config
// Position: Critical-path route definition; layout component lives in kanban.lazy.tsx

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/kanban')({})
