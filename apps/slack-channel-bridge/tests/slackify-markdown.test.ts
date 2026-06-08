import { describe, expect, it } from 'vitest'

import { normalizeUnderscoreEmphasis, renderMarkdownForSlack } from '../src/slack/format'

describe('renderMarkdownForSlack', () => {
  it('renders markdown into Slack Block Kit blocks with fallback text', () => {
    const [message] = renderMarkdownForSlack('# Summary\n\n**important** and _useful_\n\n- one\n- two')

    expect(message.text).toBe('Summary\n\nimportant and useful\n- one\n- two')
    expect(message.blocks).toMatchObject([
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'Summary',
        },
      },
      {
        type: 'rich_text',
      },
    ])
  })

  it('keeps markdown tables as structured table blocks', () => {
    const [message] = renderMarkdownForSlack('| A | B |\n|---|---|\n| 1 | 2 |')

    expect(message.text).toBe('A | B\n1 | 2')
    expect(message.blocks[0]).toMatchObject({
      type: 'table',
      rows: expect.any(Array),
    })
  })

  it('uses a stable fallback for empty responses', () => {
    const [message] = renderMarkdownForSlack('')

    expect(message.text).toBe('(No response text.)')
    expect(message.blocks).toHaveLength(1)
  })

  it('normalizes underscore emphasis outside code spans', () => {
    expect(normalizeUnderscoreEmphasis('_italic_ __bold__ a_b_c `__code__`')).toBe(
      '*italic* **bold** a_b_c `__code__`',
    )
  })

  it('does not normalize underscore emphasis inside fenced code blocks', () => {
    const input = 'before _italic_\n```\n__keep__\n```\nafter __bold__'
    expect(normalizeUnderscoreEmphasis(input)).toBe('before *italic*\n```\n__keep__\n```\nafter **bold**')
  })
})
