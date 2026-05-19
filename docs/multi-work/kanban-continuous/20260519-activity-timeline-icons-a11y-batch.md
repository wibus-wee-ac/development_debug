<!--
Input: ActivityTimeline icon accessibility work, focused test, review report, and validation commands
Output: Batch record for the kanban issue detail activity timeline accessibility node
Position: Multi-work audit trail for continuous kanban UX improvements
-->

# Activity Timeline Icons A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/kanban/issue-detail`.

The target was the issue activity timeline:

- mark system activity icons as decorative;
- mark agent activity icons as decorative;
- preserve trimmed comment submission payload behavior;
- document the issue-detail regression coverage.

## Changes

- Updated `apps/web/src/features/kanban/issue-detail/activity-timeline.tsx`.
  - Added the required file header.
  - Marked system event icons as `aria-hidden="true"`.
  - Marked the agent comment icon as `aria-hidden="true"`.
- Added `apps/web/src/features/kanban/issue-detail/activity-timeline.test.tsx`.
  - Covers system and agent activity icon decorative semantics.
  - Covers the Comment action by role/name.
  - Verifies comment submit trims content, sends the expected payload, and clears the input.
- Updated `apps/web/src/features/kanban/issue-detail/README.md`.
  - Documents activity timeline icon semantics and focused regression tests.

## Review Loop

- ReviewBC: PASS.
  - Report: `docs/multi-work/kanban-continuous/20260519-activity-timeline-icons-a11y-audit-ReviewBC.md`.
  - Confirmed decorative system/agent activity icons, named Comment action, trimmed payload behavior, static Tailwind usage, and scoped documentation coverage.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/issue-detail/activity-timeline.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused ActivityTimeline test: 1 file / 2 tests passed.
- Web typecheck: passed.
- React Doctor: 100/100.
- Full web test: 48 files / 153 tests passed.

## Notes

- This batch intentionally does not change comment fetching, relative time formatting, user avatar rendering, or comment mutation invalidation semantics.
