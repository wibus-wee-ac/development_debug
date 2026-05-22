import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { z } from 'zod'

import { deleteWorkspacesById, getWorkspaces, postWorkspacesFromDirectory } from '~/api-gen/sdk.gen'
import { useDirectoryPicker } from '~/features/filesystem/directory-picker-provider'
import type { Workspace } from '~/lib/types'

export const WORKSPACES_QUERY_KEY = ['workspaces'] as const

export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  identifier: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export const WorkspaceListSchema = z.array(WorkspaceSchema).default([])

export function useWorkspaces() {
  const { data: workspaces = [], isPending: loading, isSuccess: ready } = useQuery({
    queryKey: WORKSPACES_QUERY_KEY,
    queryFn: async () => {
      const { data } = await getWorkspaces()
      return WorkspaceListSchema.parse(data) satisfies Workspace[]
    },
  })

  return { workspaces, loading, ready }
}

export function useAddWorkspace() {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const { selectDirectory } = useDirectoryPicker()

  const addFromPicker = useCallback(async () => {
    setAdding(true)
    try {
      const dirPath = await selectDirectory({ title: '添加项目', description: '选择一个项目目录导入到 Cradle' })
      if (!dirPath) {
        return
      }
      await postWorkspacesFromDirectory({ body: { path: dirPath } })
      await queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY })
    }
    finally {
      setAdding(false)
    }
  }, [queryClient, selectDirectory])

  return { addFromPicker, adding }
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient()

  const { mutate: remove } = useMutation({
    mutationFn: (id: string) => deleteWorkspacesById({ path: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
  })

  return { remove }
}
