# Skills List Row Action Accessibility Patch Review

Status: PASS

## Scope

Reviewed only the current diff for:

- `apps/web/src/features/skills/skill-manager.tsx`
- `apps/web/src/features/skills/skill-manager.test.tsx`
- `apps/web/src/features/skills/README.md`

This review focuses on the list row structure that separates the open-details row button from the list delete action button. The earlier detail action accessible-name patch was previously reviewed in ReviewAE.

## Findings

No blocking or non-blocking regressions found in this node's diff.

## Review Notes

- The list row no longer nests an action control inside another interactive control. The row container is now a non-interactive `div`, with the open-details button and delete button rendered as sibling controls.
- The open-details row button exposes a specific accessible name with `aria-label="Open {name} details"`, while the list delete button exposes `aria-label="Delete {name} from list"`. These names are distinct from the detail dialog actions reviewed in ReviewAE.
- Decorative Lucide icons in the changed controls are hidden with `aria-hidden="true"`, so they do not pollute accessible names.
- The list delete button remains keyboard focusable as a real button. Although it is visually hidden with `opacity-0` until hover or focus, `focus-visible:opacity-100` makes the focused control visible for keyboard navigation.
- Event propagation is structurally safer after the change: clicking the list delete button no longer depends on `stopPropagation()` to avoid opening the details dialog, because the delete button is not a descendant of the open-details button.
- Tailwind classes added in the diff are statically declared. No dynamic Tailwind class construction was introduced.
- The new regression test covers the critical list-row behavior by clicking the named list delete action and asserting that the detail dialog does not open.
- The README update covers the new list action accessibility behavior and the added `skill-manager.test.tsx` regression coverage.
- The delete action uses the existing `Button` `icon-xs` size, which maps to the current design system's 24px icon button target. This is consistent with nearby controls and improves on the previous direct icon click target.

## Verification

- `pnpm --filter @cradle/web test -- skill-manager.test.tsx`
  - Result: passed. The command executed the web Vitest suite with 33 test files and 122 tests passing.
