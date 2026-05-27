// Output: React Query hooks for reading and writing one workspace file as text.
// Input: Workspace id and workspace-relative file path.
// Position: Workspace-owned data access shared by file peek and editor tab surfaces.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { getWorkspacesByIdGitStatusQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { getWorkspacesByIdFilesContent, putWorkspacesByIdFilesContent } from '~/api-gen/sdk.gen'
import { getServerUrl } from '~/lib/electron'

const WorkspaceFileContentSchema = z.object({
  content: z.string().nullable(),
})

const WorkspaceFileInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number(),
  modifiedAt: z.number(),
  mimeType: z.string(),
  extension: z.string(),
  previewKind: z.enum(['text', 'markdown', 'image', 'pdf', 'office', 'unsupported']),
})

const WorkspaceFileWriteResponseSchema = z.object({
  success: z.boolean(),
})

export type WorkspaceFileInfo = z.infer<typeof WorkspaceFileInfoSchema>

export function workspaceFileContentQueryKey(workspaceId: string | null, path: string | null) {
  return ['workspace-file-content', workspaceId, path] as const
}

export function workspaceFileInfoQueryKey(workspaceId: string | null, path: string | null) {
  return ['workspace-file-info', workspaceId, path] as const
}

export function buildWorkspaceFileRawUrl(workspaceId: string, path: string): string {
  return buildWorkspaceFileUrl(workspaceId, 'raw', path)
}

export function buildWorkspaceFilePdfUrl(workspaceId: string, path: string): string {
  return buildWorkspaceFileUrl(workspaceId, 'rendition/pdf', path)
}

export function useWorkspaceFileInfo(workspaceId: string | null, path: string | null) {
  return useQuery({
    queryKey: workspaceFileInfoQueryKey(workspaceId, path),
    queryFn: async () => {
      const response = await fetch(buildWorkspaceFileUrl(workspaceId!, 'info', path!))
      if (!response.ok) {
        throw new Error(`Workspace file metadata request failed with status ${response.status}.`)
      }
      return WorkspaceFileInfoSchema.parse(await response.json())
    },
    enabled: !!workspaceId && !!path,
    staleTime: 5_000,
  })
}

export function useWorkspaceFileContent(workspaceId: string | null, path: string | null) {
  return useQuery({
    queryKey: workspaceFileContentQueryKey(workspaceId, path),
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

export function useWorkspaceFileContentMutation(workspaceId: string, path: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (content: string) => {
      const { data } = await putWorkspacesByIdFilesContent({
        path: { id: workspaceId },
        body: {
          path,
          content,
          confirmedNonCradleOwnedWrite: true,
        },
        throwOnError: true,
      })
      const result = WorkspaceFileWriteResponseSchema.parse(data)
      if (!result.success) {
        throw new Error('The workspace file was not written.')
      }
      return { content }
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(workspaceFileContentQueryKey(workspaceId, path), saved)
      void queryClient.invalidateQueries({
        queryKey: getWorkspacesByIdGitStatusQueryKey({ path: { id: workspaceId } }),
      })
    },
  })
}

function buildWorkspaceFileUrl(workspaceId: string, route: string, path: string): string {
  const url = new URL(`/workspaces/${encodeURIComponent(workspaceId)}/files/${route}`, getServerUrl())
  url.searchParams.set('path', path)
  return url.toString()
}
