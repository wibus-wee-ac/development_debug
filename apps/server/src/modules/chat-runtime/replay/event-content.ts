import type { ChatRuntimeEventRecord } from '../events'

export interface ReplayTextMessage {
  role: 'user' | 'assistant'
  content: string
  eventId: string
  messageId: string | null
}

export function readReplayTextMessages(events: ChatRuntimeEventRecord[]): ReplayTextMessage[] {
  const messages: ReplayTextMessage[] = []

  for (const event of events) {
    if (event.type === 'user_message.appended') {
      messages.push({
        role: 'user',
        content: readText(event.payload),
        eventId: event.id,
        messageId: event.messageId,
      })
    }
    if (event.type === 'assistant_message.snapshot_recorded') {
      messages.push({
        role: 'assistant',
        content: readText(event.payload),
        eventId: event.id,
        messageId: event.messageId,
      })
    }
  }

  return messages
}

export function readText(payload: Record<string, unknown>): string {
  if (typeof payload.text === 'string') {
    return payload.text
  }
  if (typeof payload.content === 'string') {
    return payload.content
  }
  if (Array.isArray(payload.parts)) {
    const text = payload.parts
      .map((part) => {
        if (!part || typeof part !== 'object' || Array.isArray(part)) {
          return null
        }
        return typeof (part as Record<string, unknown>).text === 'string'
          ? (part as Record<string, unknown>).text
          : null
      })
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join('\n')
      .trim()
    if (text) {
      return text
    }
  }
  return ''
}

export function stringifyReplayValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value ?? {})
  }
  catch {
    return JSON.stringify({ unserializable: true })
  }
}
