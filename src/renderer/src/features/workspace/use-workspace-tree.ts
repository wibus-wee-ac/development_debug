// Input: flat file list from ipc.workspace.listFiles
// Output: useWorkspaceTree — structured tree data for file tree rendering
// Position: Data hook for the right aside file tree panel

import { ipc } from '@renderer/lib/ipc'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children: TreeNode[]
}

function buildTree(entries: Array<{ type: 'file' | 'directory', name: string, path: string }>): TreeNode[] {
  const root: TreeNode[] = []
  const dirMap = new Map<string, TreeNode>()

  // Sort: directories first, then by path
  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1
    }
    return a.path.localeCompare(b.path)
  })

  for (const entry of sorted) {
    const node: TreeNode = { ...entry, children: [] }
    const parts = entry.path.split('/')
    if (parts.length === 1) {
      root.push(node)
    }
    else {
      const parentPath = parts.slice(0, -1).join('/')
      const parent = dirMap.get(parentPath)
      if (parent) {
        parent.children.push(node)
      }
      else {
        root.push(node)
      }
    }
    if (entry.type === 'directory') {
      dirMap.set(entry.path, node)
    }
  }

  return root
}

export function useWorkspaceTree(workspaceId: string | null) {
  const { data: files = [], isLoading } = useQuery({
    queryKey: ['workspace-files', workspaceId],
    queryFn: () => ipc && workspaceId ? ipc.workspace.listFiles(workspaceId) : Promise.resolve([]),
    enabled: !!workspaceId,
    staleTime: 30_000,
  })

  const tree = useMemo(() => buildTree(files), [files])

  return { tree, isLoading }
}
