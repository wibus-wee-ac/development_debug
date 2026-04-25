// Input: TanStack Router
// Output: /workspace/$workspaceId route config (params only)
// Position: Critical-path route definition; component lives in workspace.$workspaceId.lazy.tsx

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/workspace/$workspaceId')({})

