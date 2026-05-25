// Output: Default English copy for await overview UI.
// Input: Await list, empty states, and await row actions.
// Position: Source of truth for session-await feature i18n namespace.

export default {
  'overview.title': 'Awaits',
  'overview.description': 'Sessions waiting on external signals',
  'empty.title': 'No pending awaits',
  'empty.description': 'Pending CI, review, and timed awaits will appear here.',
  'error.title': 'Awaits unavailable',
  'error.description': 'Desktop await data could not be loaded.',
  'action.openChat': 'Open Chat',
  'relative.justNow': 'just now',
  'relative.minute': '{{count}}m',
  'relative.hour': '{{count}}h',
  'relative.day': '{{count}}d',
} as const
