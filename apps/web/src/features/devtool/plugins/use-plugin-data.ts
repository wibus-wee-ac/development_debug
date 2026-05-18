import { useCallback, useEffect, useRef, useState } from 'react'

import { getServerUrl } from '~/lib/electron'

export interface PluginInfo {
  name: string
  version: string
  displayName: string
  description?: string
  hasWeb: boolean
  hasServer: boolean
  hasDesktop: boolean
  serverEntry?: string
  webEntry?: string
  desktopEntry?: string
}

export function usePluginData() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const activatedAtRef = useRef<Map<string, number>>(new Map())

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${getServerUrl()}/api/plugins`)
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`)
      }
      const data = (await res.json()) as PluginInfo[]
      setPlugins(data)
      const now = Date.now()
      for (const p of data) {
        if (!activatedAtRef.current.has(p.name)) {
          activatedAtRef.current.set(p.name, now)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Auto-refresh on visibility change
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [refresh])

  function getActivatedAt(name: string): number | undefined {
    return activatedAtRef.current.get(name)
  }

  return { plugins, loading, error, refresh, getActivatedAt }
}
