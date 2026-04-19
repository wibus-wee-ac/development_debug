// Input: ipc proxy from @renderer/lib/ipc, TanStack Query
// Output: useWorkspaces, useAddWorkspace, useDeleteWorkspace hooks
// Position: Data-fetching hooks for workspace feature

import { ipc } from '@renderer/lib/ipc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

export const WORKSPACES_QUERY_KEY = ['workspaces'] as const

export function useWorkspaces() {
  const { data: workspaces = [], isPending: loading } = useQuery({
    queryKey: WORKSPACES_QUERY_KEY,
    queryFn: () => ipc ? ipc.workspace.list() : Promise.resolve([]),
  })

  return { workspaces, loading }
}

export function useAddWorkspace() {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)

  const addFromPicker = useCallback(async () => {
    if (!ipc) { return }
    setAdding(true)
    try {
      const dirPath = await ipc.workspace.selectDirectory()
      if (!dirPath) { return }
      await ipc.workspace.addFromDirectory(dirPath)
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
    mutationFn: (id: string) => ipc ? ipc.workspace.delete(id) : Promise.resolve(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
  })

  return { remove }
}
