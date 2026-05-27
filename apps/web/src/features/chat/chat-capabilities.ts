import { getServerUrl } from '~/lib/electron'

const SERVER_BASE = getServerUrl()

export interface ChatSlashCommand {
  name: string
  description: string
  argumentHint: string
  aliases?: string[]
}

export interface ChatRuntimeCapabilities {
  runtimeKind: string
  slashCommands: ChatSlashCommand[]
  skills: string[]
}

export async function getChatRuntimeCapabilities(sessionId: string, signal?: AbortSignal): Promise<ChatRuntimeCapabilities> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${encodeURIComponent(sessionId)}/capabilities`, { signal })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to load chat capabilities: ${res.status} ${body}`)
  }
  return await res.json() as ChatRuntimeCapabilities
}
