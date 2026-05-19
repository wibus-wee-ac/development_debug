# Approval SSE State Batch

## Scope

This batch continued the Cradle UX/DX improvement stream in `apps/web/src/features/approval`.

The target was renderer-side pending approval state:

- prevent stale approval cards from surviving SSE reconnects;
- make pending approval merge/remove/clear behavior testable;
- add feature ownership documentation for the approval directory.

## Changes

- Added `apps/web/src/features/approval/approval-state.ts`.
  - `mergePendingApprovals()` preserves order, dedupes by id, and keeps array identity when unchanged.
  - `removePendingApproval()` keeps array identity when the id is absent.
  - `clearPendingApprovals()` keeps array identity when there is no local state to clear.
- Added `apps/web/src/features/approval/approval-state.test.ts`.
  - Covers merge, duplicate no-op, remove, missing-id no-op, and empty clear identity.
- Updated `apps/web/src/features/approval/use-approval.ts`.
  - Uses the pure helpers for SSE `requested`, SSE `resolved`, optimistic response removal, and SSE `open` reconnect reset.
  - Notifies subscribers when reconnect clears stale local approvals.
- Added `apps/web/src/features/approval/README.md`.
  - Documents approval feature ownership and file inventory.

## Review Loop

- ReviewR passed.
- Non-blocking follow-up: add an EventSource/hook-level test later to lock `open -> clear -> notify` and duplicate requested/resolved no-op behavior directly.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/approval/approval-state.test.ts
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest . --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Approval targeted test: 1 file / 3 tests passed.
- Web typecheck: passed.
- React Doctor diff scan: 100/100, no issues.
- Web full test suite: 30 files / 110 tests passed.

## Notes

- Server SSE currently sends the existing pending approvals as an initial burst on each connection. Clearing local pending approvals on `open` is therefore a conservative stale-state fix.
- Avoiding reconnect flicker would need a snapshot boundary in the SSE protocol instead of client-side guessing.
