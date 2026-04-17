// Input: ipc proxy from @renderer/lib/ipc, React hooks
// Output: useSessions hook
// Position: Data-fetching hooks for session feature under workspace

import { ipc } from '@renderer/lib/ipc'
import { useCallback, useEffect, useState } from 'react'

type Session = Awaited<ReturnType<typeof window.ipc.session.list>>[number]

export function useSessions(workspaceId: string | null) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setSessions([])
      return
    }
    if (!ipc) {
      return
    }
    setLoading(true)
    const list = await ipc.session.list(workspaceId)
    setSessions(list)
    setLoading(false)
  }, [workspaceId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { sessions, loading, refresh }
}
