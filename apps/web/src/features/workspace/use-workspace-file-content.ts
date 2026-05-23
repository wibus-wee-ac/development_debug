// Output: React Query hook for reading one workspace file as text.
// Input: Workspace id and workspace-relative file path.
// Position: Workspace-owned data access shared by file peek and editor tab surfaces.

import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { getWorkspacesByIdFilesContent } from '~/api-gen/sdk.gen'

const WorkspaceFileContentSchema = z.object({
  content: z.string().nullable(),
})

export function useWorkspaceFileContent(workspaceId: string | null, path: string | null) {
  return useQuery({
    queryKey: ['workspace-file-content', workspaceId, path],
    queryFn: async () => {
      const { data } = await getWorkspacesByIdFilesContent({
        path: { id: workspaceId! },
        query: { path: path! },
      })
      return WorkspaceFileContentSchema.parse(data)
    },
    enabled: !!workspaceId && !!path,
    staleTime: 5_000,
  })
}
