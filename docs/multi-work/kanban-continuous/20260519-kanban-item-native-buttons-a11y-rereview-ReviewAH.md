# Kanban Item Native Buttons Accessibility Re-review

Status: PASS

## Scope

Reviewed only the current diff for this task node:

- `apps/web/src/features/kanban/kanban-card.tsx`
- `apps/web/src/features/kanban/kanban-list-row.tsx`
- `apps/web/src/features/kanban/kanban-item-actions.test.tsx`
- `apps/web/src/features/kanban/shared/assignee-avatar.tsx`
- `apps/web/src/features/kanban/README.md`
- `apps/web/src/features/kanban/shared/README.md`

Special focus: whether the prior ReviewAG failure was fixed for native button content model in board cards, `AssigneeAvatar` root element, dnd-kit `role`/`tabIndex` filtering, context menu trigger compatibility, accessible names, test coverage, static Tailwind class constraints, and README coverage.

## Findings

No blocking findings.

## Prior Failure Re-check

### Native board card button content model

Result: PASS

`apps/web/src/features/kanban/kanban-card.tsx` now renders the board item as a native `<button type="button">` whose direct layout descendants are `span` elements. The previous invalid `div` and `p` descendants inside the native button were removed. The regression test also asserts `card.querySelector('div,p')` is `null`.

### AssigneeAvatar root element

Result: PASS

`apps/web/src/features/kanban/shared/assignee-avatar.tsx` now returns a `span` root, so the component is phrasing-safe when rendered inside the card or row button. The fallback `UserIcon` is marked `aria-hidden="true"`, avoiding extra noise in the button name.

### DnD role/tabIndex filtering

Result: PASS

`kanban-card.tsx` strips dnd-kit `role` and `tabIndex` before spreading draggable attributes onto the native button, while preserving other attributes such as `aria-describedby`. This prevents redundant ARIA/button role overrides and keeps dnd-kit descriptive wiring intact.

### Context menu trigger compatibility

Result: PASS

`IssueContextMenu` still uses `ContextMenuTrigger asChild`, and both the card and list row provide a single native button child. That remains compatible with the Radix trigger composition model.

### Accessible names

Result: PASS

Both the card and list row use explicit labels in the form `Open issue ${issue.title}`. The visible metadata and icons are therefore not relied on to construct a usable accessible name.

### Test coverage

Result: PASS with a non-blocking gap

`kanban-item-actions.test.tsx` covers:

- Native button discovery by accessible name.
- Absence of explicit `role` and `tabindex`.
- Preservation of dnd-kit `aria-describedby` on the board card.
- Click activation for both board card and list row.
- No `div` or `p` descendants under the rendered board card button.

Non-blocking coverage gap: the test mocks `AssigneeAvatar` and the shared fixture has `assigneeId: null`, so it does not exercise the real `AssigneeAvatar` inside the card button. The source has been fixed, but a future regression in `AssigneeAvatar` would not be caught by this test. A stronger follow-up would either avoid mocking `AssigneeAvatar` here or render an assigned issue and assert the card button still has no invalid descendants.

### Static Tailwind classes

Result: PASS

The changed Tailwind classes are static strings or static conditional branches passed through `cn()`. No dynamic Tailwind class construction was introduced.

### README coverage

Result: PASS

`apps/web/src/features/kanban/README.md` now records the native button semantics for card/list rows and the new regression test. `apps/web/src/features/kanban/shared/README.md` documents that `assignee-avatar.tsx` has a phrasing-safe `span` root.

## Verification

- Reviewed the scoped git diff.
- Reviewed `IssueContextMenu` and the shared context menu trigger wrapper.
- Reviewed the real shared components rendered inside the board card button: `AssigneeAvatar`, `LabelChip`, `PriorityIcon`, and `StatusIcon`.
- Ran `git diff --check -- apps/web/src/features/kanban/kanban-card.tsx apps/web/src/features/kanban/kanban-list-row.tsx apps/web/src/features/kanban/kanban-item-actions.test.tsx apps/web/src/features/kanban/shared/assignee-avatar.tsx apps/web/src/features/kanban/README.md apps/web/src/features/kanban/shared/README.md`; no whitespace errors were reported.
- Ran `pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/kanban-item-actions.test.tsx`; the test file passed with 2 tests.

No source files were modified during this re-review.
