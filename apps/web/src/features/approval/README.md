# Features/approval

Approval UI feature for pending agent permission requests. The feature owns renderer-side SSE state, session filtering, optimistic response removal, and inline approval cards rendered in chat.

## Files

- **approval-card.tsx**: Reusable pending approval card and session-scoped approval list.
- **approval-inbox.tsx**: Full-tab pending approval inbox used by Desktop tray actions.
- **approval-state.ts**: Pure helpers for merging, removing, and clearing pending approval payloads from the SSE stream.
- **approval-state.test.ts**: Unit coverage for pending approval state transitions and stale state clearing.
- **use-approval.ts**: SSE subscription hook and HTTP respond action for pending approvals.
