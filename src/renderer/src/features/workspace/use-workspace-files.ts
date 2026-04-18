// Input: ipc proxy from @renderer/lib/ipc, TanStack Query
// Output: useWorkspaceFiles — returns file list for @ mention feature
// Position: Data-fetching hook for workspace file listing

import { ipc } from '@renderer/lib/ipc'
import { useQuery } from '@tanstack/react-query'

export function useWorkspaceFiles(workspaceId: string | null) {
  const { data: files = [] } = useQuery({
    queryKey: ['workspace-files', workspaceId],
    queryFn: () => ipc && workspaceId ? ipc.workspace.listFiles(workspaceId) : Promise.resolve([]),
    enabled: !!workspaceId,
    staleTime: 30_000,
  })

  return { files }
}
