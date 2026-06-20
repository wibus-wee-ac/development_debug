/* Fetch hooks for the Nowledge Mem plugin. Plugins don't have access to the
   host TanStack Query runtime, so we roll thin hooks on plain useState with
   AbortController + signature-keyed re-fetching. */

import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  ConfigFormState,
  ContextBundle,
  MemorySearchResponse,
  NowledgePluginConfig,
  NowledgeStatus,
  RouteResponse,
  ThreadDetail,
  ThreadSearchResponse,
  WorkingMemory,
} from './types'

/* ─── Response unwrap helper ─────────────────────────────────────────── */

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as RouteResponse<T> | null
  if (!res.ok || !body || body.ok === false) {
    const message = body && body.ok === false ? body.message : `HTTP ${res.status}`
    throw new Error(message)
  }
  return body.data
}

/* ─── Direct API helpers (used by hooks + savers) ─────────────────────── */

export async function fetchConfig(routes: WebPluginContext['routes']): Promise<NowledgePluginConfig> {
  return unwrap<NowledgePluginConfig>(await routes.fetch('/config'))
}

export async function fetchStatus(routes: WebPluginContext['routes']): Promise<NowledgeStatus> {
  return unwrap<NowledgeStatus>(await routes.fetch('/status'))
}

export async function putConfig(
  routes: WebPluginContext['routes'],
  form: ConfigFormState,
): Promise<NowledgePluginConfig> {
  const res = await routes.fetch('/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      apiUrl: form.apiUrl.trim() || undefined,
      mcpUrl: deriveMcp(form.apiUrl.trim()),
      spaceId: form.spaceId.trim() || null,
      enabled: form.enabled,
    }),
  })
  return unwrap<NowledgePluginConfig>(res)
}

function deriveMcp(apiUrl: string): string {
  const base = apiUrl.trim().replace(/\/+$/, '')
  return `${base || 'http://127.0.0.1:14242'}/mcp`
}

async function fetchJson<T>(
  routes: WebPluginContext['routes'],
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await routes.fetch(path, { signal })
  return unwrap<T>(res)
}

/* ─── useNowledgeConfig: read/write config with saveState ─────────────── */

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export function useNowledgeConfig(routes: WebPluginContext['routes'], enabled: boolean) {
  const [config, setConfig] = useState<NowledgePluginConfig | null>(null)
  const [form, setForm] = useState<ConfigFormState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await fetchConfig(routes)
      setConfig(next)
      setForm(toForm(next))
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setLoading(false)
    }
  }, [routes])

  useEffect(() => {
    if (!enabled) { return }
    queueMicrotask(() => void refresh())
  }, [enabled, refresh])

  const save = useCallback(async (next: ConfigFormState) => {
    setLoading(true)
    setError(null)
    try {
      const updated = await putConfig(routes, next)
      setConfig(updated)
      setForm(toForm(updated))
      return updated
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      throw err
    }
    finally {
      setLoading(false)
    }
  }, [routes])

  return { config, form, loading, error, refresh, save }
}

function toForm(config: NowledgePluginConfig): ConfigFormState {
  return {
    apiUrl: config.apiUrl,
    mcpUrl: config.mcpUrl ?? deriveMcp(config.apiUrl),
    spaceId: config.spaceId ?? '',
    enabled: config.enabled,
  }
}

/* ─── useNowledgeStatus: poll status (debounced refresh) ──────────────── */

export function useNowledgeStatus(
  routes: WebPluginContext['routes'],
  enabled: boolean,
  pollMs = 30_000,
) {
  const [status, setStatus] = useState<NowledgeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await fetchStatus(routes)
      setStatus(next)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setLoading(false)
    }
  }, [routes])

  useEffect(() => {
    if (!enabled) { return }
    queueMicrotask(() => void refresh())
    if (!pollMs) { return }
    const id = setInterval(() => void refresh(), pollMs)
    return () => clearInterval(id)
  }, [enabled, refresh, pollMs])

  return { status, error, loading, refresh }
}

/* ─── useNowledgeData: generic single-fetch hook ──────────────────────── */

interface UseNowledgeDataOptions {
  enabled?: boolean
}

function useNowledgeData<T>(
  routes: WebPluginContext['routes'],
  path: string | null,
  options: UseNowledgeDataOptions = {},
) {
  const { enabled = true } = options
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    if (!path) { return }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    try {
      const next = await fetchJson<T>(routes, path, ctrl.signal)
      if (!ctrl.signal.aborted) { setData(next) }
    }
    catch (err) {
      if (ctrl.signal.aborted) { return }
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      if (!ctrl.signal.aborted) { setLoading(false) }
    }
  }, [routes, path])

  useEffect(() => {
    if (!enabled || !path) { return }
    void refresh()
    return () => abortRef.current?.abort()
  }, [enabled, path, refresh])

  return { data, error, loading, refresh }
}

/* ─── Concrete data hooks ─────────────────────────────────────────────── */

export function useWorkingMemory(
  routes: WebPluginContext['routes'],
  spaceId: string | null,
  enabled: boolean,
) {
  const path = enabled ? withQuery('/working-memory', { space_id: spaceId }) : null
  return useNowledgeData<WorkingMemory>(routes, path, { enabled })
}

export function useContextBundle(
  routes: WebPluginContext['routes'],
  spaceId: string | null,
  enabled: boolean,
) {
  const path = enabled
    ? withQuery('/context-bundle', { space_id: spaceId, include_working_memory: 'false' })
    : null
  return useNowledgeData<ContextBundle>(routes, path, { enabled })
}

export interface MemorySearchParams {
  q: string
  mode: 'fast' | 'deep'
  limit: number
  spaceId?: string | null
}

export function useMemorySearch(
  routes: WebPluginContext['routes'],
  params: MemorySearchParams,
  enabled: boolean,
) {
  const { q, mode, limit, spaceId } = params
  const trimmed = q.trim()
  const path = enabled && trimmed.length > 0
    ? withQuery('/memories/search', { q: trimmed, mode, limit, space_id: spaceId })
    : null
  return useNowledgeData<MemorySearchResponse>(routes, path, { enabled })
}

export interface ThreadSearchParams {
  query: string
  source?: string
  limit: number
  spaceId?: string | null
}

export function useThreadSearch(
  routes: WebPluginContext['routes'],
  params: ThreadSearchParams,
  enabled: boolean,
) {
  const { query, source, limit, spaceId } = params
  const trimmed = query.trim()
  const path = enabled && trimmed.length > 0
    ? withQuery('/threads/search', { query: trimmed, source, limit, space_id: spaceId })
    : null
  return useNowledgeData<ThreadSearchResponse>(routes, path, { enabled })
}

export function useThread(
  routes: WebPluginContext['routes'],
  threadId: string | null,
  spaceId: string | null,
  enabled: boolean,
) {
  const path = enabled && threadId
    ? withQuery(`/threads/${encodeURIComponent(threadId)}`, { limit: 100, space_id: spaceId })
    : null
  return useNowledgeData<ThreadDetail>(routes, path, { enabled })
}

/* ─── Mutations ───────────────────────────────────────────────────────── */

export function useCreateMemory(routes: WebPluginContext['routes']) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutate = useCallback(async (content: string) => {
    setPending(true)
    setError(null)
    try {
      const res = await routes.fetch('/memories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      return await unwrap<unknown>(res)
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      throw err
    }
    finally {
      setPending(false)
    }
  }, [routes])

  return { mutate, pending, error }
}

/* ─── Query string helper ─────────────────────────────────────────────── */

function withQuery(path: string, params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') { continue }
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `${path}?${qs}` : path
}
