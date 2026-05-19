<!--
Input: KanbanToolbar action accessibility work, focused test, review report, and validation commands
Output: Batch record for the kanban toolbar action accessibility node
Position: Multi-work audit trail for continuous kanban UX improvements
-->

# Kanban Toolbar Actions A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/kanban`.

The target was the Kanban toolbar action cluster:

- give icon-only filter, group, sort, display, create, board layout, and list layout controls stable accessible names;
- mark toolbar action icons decorative;
- expose board/list selected state through `aria-pressed`;
- associate toolbar checkbox labels with their controls through explicit `htmlFor`/`id` pairs;
- preserve create and layout callback wiring;
- document the kanban regression coverage.

## Changes

- Updated `apps/web/src/features/kanban/kanban-toolbar.tsx`.
  - Added `aria-label` to icon-only toolbar actions.
  - Marked toolbar action icons as `aria-hidden="true"`.
  - Added `aria-pressed` to board/list layout toggles.
  - Added explicit `htmlFor`/`id` associations for filter and display checkboxes.
- Added `apps/web/src/features/kanban/kanban-toolbar.test.tsx`.
  - Covers toolbar actions by role/name.
  - Verifies action icons are decorative.
  - Verifies layout pressed state and key callbacks.
- Updated `apps/web/src/features/kanban/README.md`.
  - Documents toolbar action accessibility behavior and focused regression tests.

## Review Loop

- ReviewBE: PASS.
  - Report: `docs/multi-work/kanban-continuous/20260519-kanban-toolbar-actions-a11y-audit-ReviewBE.md`.
  - Confirmed named icon-only controls, decorative icon semantics, layout pressed state, callback wiring, static Tailwind usage, and scoped documentation coverage for the initial diff.
- ReviewBF: PASS.
  - Report: `docs/multi-work/kanban-continuous/20260519-kanban-toolbar-actions-a11y-rereview-ReviewBF.md`.
  - Re-reviewed the latest diff after the checkbox label association fix and confirmed the `htmlFor`/`id` additions preserve filter/display config logic.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/kanban-toolbar.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused KanbanToolbar test: 1 file / 2 tests passed.
- Web typecheck: passed.
- React Doctor: 100/100.
- Full web test: 50 files / 157 tests passed.

## Notes

- This batch intentionally does not change filter semantics, dropdown content, display property options, search behavior, or persisted view configuration.
