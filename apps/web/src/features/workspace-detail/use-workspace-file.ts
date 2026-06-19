import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getWorkspacesByIdFilesContent, putWorkspacesByIdFilesContent } from '~/api-gen/sdk.gen'

export function useWorkspaceFile(workspaceId: string, relativePath: string) {
  const queryClient = useQueryClient()
  const queryKey = ['workspace-file', workspaceId, relativePath]

  const { data: content = null, isLoading: loading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data } = await getWorkspacesByIdFilesContent({
        path: { id: workspaceId },
        query: { path: relativePath },
      })
      const raw = data as { content?: string | null } | null | undefined
      return raw?.content ?? null
    },
    enabled: !!workspaceId && !!relativePath,
    staleTime: 30_000,
  })

  const { mutateAsync: save, isPending: saving } = useMutation({
    mutationFn: async (newContent: string) => {
      const { data } = await putWorkspacesByIdFilesContent({
        path: { id: workspaceId },
        body: { path: relativePath, content: newContent, confirmedNonCradleOwnedWrite: true },
      })
      if (!data?.success) {
        throw new Error('The workspace file was not written.')
      }
      return newContent
    },
    onSuccess: (newContent) => {
      queryClient.setQueryData(queryKey, newContent)
      void queryClient.invalidateQueries({ queryKey })
    },
  })

  return { content, loading, save, saving }
}
