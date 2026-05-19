<!--
Input: RelationManager action accessibility work, focused test, review report, and validation commands
Output: Batch record for the kanban issue detail relation action accessibility node
Position: Multi-work audit trail for continuous kanban UX improvements
-->

# Relation Manager Actions A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/kanban/issue-detail`.

The target was issue relation action controls:

- expose a stable accessible name for the icon-only add-relation trigger;
- expose relation-specific accessible names for icon-only remove buttons;
- keep visual relation/add/remove icons decorative;
- preserve delete relation mutation payload behavior;
- document the issue-detail regression coverage.

## Changes

- Updated `apps/web/src/features/kanban/issue-detail/relation-manager.tsx`.
  - Added the required file header.
  - Added `aria-label="Add relation"` to the add relation popover trigger.
  - Added relation-specific remove button names such as `Remove Blocks relation <target>`.
  - Marked `LinkIcon`, `PlusIcon`, and `XIcon` instances as decorative.
- Added `apps/web/src/features/kanban/issue-detail/relation-manager.test.tsx`.
  - Covers add relation by role/name.
  - Covers source and reverse relation remove controls by role/name.
  - Verifies decorative icon state and delete mutation payload wiring.
- Updated `apps/web/src/features/kanban/issue-detail/README.md`.
  - Documents relation action accessibility behavior and focused regression tests.

## Review Loop

- ReviewAX failed on one accessibility issue and one test-quality issue:
  - remove relation buttons still used Tailwind `hidden`, which maps to `display: none` and makes them unreachable for keyboard, touch, and assistive technology users until pointer hover;
  - the focused test queried those buttons by role/name, but jsdom does not apply Tailwind `hidden`, so the test could pass while production UI remained inaccessible.
- Fixed by keeping remove relation buttons mounted as `flex` controls and revealing them with opacity on hover, `focus-visible`, and `group-focus-within`.
- Updated the focused test with class-contract assertions that the remove action no longer includes `hidden` and includes keyboard-visible reveal classes.
- ReviewAY passed and confirmed:
  - remove relation buttons no longer use `hidden` / `display: none` semantics;
  - add/remove accessible names remain correct;
  - relation icons remain decorative;
  - source and reverse remove controls are covered by role/name;
  - the ReviewAX failure mode is covered by tests;
  - static Tailwind, file headers, and README coverage are valid.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/issue-detail/relation-manager.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused RelationManager test: 1 file / 2 tests passed.
- Web typecheck: passed.
- React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 44 files / 145 tests passed.

## Notes

- This batch intentionally does not change relation creation behavior, relation type derivation, relation target display, or relation query invalidation semantics.
