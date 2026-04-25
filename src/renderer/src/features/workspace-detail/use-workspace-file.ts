// Input: TanStack Query, ipc proxy
// Output: useWorkspaceFile — hook for reading/writing workspace text files
// Position: Data hook for workspace-detail feature

import { ipc } from '@renderer/lib/ipc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export function useWorkspaceFile(workspaceId: string, relativePath: string) {
  const queryClient = useQueryClient()
  const queryKey = ['workspace-file', workspaceId, relativePath]

  const { data: content = null, isLoading: loading } = useQuery({
    queryKey,
    queryFn: () => ipc ? ipc.workspace.readTextFile(workspaceId, relativePath) : Promise.resolve(null),
    enabled: !!workspaceId && !!relativePath,
    staleTime: 30_000,
  })

  const { mutateAsync: save, isPending: saving } = useMutation({
    mutationFn: (newContent: string) =>
      ipc ? ipc.workspace.writeTextFile(workspaceId, relativePath, newContent) : Promise.resolve(false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
    },
  })

  return { content, loading, save, saving }
}
