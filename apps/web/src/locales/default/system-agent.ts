// Output: Default English copy for the system agent popover.
// Input: Jarvis empty states, setup guidance, and context-aware helper text.
// Position: Source of truth for system-agent feature i18n namespace.

export default {
  'action.close': 'Close',
  'action.collapse': 'Collapse',
  'action.expand': 'Expand',
  'action.attachSelection': 'Attach selection',
  'action.removeContext': 'Remove context',
  'action.send': 'Send',
  'action.stop': 'Stop',
  'empty.noProfile.title': 'No profile configured',
  'empty.noProfile.description': 'Go to Settings → Jarvis and select a provider profile and model.',
  'empty.ready.title': 'What can I help with?',
  'empty.ready.description': 'I have full awareness of your workspace, active tabs, chat sessions, and current layout.',
  'error.createSessionFailed': 'Failed to create session',
  'error.noTextSelection': 'Select text first to attach it.',
  'error.sessionCreationFailed': 'Session creation failed',
  'input.aria': 'Jarvis message',
  'input.includeContext': 'Include context',
  'input.placeholder.ask': 'Ask Jarvis...',
  'input.placeholder.configureProfile': 'Configure a profile in Settings → Jarvis',
} as const
