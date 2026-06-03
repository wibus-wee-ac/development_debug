# Properties Label Add A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/kanban/issue-detail`.

The target was the Labels property add trigger:

- expose a stable accessible name for the icon-only add-label control;
- keep the visual plus icon decorative;
- preserve label update payload behavior;
- document the issue-detail regression coverage.

## Changes

- Updated `apps/web/src/features/kanban/issue-detail/properties-sidebar.tsx`.
  - Added the required file header.
  - Added `aria-label="Add label"` to the Labels popover trigger.
  - Marked the plus icon as `aria-hidden="true"`.
- Added `apps/web/src/features/kanban/issue-detail/properties-sidebar.test.tsx`.
  - Covers the add-label control by role/name.
  - Verifies the plus icon is decorative.
  - Verifies adding a new label produces the expected `onUpdate` payload.
- Updated `apps/web/src/features/kanban/issue-detail/README.md`.
  - Documents the label add accessibility behavior and focused regression test.
- Updated `apps/web/src/features/kanban/README.md`.
  - Documents issue-detail accessibility regression coverage for prompt and property controls.

## Review Loop

- ReviewAV passed the scoped accessibility diff and confirmed:
  - the Labels add trigger exposes a stable accessible name;
  - the plus icon is decorative;
  - the scoped change does not alter label removal, duplicate filtering, trimming, popover state, or update payload shape;
  - the focused test covers role/name lookup, icon state, and label update payload;
  - Tailwind classes remain static;
  - source/test headers and README coverage are present.
- React Doctor then reported a `react-doctor/js-combine-iterations` regression for `PropertiesSidebar`.
- Fixed by deriving `delegateCandidates` once and reusing it for delegated lookup, empty-state checks, and menu rendering.
- ReviewAW passed and confirmed:
  - the add-label accessibility behavior remains correct;
  - `delegateCandidates` preserves the previous candidate set, empty-state condition, delegated-agent lookup semantics, keys, and mutation payload;
  - tests remain focused and relevant;
  - static Tailwind, headers, and README coverage remain valid.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/issue-detail/properties-sidebar.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused PropertiesSidebar test: 1 file / 2 tests passed.
- Web typecheck: passed.
- Initial React Doctor diff scan reported 99/100 due to `react-doctor/js-combine-iterations` in `PropertiesSidebar`.
- After extracting `delegateCandidates`, React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 43 files / 143 tests passed.

## Notes

- This batch intentionally does not change status, priority, milestone, relation, delegation, or label removal behavior.
