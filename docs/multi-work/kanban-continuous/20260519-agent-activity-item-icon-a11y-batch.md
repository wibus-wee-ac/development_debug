<!--
Input: AgentActivityItem icon accessibility work, focused test, review report, and validation commands
Output: Batch record for the kanban issue detail agent activity item accessibility node
Position: Multi-work audit trail for continuous kanban UX improvements
-->

# Agent Activity Item Icon A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/kanban/issue-detail`.

The target was the agent session activity item renderer:

- mark the action activity type icon as decorative;
- preserve activity content rendering;
- preserve select elicitation option rendering;
- document the issue-detail regression coverage.

## Changes

- Updated `apps/web/src/features/kanban/issue-detail/agent-activity-item.tsx`.
  - Added the required file header.
  - Marked the action activity wrench icon as `aria-hidden="true"`.
- Added `apps/web/src/features/kanban/issue-detail/agent-activity-item.test.tsx`.
  - Covers action activity content and decorative icon semantics.
  - Covers select elicitation options parsed from valid metadata.
- Updated `apps/web/src/features/kanban/issue-detail/README.md`.
  - Documents agent activity item icon semantics and focused regression tests.

## Review Loop

- ReviewBD: PASS.
  - Report: `docs/multi-work/kanban-continuous/20260519-agent-activity-item-icon-a11y-audit-ReviewBD.md`.
  - Confirmed decorative action activity icon, activity content rendering, select elicitation option rendering, static Tailwind usage, and scoped documentation coverage.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/issue-detail/agent-activity-item.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused AgentActivityItem test: 1 file / 2 tests passed.
- Web typecheck: passed.
- React Doctor: 100/100.
- Full web test: 49 files / 155 tests passed.

## Notes

- This batch intentionally does not change activity type branching, malformed metadata handling, prompt bubble layout, or agent activity fetching.
