import { getServerUrl } from '~/lib/electron'
import { z } from 'zod'

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

const ChatSlashCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  argumentHint: z.string(),
  aliases: z.array(z.string()).optional(),
})

const ChatRuntimeCapabilitiesSchema = z.object({
  runtimeKind: z.string(),
  slashCommands: z.array(ChatSlashCommandSchema),
  skills: z.array(z.string()),
})

export async function getChatRuntimeCapabilities(sessionId: string, signal?: AbortSignal): Promise<ChatRuntimeCapabilities> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${encodeURIComponent(sessionId)}/capabilities`, { signal })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to load chat capabilities: ${res.status} ${body}`)
  }
  return ChatRuntimeCapabilitiesSchema.parse(await res.json())
}
