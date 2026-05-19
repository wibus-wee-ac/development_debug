# Kanban Item Native Buttons Accessibility Final Re-review

Status: PASS

## Scope

Reviewed only the current diff for this task node:

- `apps/web/src/features/kanban/kanban-card.tsx`
- `apps/web/src/features/kanban/kanban-list-row.tsx`
- `apps/web/src/features/kanban/kanban-item-actions.test.tsx`
- `apps/web/src/features/kanban/shared/assignee-avatar.tsx`
- `apps/web/src/features/kanban/README.md`
- `apps/web/src/features/kanban/shared/README.md`

Also re-read the prior reports:

- `docs/multi-work/kanban-continuous/20260519-kanban-item-native-buttons-a11y-audit-ReviewAG.md`
- `docs/multi-work/kanban-continuous/20260519-kanban-item-native-buttons-a11y-rereview-ReviewAH.md`

Focus areas: ReviewAG blocker status, ReviewAH AssigneeAvatar coverage gap, dnd-kit `role`/`tabIndex` filtering, native button content model, Radix context menu trigger compatibility, accessible names, static Tailwind classes, and README coverage.

## Findings

No blocking or non-blocking findings.

## ReviewAG Blocker Re-check

Result: PASS

`apps/web/src/features/kanban/kanban-card.tsx` now renders the board item as a native `<button type="button">` and its internal layout wrappers are phrasing-safe `span` descendants. The previous invalid `div` and `p` descendants inside the button are gone.

`apps/web/src/features/kanban/shared/assignee-avatar.tsx` now returns a `span` root, and its fallback `UserIcon` is `aria-hidden="true"`. This keeps assigned and unassigned card states compatible with the native button content model.

The other card descendants checked in this review are also safe for the button content model:

- `LabelChip` renders a `span`.
- `PriorityIcon` renders an `svg`.
- `StatusIcon` renders an `svg`.

## ReviewAH Coverage Gap Re-check

Result: PASS

`apps/web/src/features/kanban/kanban-item-actions.test.tsx` no longer mocks `AssigneeAvatar`. The shared fixture uses `assigneeId: 'wibus'`, so the board card test exercises the real `AssigneeAvatar` path inside the native card button.

The test also keeps the structural regression assertion:

- The board card is found as a named native button.
- The board card has no explicit `role` or `tabindex`.
- dnd-kit `aria-describedby` is preserved.
- The card button has no `div` or `p` descendants.
- Click activation still calls the open handler.

This addresses the non-blocking ReviewAH gap.

## Additional Checks

### DnD attributes

Result: PASS

`kanban-card.tsx` strips dnd-kit `role` and `tabIndex` before spreading draggable attributes onto the native button, while preserving other attributes such as `aria-describedby`. This avoids redundant ARIA role/tab index overrides and keeps the dnd-kit descriptive wiring.

### Context menu trigger

Result: PASS

`IssueContextMenu` still uses `ContextMenuTrigger asChild`, and both card and list row pass a single native button child. This remains compatible with the Radix trigger composition model.

### Accessible names

Result: PASS

Both item surfaces use explicit accessible names in the form `Open issue ${issue.title}`. The button names do not depend on incidental visible metadata or icons.

### Static Tailwind classes

Result: PASS

The changed class names are static string literals or existing static conditional branches passed through `cn()`. No dynamic Tailwind class construction was introduced.

### README coverage

Result: PASS

`apps/web/src/features/kanban/README.md` documents the native button semantics for card/list rows and the new regression test. `apps/web/src/features/kanban/shared/README.md` documents the phrasing-safe `span` root for `assignee-avatar.tsx`.

## Verification

- Reviewed the scoped current diff and untracked scoped files.
- Reviewed the prior ReviewAG and ReviewAH reports.
- Reviewed `IssueContextMenu` for `ContextMenuTrigger asChild` compatibility.
- Reviewed the real shared components rendered inside the card/list row button path.
- Ran `pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/kanban-item-actions.test.tsx`; the test file passed with 2 tests.

No source files were modified during this final re-review.
