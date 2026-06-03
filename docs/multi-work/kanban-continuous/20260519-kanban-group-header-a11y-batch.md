# Kanban Group Header A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/kanban`.

The target was the list group header:

- expose collapsed/expanded state on the group toggle;
- mark the toggle chevron icon decorative;
- give the icon-only create action a stable accessible name;
- keep the create action visible on keyboard focus;
- preserve toggle and create callback wiring;
- document the kanban regression coverage.

## Changes

- Updated `apps/web/src/features/kanban/kanban-group-header.tsx`.
  - Added `aria-expanded` to the group toggle.
  - Marked the toggle chevron icon as `aria-hidden="true"`.
  - Added `aria-label` to the group create action.
  - Marked the create icon as `aria-hidden="true"`.
  - Added `focus-visible:opacity-100` so keyboard focus reveals the create action.
- Added `apps/web/src/features/kanban/kanban-group-header.test.tsx`.
  - Covers group toggle expanded state, decorative icon semantics, and callback wiring.
  - Covers the named create action, decorative icon semantics, keyboard-visible class, and callback wiring.
- Updated `apps/web/src/features/kanban/README.md`.
  - Documents group header accessibility behavior and focused regression tests.

## Review Loop

- ReviewBG: FAIL.
  - Report: `docs/multi-work/kanban-continuous/20260519-kanban-group-header-a11y-audit-ReviewBG.md`.
  - Blocking findings: focused test covered expanded state but not collapsed state; README diff includes cumulative inventory changes from earlier closed nodes.
- Fix after ReviewBG:
  - Added collapsed-state assertion for `aria-expanded="false"` in the create-action test case.
  - Kept README content intact because the unrelated inventory lines belong to earlier closed nodes in the dirty worktree; this group-header node adds only the `kanban-group-header.tsx` and `kanban-group-header.test.tsx` entries.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/kanban-group-header.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused KanbanGroupHeader test: 1 file / 2 tests passed before ReviewBG fix.
- Focused KanbanGroupHeader test after ReviewBG fix: pending.
- Web typecheck: passed.
- React Doctor: 100/100.
- Full web test: 51 files / 159 tests passed.

## Notes

- This batch intentionally does not change group ordering, list filtering, create issue routing, or motion rotation behavior.
