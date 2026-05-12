// Input: generated API SDK, HTTP client from ~/lib/client.config, TanStack Query
// Output: useWorkspaces, useAddWorkspace, useDeleteWorkspace hooks
// Position: Data-fetching hooks for workspace feature

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { deleteWorkspacesById, getWorkspaces, postWorkspacesFromDirectory } from '~/api-gen/sdk.gen'
import { selectDirectory } from '~/lib/directory-picker'
import type { Workspace } from '~/lib/types'

export const WORKSPACES_QUERY_KEY = ['workspaces'] as const

export function useWorkspaces() {
  const { data: workspaces = [], isPending: loading } = useQuery({
    queryKey: WORKSPACES_QUERY_KEY,
    queryFn: async () => {
      const { data } = await getWorkspaces()
      return (data ?? []) as Workspace[]
    },
  })

  return { workspaces, loading }
}

export function useAddWorkspace() {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)

  const addFromPicker = useCallback(async () => {
    setAdding(true)
    try {
      const dirPath = await selectDirectory()
      if (!dirPath) {
        return
      }
      await postWorkspacesFromDirectory({ body: { path: dirPath } })
      await queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY })
    }
    finally {
      setAdding(false)
    }
  }, [queryClient])

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
