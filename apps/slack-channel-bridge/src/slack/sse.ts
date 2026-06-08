export interface CollectedSseResponse {
  text: string
}

function readTextDelta(event: unknown): string {
  if (!event || typeof event !== 'object') {
    return ''
  }
  const record = event as Record<string, unknown>
  if (record.type === 'text-delta' && typeof record.delta === 'string') {
    return record.delta
  }
  if (record.type === 'text_delta' && typeof record.delta === 'string') {
    return record.delta
  }
  if (record.type === 'text' && typeof record.text === 'string') {
    return record.text
  }
  if (record.type === 'message_delta' && typeof record.text === 'string') {
    return record.text
  }
  return ''
}

export async function collectSseText(stream: AsyncIterable<unknown>): Promise<CollectedSseResponse> {
  let text = ''
  for await (const event of stream) {
    if (event === '[DONE]') {
      break
    }
    text += readTextDelta(event)
  }
  return { text }
}
