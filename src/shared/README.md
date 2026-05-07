<!-- Once this directory changes, update this README.md -->

# Src/Shared

Shared contracts live here when they must be imported by more than one runtime target.
Keep this directory focused on serializable data shapes and light helpers, not feature orchestration.
When a contract changes here, verify both main/preload and renderer consumers in the same patch.

## Files

- **chat-events.ts**: Shared chat push payloads for preload/main/renderer, carrying session-scoped typed timeline events and global terminal chat activity summaries
- **chat-preferences.ts**: Shared chat preference helpers and serializable preference shapes
- **push-events.ts**: Canonical push topic map for the unified signal broadcaster, including chat/pty/approval/observability channels
- **approval-events.ts**: Shared approval request/resolve payload contracts used by main and renderer
- **timeline-projection.ts**: Pure projection helpers that convert timeline events into UIMessage chunks/messages; renderer hydration now composes per-message grouping locally instead of using a shared grouping shim
