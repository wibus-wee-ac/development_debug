import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getWorkspacesByIdFilesContentOptions,
  getWorkspacesByIdFilesContentQueryKey,
  getWorkspacesByIdFilesInfoOptions,
  getWorkspacesByIdFilesInfoQueryKey,
  getWorkspacesByIdGitRepositoriesQueryKey,
  getWorkspacesByIdGitStatusQueryKey,
  putWorkspacesByIdFilesContentMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type { Options } from '~/api-gen/sdk.gen'
import type {
  GetWorkspacesByIdFilesInfoResponse,
  PutWorkspacesByIdFilesContentData,
} from '~/api-gen/types.gen'
import { getServerUrl } from '~/lib/electron'

export type WorkspaceFileInfo = GetWorkspacesByIdFilesInfoResponse

export function workspaceFileContentQueryKey(workspaceId: string | null, path: string | null) {
  return workspaceId && path
    ? getWorkspacesByIdFilesContentQueryKey({ path: { id: workspaceId }, query: { path } })
    : ['getWorkspacesByIdFilesContent', workspaceId, path] as const
}

export function workspaceFileInfoQueryKey(workspaceId: string | null, path: string | null) {
  return workspaceId && path
    ? getWorkspacesByIdFilesInfoQueryKey({ path: { id: workspaceId }, query: { path } })
    : ['getWorkspacesByIdFilesInfo', workspaceId, path] as const
}

export function buildWorkspaceFileRawUrl(workspaceId: string, path: string): string {
  return buildWorkspaceFileUrl(workspaceId, 'raw', path)
}

export function buildWorkspaceFilePdfUrl(workspaceId: string, path: string): string {
  return buildWorkspaceFileUrl(workspaceId, 'rendition/pdf', path)
}

export function useWorkspaceFileInfo(workspaceId: string | null, path: string | null) {
  return useQuery({
    ...getWorkspacesByIdFilesInfoOptions({ path: { id: workspaceId! }, query: { path: path! } }),
    enabled: !!workspaceId && !!path,
    staleTime: 5_000,
  })
}

export function useWorkspaceFileContent(workspaceId: string | null, path: string | null) {
  return useQuery({
    ...getWorkspacesByIdFilesContentOptions({ path: { id: workspaceId! }, query: { path: path! } }),
    enabled: !!workspaceId && !!path,
    staleTime: 5_000,
  })
}

export function useWorkspaceFileContentMutation(workspaceId: string, path: string) {
  const queryClient = useQueryClient()

  return useMutation({
    ...putWorkspacesByIdFilesContentMutation({ path: { id: workspaceId } }),
    onSuccess: (result, variables) => {
      if (!result.success) {
        throw new Error('The workspace file was not written.')
      }
      queryClient.setQueryData(workspaceFileContentQueryKey(workspaceId, path), { content: variables.body.content })
      void queryClient.invalidateQueries({
        queryKey: getWorkspacesByIdGitRepositoriesQueryKey({ path: { id: workspaceId } }),
      })
      void queryClient.invalidateQueries({
        queryKey: getWorkspacesByIdGitStatusQueryKey({ path: { id: workspaceId } }),
      })
    },
  })
}

export function buildWorkspaceFileContentMutationInput(
  workspaceId: string,
  path: string,
  content: string,
): Options<PutWorkspacesByIdFilesContentData> {
  return {
    path: { id: workspaceId },
    body: {
      path,
      content,
      confirmedNonCradleOwnedWrite: true,
    },
  }
}

function buildWorkspaceFileUrl(workspaceId: string, route: string, path: string): string {
  const url = new URL(`/workspaces/${encodeURIComponent(workspaceId)}/files/${route}`, getServerUrl())
  url.searchParams.set('path', path)
  return url.toString()
}
