# Kanban Status Manager A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/kanban`.

The target was status management inline controls:

- replace the pseudo-button rename trigger with native button semantics;
- improve delete button labeling, focus treatment, and hit target;
- keep status rename, delete, and reorder behavior unchanged;
- document the status manager ownership boundary.

## Changes

- Updated `apps/web/src/features/kanban/status-manager.tsx`.
  - Replaced the `span role="button"` status rename trigger with `button type="button"`.
  - Removed manual `tabIndex` and manual Enter/Space handling from the rename trigger.
  - Added an item-specific `aria-label` for rename.
  - Added `type="button"`, item-specific `aria-label`, `size-6` hit target, and focus-visible ring styling to the delete button.
  - Kept `useSortable` attributes and listeners scoped to the drag handle.
- Updated `apps/web/src/features/kanban/README.md`.
  - Documented accessible inline rename, delete, and reorder controls.

## Review Loop

- ReviewW passed and confirmed:
  - `status-name-*` controls now use native `button type="button"` semantics;
  - rename editing behavior remains intact;
  - delete controls have clear labels, compact hit targets, and focus-visible styling;
  - drag handle wiring is still isolated from rename/delete controls;
  - Tailwind classes remain static strings;
  - README coverage is current for the touched feature directory.

## Verification

```sh
rg -n 'role="button"|tabIndex=\{0\}' apps/web/src/features/kanban/status-manager.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Scoped role/tabIndex scan: no matches.
- Web typecheck: passed.
- React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 30 files / 110 tests passed.

## Notes

- This batch intentionally does not change status creation, mutation hooks, drag/drop ordering, or board/list issue behavior.
