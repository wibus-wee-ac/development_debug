// Input: ipc proxy from @renderer/lib/ipc, React hooks
// Output: useWorkspaces, useAddWorkspace, useDeleteWorkspace hooks
// Position: Data-fetching hooks for workspace feature

import { ipc } from '@renderer/lib/ipc'
import { useCallback, useEffect, useState } from 'react'

type Workspace = Awaited<ReturnType<typeof window.ipc.workspace.list>>[number]

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!ipc) {
      setLoading(false)
      return
    }
    const list = await ipc.workspace.list()
    setWorkspaces(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { workspaces, loading, refresh }
}

export function useAddWorkspace(onSuccess: () => void) {
  const [adding, setAdding] = useState(false)

  const addFromPicker = useCallback(async () => {
    if (!ipc) {
      return
    }
    setAdding(true)
    try {
      const dirPath = await ipc.workspace.selectDirectory()
      if (!dirPath) {
        return
      }
      await ipc.workspace.addFromDirectory(dirPath)
      onSuccess()
    }
    finally {
      setAdding(false)
    }
  }, [onSuccess])

  return { addFromPicker, adding }
}

export function useDeleteWorkspace(onSuccess: () => void) {
  const remove = useCallback(async (id: string) => {
    if (!ipc) {
      return
    }
    await ipc.workspace.delete(id)
    onSuccess()
  }, [onSuccess])

  return { remove }
}
