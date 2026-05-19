# Skill List Row Actions A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/skills`.

The target was the skill inventory row actions:

- remove the nested interactive-control structure;
- expose a clear accessible name for opening skill details;
- expose a separate accessible delete action for list rows;
- preserve the existing delete mutation behavior.

## Changes

- Updated `apps/web/src/features/skills/skill-manager.tsx`.
  - Changed each skill row from one button containing a clickable SVG into a non-interactive row container.
  - Added a primary `Open <skill> details` row button.
  - Added a sibling `Delete <skill> from list` icon button.
  - Removed the need for `stopPropagation()` on list delete.
  - Marked row icons as decorative.
- Updated `apps/web/src/features/skills/skill-manager.test.tsx`.
  - Uses the explicit open-details accessible name for detail flows.
  - Covers the list delete action by role/name.
  - Verifies list delete does not open the detail dialog.
- Updated `apps/web/src/features/skills/README.md`.
  - Documented list and detail action accessible names and regression coverage.

## Review Loop

- ReviewAF passed and confirmed:
  - the row no longer nests a delete action inside the open-details button;
  - open-details and list-delete controls have distinct accessible names;
  - the list delete button remains keyboard focusable and visible on focus;
  - event propagation is structurally safer;
  - static Tailwind constraints are respected;
  - README coverage is current for the scoped change.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/skills/skill-manager.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused SkillManager test: 1 file / 4 tests passed.
- Web typecheck: passed.
- React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 33 files / 122 tests passed.

## Notes

- This batch intentionally keeps the existing delete confirmation behavior unchanged; it only fixes the list row interaction structure and semantics.
