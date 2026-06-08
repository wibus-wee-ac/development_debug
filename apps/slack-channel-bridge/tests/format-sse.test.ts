import { describe, expect, it } from 'vitest'

import { renderMarkdownForSlack, stripBotMention, titleFromSlackText } from '../src/slack/format'
import { collectSseText } from '../src/slack/sse'

async function* streamEvents(events: unknown[]) {
  for (const event of events) {
    yield event
  }
}

describe('Slack formatting and SSE collection', () => {
  it('strips mentions and derives stable Slack titles', () => {
    expect(stripBotMention('<@B1> hello', 'B1')).toBe('hello')
    expect(titleFromSlackText('  hello   world  ')).toBe('Slack: hello world')
  })

  it('splits long Slack Block Kit messages', () => {
    const messages = renderMarkdownForSlack(Array.from({ length: 80 }, (_, index) => `# Heading ${index}`).join('\n\n'))
    expect(messages.length).toBeGreaterThan(1)
    expect(messages.every(message => message.blocks.length <= 40)).toBe(true)
  })

  it('collects text-delta chunks from Cradle SSE events', async () => {
    const result = await collectSseText(streamEvents([
      { type: 'start' },
      { type: 'text-delta', delta: 'hello' },
      { type: 'text-delta', delta: ' world' },
      '[DONE]',
    ]))
    expect(result.text).toBe('hello world')
  })
})
