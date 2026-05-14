/**
 * Convert Markdown to Slack mrkdwn format.
 *
 * Key differences:
 * - **bold** → *bold*
 * - [text](url) → <url|text>
 * - # Header → *Header*
 * - Images are stripped (Slack can't render inline images in mrkdwn)
 *
 * Note: Slack `mrkdwn` is not full Markdown. For rich Markdown features like
 * tables, prefer sending a `markdown` block instead of converting to mrkdwn.
 */
export function markdownToSlackMrkdwn(md: string): string {
  let result = md

  // Headers → bold
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*')

  // Bold: **text** or __text__ → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*')
  result = result.replace(/__(.+?)__/g, '*$1*')

  // Italic: *text* (single) or _text_ → _text_ (Slack italic)
  // Be careful not to break bold we just converted
  // Slack uses _text_ for italic, which is same as markdown

  // Images: ![alt](url) → stripped or just show url (must be before links)
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<$2|📎 $1>')

  // Links: [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')

  // Strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, '~$1~')

  // Horizontal rule
  result = result.replace(/^(-{3,}|_{3,}|\*{3,})$/gm, '───────────────')

  return result
}

/**
 * Maximum message length before auto-collapsing.
 * We keep this lower than Slack's payload limits for readability.
 */
const MAX_MESSAGE_LENGTH = 3000

/**
 * Format a zhi message for Slack markdown block posting.
 * If the message is too long, splits into a summary + full content as snippet.
 *
 * Returns either:
 * - { type: 'inline', text: string } for short messages
 * - { type: 'split', summary: string, full: string } for long messages
 */
export function formatForSlack(message: string): SlackMessage {
  const formatted = message

  if (formatted.length <= MAX_MESSAGE_LENGTH) {
    return { type: 'inline', text: formatted }
  }

  // Truncate at a natural break point
  const truncated = truncateAtBreak(formatted, MAX_MESSAGE_LENGTH - 100)
  const summary = truncated + '\n\n_…message truncated. Full content in thread below._'

  return { type: 'split', summary, full: formatted }
}

export type SlackMessage =
  | { type: 'inline'; text: string }
  | { type: 'split'; summary: string; full: string }

function truncateAtBreak(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text

  // Try to break at paragraph
  const paragraphBreak = text.lastIndexOf('\n\n', maxLen)
  if (paragraphBreak > maxLen * 0.5) return text.slice(0, paragraphBreak)

  // Try to break at line
  const lineBreak = text.lastIndexOf('\n', maxLen)
  if (lineBreak > maxLen * 0.5) return text.slice(0, lineBreak)

  // Hard cut at word boundary
  const spaceBreak = text.lastIndexOf(' ', maxLen)
  if (spaceBreak > maxLen * 0.7) return text.slice(0, spaceBreak)

  return text.slice(0, maxLen)
}
