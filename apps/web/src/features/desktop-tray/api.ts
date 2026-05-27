import { getServerUrl } from '~/lib/electron'

import type { TrayAwaitItem } from './types'

async function requestTrayJson(path: string): Promise<unknown> {
  const response = await fetch(`${getServerUrl()}${path}`, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }
  return response.json()
}

export async function readTrayAwaits(): Promise<TrayAwaitItem[]> {
  return await requestTrayJson('/desktop/tray/awaits') as TrayAwaitItem[]
}
