// Output: Default English copy for approval request UI.
// Input: Approval inbox, request rows, and response actions.
// Position: Source of truth for approval feature i18n namespace.

export default {
  'inbox.title': 'Approvals',
  'inbox.description': 'Pending agent permission requests',
  'empty.title': 'No pending approvals',
  'empty.description': 'Agent approval requests will appear here.',
  'request.prefix': 'Permission required:',
  'action.allow': 'Allow',
  'action.allowAlways': 'Always Allow',
  'action.deny': 'Deny',
} as const
