<!-- Once this directory changes, update this README.md -->

# Features/approval

Approval UI feature for pending agent permission requests. The feature owns renderer-side SSE state, session filtering, optimistic response removal, and inline approval cards rendered in chat.

## Files

- **approval-card.tsx**: Inline chat approval card and session-scoped approval list.
- **approval-state.ts**: Pure helpers for merging, removing, and clearing pending approval payloads from the SSE stream.
- **approval-state.test.ts**: Unit coverage for pending approval state transitions and stale state clearing.
- **use-approval.ts**: SSE subscription hook and HTTP respond action for pending approvals.
