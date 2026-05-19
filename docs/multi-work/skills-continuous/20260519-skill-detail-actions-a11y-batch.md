# Skill Detail Actions A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/skills`.

The target was the skill detail action row:

- expose accessible names for icon-only edit/export/delete controls;
- hide decorative action icons from assistive technology;
- preserve existing E2E `data-testid` anchors;
- preserve the existing export and delete action wiring.

## Changes

- Updated `apps/web/src/features/skills/skill-manager.tsx`.
  - Added `Edit <skill>`, `Export <skill>`, and `Delete <skill>` accessible names to detail action buttons.
  - Marked detail action icons and the detail scope icon as decorative.
  - Kept existing `skill-edit-btn`, `skill-export-btn`, and `skill-delete-btn` anchors.
- Added `apps/web/src/features/skills/skill-manager.test.tsx`.
  - Covers role/name lookup for detail actions.
  - Covers export wiring through the named detail action.
  - Covers delete wiring through the named detail action.
- Updated `apps/web/src/features/skills/README.md`.
  - Documented detail action accessible names and the new regression test.

## Review Loop

- ReviewAE passed and confirmed:
  - icon-only detail actions now have explicit accessible names;
  - decorative Lucide icons are hidden from the accessibility tree;
  - static Tailwind constraints are respected;
  - tests are scoped and meaningful for this node;
  - README coverage is current for the scoped change.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/skills/skill-manager.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused SkillManager test: 1 file / 3 tests passed.
- Web typecheck: passed.
- React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 33 files / 121 tests passed.

## Notes

- This batch intentionally does not restructure the skill list row delete affordance. That row currently uses an inline SVG click target inside the list button and should be handled as a separate interaction-structure node.
