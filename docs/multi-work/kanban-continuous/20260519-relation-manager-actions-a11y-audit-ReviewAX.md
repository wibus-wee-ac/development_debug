# ReviewAX Audit: Relation Manager Actions A11y

## Verdict

FAIL

## Findings

1. `apps/web/src/features/kanban/issue-detail/relation-manager.tsx:63` keeps remove relation buttons behind `hidden ... group-hover:flex`. Because `hidden` maps to `display: none`, these icon-only buttons are absent from the accessibility tree and cannot receive keyboard focus until a pointer hover makes the group active. The new `aria-label` at line 64 gives the button a useful name, but it does not make the control reachable for keyboard, touch, or assistive technology users. Prefer keeping the button in layout/accessibility tree and only changing opacity/visibility on `group-hover` and `group-focus-within`, or provide an always-reachable menu/action surface.

2. `apps/web/src/features/kanban/issue-detail/relation-manager.test.tsx:68` asserts the remove buttons with `getByRole`, but the test does not catch the real `hidden` Tailwind behavior because the class is not applied as CSS in jsdom. This can pass while the production UI remains keyboard-inaccessible. Add a regression assertion around the class contract or, preferably, update the implementation first and assert that remove actions are reachable by role/name without pointer hover and remain visually discoverable on `group-focus-within`.

## Passing Checks

- `apps/web/src/features/kanban/issue-detail/relation-manager.tsx:34` adds a stable accessible name for the add-relation trigger.
- `apps/web/src/features/kanban/issue-detail/relation-manager.tsx:36`, `:55`, and `:66` correctly mark decorative icons with `aria-hidden="true"`.
- `apps/web/src/features/kanban/issue-detail/relation-manager.tsx:62` preserves the delete mutation payload shape.
- Tailwind classes in the scoped diff are statically defined.
- New files include file headers, and `apps/web/src/features/kanban/issue-detail/README.md` documents the new relation manager test coverage without reverting earlier README updates.

## Verification

Reviewed the batch file and scoped worktree diff for:

- `apps/web/src/features/kanban/issue-detail/relation-manager.tsx`
- `apps/web/src/features/kanban/issue-detail/relation-manager.test.tsx`
- `apps/web/src/features/kanban/issue-detail/README.md`

No test commands were run for this review.
