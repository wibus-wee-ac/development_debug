# Issue Header Actions A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/kanban/issue-detail`.

The target was the issue detail header action row:

- give the icon-only back button a stable accessible name;
- give the icon-only issue actions menu trigger a stable accessible name;
- mark header action icons and the delete menu item icon decorative;
- preserve back and delete callback wiring;
- document the issue-detail regression coverage.

## Changes

- Updated `apps/web/src/features/kanban/issue-detail/issue-header.tsx`.
  - Added the required file header.
  - Added `aria-label="Back to board"` to the back button.
  - Added `aria-label="Issue actions"` to the menu trigger.
  - Marked back, menu, and delete icons as `aria-hidden="true"`.
- Added `apps/web/src/features/kanban/issue-detail/issue-header.test.tsx`.
  - Covers back and issue actions controls by role/name.
  - Verifies action icons are decorative.
  - Verifies back/delete callbacks remain wired.
- Updated `apps/web/src/features/kanban/issue-detail/README.md`.
  - Documents header action accessibility behavior and focused regression tests.

## Review Loop

- ReviewBB: PASS.
  - Report: `docs/multi-work/kanban-continuous/20260519-issue-header-actions-a11y-audit-ReviewBB.md`.
  - Confirmed named icon-only controls, decorative header/delete icons, callback wiring, static Tailwind usage, and scoped documentation coverage.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/issue-detail/issue-header.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused IssueHeader test: 1 file / 2 tests passed.
- Web typecheck: passed.
- React Doctor: 100/100.
- Full web test: 47 files / 151 tests passed.

## Notes

- This batch intentionally does not change breadcrumb layout, menu composition, issue deletion confirmation semantics, or parent `IssueDetail` mutation behavior.
