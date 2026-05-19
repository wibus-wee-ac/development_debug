# Kanban Item Native Buttons A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/kanban`.

The target was issue item activation in board and list views:

- replace simulated `div role="button"` item controls with native buttons;
- keep board card drag wiring and context menu trigger compatibility;
- expose explicit accessible names for opening issue details;
- avoid invalid native button content.

## Changes

- Updated `apps/web/src/features/kanban/kanban-card.tsx`.
  - Replaced the simulated card button with a native `button`.
  - Added `aria-label="Open issue <title>"`.
  - Filtered dnd-kit `role` and `tabIndex` before spreading draggable attributes onto the native button.
  - Preserved dnd-kit descriptive attributes such as `aria-describedby`.
  - Converted internal card layout wrappers from `div` / `p` to phrasing-safe `span` elements.
- Updated `apps/web/src/features/kanban/kanban-list-row.tsx`.
  - Replaced `div role="button"` / `tabIndex={0}` with a native `button`.
  - Added `aria-label="Open issue <title>"`.
  - Removed manual Enter key handling in favor of native button semantics.
- Updated `apps/web/src/features/kanban/shared/assignee-avatar.tsx`.
  - Changed the root element from `div` to `span`, making the avatar safe inside native item buttons.
  - Marked the fallback icon as decorative.
- Added `apps/web/src/features/kanban/kanban-item-actions.test.tsx`.
  - Covers card/list row discovery by role and accessible name.
  - Covers click activation.
  - Verifies the card keeps dnd-kit `aria-describedby` while stripping `role` / `tabindex`.
  - Verifies the card button has no `div` or `p` descendants.
  - Uses the real `AssigneeAvatar` path for an assigned issue.
- Updated `apps/web/src/features/kanban/README.md`.
  - Documented native item button semantics and the new regression test.
- Added `apps/web/src/features/kanban/shared/README.md`.
  - Documented the phrasing-safe avatar root.

## Review Loop

- ReviewAG failed the first pass.
  - Root cause: `kanban-card.tsx` changed the card root to a native `button`, but left `div` / `p` descendants inside the button and indirectly rendered `AssigneeAvatar` as a `div`.
- The fix converted card internals to phrasing-safe elements and changed `AssigneeAvatar` to a `span` root.
- ReviewAH passed after the structural fix and noted a non-blocking test gap: the test still mocked `AssigneeAvatar`.
- The test was then tightened to use the real `AssigneeAvatar` with an assigned issue fixture.
- ReviewAI passed and confirmed:
  - ReviewAG's content-model blocker remains fixed;
  - ReviewAH's `AssigneeAvatar` coverage gap is addressed;
  - dnd-kit `role` / `tabIndex` filtering is correct;
  - context menu `asChild` trigger compatibility is preserved;
  - accessible names and static Tailwind constraints are correct;
  - README coverage is current.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/kanban-item-actions.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused Kanban item test: 1 file / 2 tests passed.
- Web typecheck: passed.
- React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 34 files / 124 tests passed.

## Notes

- This batch intentionally does not change drag/drop sensors, issue context menu actions, issue mutation behavior, or the visual card/list row layout beyond preserving semantics with phrasing-safe wrappers.
