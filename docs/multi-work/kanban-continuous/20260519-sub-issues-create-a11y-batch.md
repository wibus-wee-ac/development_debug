# Sub-Issues Create A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/kanban/issue-detail`.

The target was the sub-issue create controls:

- keep the Add sub-issue button name clean while marking the visual plus icon decorative;
- keep the Create button name clean by hiding the shortcut hint from assistive technology;
- preserve trimmed title and default metadata payload behavior;
- document the issue-detail regression coverage.

## Changes

- Updated `apps/web/src/features/kanban/issue-detail/sub-issues-list.tsx`.
  - Added the required file header.
  - Marked the Add sub-issue plus icon as `aria-hidden="true"`.
  - Marked the Create button shortcut hint as `aria-hidden="true"` so the accessible name remains `Create`.
- Added `apps/web/src/features/kanban/issue-detail/sub-issues-list.test.tsx`.
  - Covers Add sub-issue by role/name.
  - Verifies the plus icon is decorative.
  - Verifies child issue create payload uses the trimmed title and default metadata.
- Updated `apps/web/src/features/kanban/issue-detail/README.md`.
  - Documents sub-issue create action accessibility behavior and focused regression tests.

## Review Loop

- ReviewAZ: PASS.
  - Report: `docs/multi-work/kanban-continuous/20260519-sub-issues-create-a11y-audit-ReviewAZ.md`.
  - Confirmed the scoped diff preserves clean accessible names, payload behavior, static Tailwind usage, and required documentation coverage.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/issue-detail/sub-issues-list.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused SubIssuesList test: 1 file / 2 tests passed.
- Web typecheck: passed.
- React Doctor: 100/100.
- Full web test: 45 files / 147 tests passed.

## Notes

- This batch intentionally does not change status selection, priority selection, sub-issue query behavior, existing sub-issue rendering, or create mutation invalidation semantics.
