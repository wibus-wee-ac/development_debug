import { getServerUrl } from '~/lib/electron'

import type { TrayAwaitItem, TraySnapshot } from './types'

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(`${getServerUrl()}${path}`, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function readTraySnapshot(): Promise<TraySnapshot> {
  return readJson<TraySnapshot>('/desktop/tray')
}

export function readTrayAwaits(): Promise<TrayAwaitItem[]> {
  return readJson<TrayAwaitItem[]>('/desktop/tray/awaits')
}
