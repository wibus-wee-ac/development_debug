import { getServerUrl } from '~/lib/electron'
import { z } from 'zod'

import type { TrayAwaitItem } from './types'

const TrayAwaitItemSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  title: z.string(),
  workspaceId: z.string().nullable(),
  workspaceName: z.string(),
  source: z.string(),
  reason: z.string().nullable(),
  createdAt: z.number(),
})

const TrayAwaitItemsSchema = z.array(TrayAwaitItemSchema)

async function requestTrayJson(path: string): Promise<unknown> {
  const response = await fetch(`${getServerUrl()}${path}`, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }
  return response.json()
}

export async function readTrayAwaits(): Promise<TrayAwaitItem[]> {
  return TrayAwaitItemsSchema.parse(await requestTrayJson('/desktop/tray/awaits')) satisfies TrayAwaitItem[]
}
