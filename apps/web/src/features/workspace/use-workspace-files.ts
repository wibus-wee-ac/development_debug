import { useQuery } from '@tanstack/react-query'

import { getWorkspacesByIdFiles } from '~/api-gen/sdk.gen'

type WorkspaceFile = { type: 'file' | 'directory', name: string, path: string }

export function useWorkspaceFiles(workspaceId: string | null) {
  const { data: files = [] } = useQuery({
    queryKey: ['workspace-files', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesByIdFiles({ path: { id: workspaceId! } })
      return (data ?? []) as WorkspaceFile[]
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  })

  return { files }
}
