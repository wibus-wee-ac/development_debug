import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { getWorkspacesByIdFiles } from '~/api-gen/sdk.gen'

type WorkspaceFile = { type: 'file' | 'directory', name: string, path: string }
const WorkspaceFileListSchema = z.array(z.object({
  type: z.enum(['file', 'directory']),
  name: z.string(),
  path: z.string(),
})).default([])

export function useWorkspaceFiles(workspaceId: string | null) {
  const { data: files = [] } = useQuery({
    queryKey: ['workspace-files', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesByIdFiles({ path: { id: workspaceId! } })
      return WorkspaceFileListSchema.parse(data) satisfies WorkspaceFile[]
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  })

  return { files }
}
