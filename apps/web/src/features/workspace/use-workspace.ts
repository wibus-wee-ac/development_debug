import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import {
  deleteWorkspacesByIdMutation,
  getWorkspacesOptions,
  getWorkspacesQueryKey,
  patchWorkspacesByIdMutation,
  postWorkspacesFromDirectoryMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import { useDirectoryPicker } from '~/features/filesystem/directory-picker-provider'
import { useSessionLayoutStore } from '~/store/session-layout'

export const WORKSPACES_QUERY_KEY = getWorkspacesQueryKey()

export function useWorkspaces() {
  const { data: workspaces = [], isPending: loading, isSuccess: ready } = useQuery({
    ...getWorkspacesOptions(),
  })

  useEffect(() => {
    useSessionLayoutStore.getState().upsertWorkspaces(workspaces.map(workspace => ({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspacePath: workspace.path,
    })))
  }, [workspaces])

  return { workspaces, loading, ready }
}

export function useAddWorkspace() {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const { selectDirectory } = useDirectoryPicker()
  const addWorkspace = useMutation({
    ...postWorkspacesFromDirectoryMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
  })

  const addFromPicker = useCallback(async () => {
    setAdding(true)
    try {
      const dirPath = await selectDirectory({ title: '添加项目', description: '选择一个项目目录导入到 Cradle' })
      if (!dirPath) {
        return
      }
      await addWorkspace.mutateAsync({ body: { path: dirPath } })
    }
    finally {
      setAdding(false)
    }
  }, [addWorkspace, selectDirectory])

  return { addFromPicker, adding }
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient()

  const { mutate: remove } = useMutation({
    ...deleteWorkspacesByIdMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
  })

  return { remove }
}

export function useToggleWorkspacePin() {
  const queryClient = useQueryClient()

  const { mutate: togglePin } = useMutation({
    ...patchWorkspacesByIdMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
  })

  return { togglePin }
}
