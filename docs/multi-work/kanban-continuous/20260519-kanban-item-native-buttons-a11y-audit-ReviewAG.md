# Kanban Item Native Buttons Accessibility Review

Status: FAIL

## Scope

Reviewed only the current diff for:

- `apps/web/src/features/kanban/kanban-card.tsx`
- `apps/web/src/features/kanban/kanban-list-row.tsx`
- `apps/web/src/features/kanban/kanban-item-actions.test.tsx`
- `apps/web/src/features/kanban/README.md`

Focus areas: native button semantics, dnd-kit attributes/listeners compatibility, Radix context menu trigger compatibility, accessible names, regression test quality, static Tailwind constraints, and README coverage.

## Findings

### 1. Invalid native button content in board cards

Severity: High

`apps/web/src/features/kanban/kanban-card.tsx:58` changes the card root to a native `<button>`, but the button still contains non-phrasing descendants:

- `apps/web/src/features/kanban/kanban-card.tsx:81` uses a `<div>` inside the button.
- `apps/web/src/features/kanban/kanban-card.tsx:95` uses another `<div>` inside the button.
- `apps/web/src/features/kanban/kanban-card.tsx:101` uses a `<p>` inside the button.
- `apps/web/src/features/kanban/kanban-card.tsx:106` uses a `<div>` inside the button.
- `AssigneeAvatar`, rendered from `apps/web/src/features/kanban/kanban-card.tsx:90`, returns a `<div>`, so it is also inserted inside the native button.

Native `button` content is constrained to phrasing content and must not contain arbitrary flow containers. This makes the new semantic patch structurally invalid and risks inconsistent browser, accessibility tree, and future SSR/parser behavior. The list row avoids this problem because its button body is built from `span` descendants.

Recommendation: keep the native button, but convert the card's internal layout wrappers to phrasing-safe elements such as `span` with `inline-flex` or `flex` classes where needed. `AssigneeAvatar` also needs a phrasing-safe rendering path when used inside a button, or the card should avoid placing that component inside the button.

### 2. Tests do not catch the invalid native button structure

Severity: Medium

`apps/web/src/features/kanban/kanban-item-actions.test.tsx:109` verifies that the board card is discoverable as a named native button and that selected dnd-kit attributes are filtered or retained. That is useful, but it does not validate the native button content model. Because the mocked context menu just returns children and the assertion only checks `tagName`, `role`, `tabindex`, and click behavior, the test passes while the card still contains invalid descendants.

Recommendation: add a structural regression assertion for the card button that rejects non-phrasing layout wrappers, or refactor first and keep the test focused on the intended DOM shape. A focused assertion can check that the card button has no `div` or `p` descendants after rendering.

## Passing Checks

- `kanban-card.tsx` correctly filters dnd-kit `role` and `tabIndex` while preserving other draggable attributes such as `aria-describedby`.
- The card keeps dnd-kit listeners on the drag node, and the existing board uses `PointerSensor`, so the pointer drag compatibility path is preserved.
- `IssueContextMenu` uses `ContextMenuTrigger asChild`, which is compatible with a single native button child.
- Both item surfaces provide explicit accessible names with `aria-label`.
- The list row native button structure is semantically cleaner than the previous `div role="button"` implementation.
- Tailwind classes added in this diff are static strings or existing conditional static strings; no dynamic Tailwind class construction was introduced.
- The README file inventory was updated for the new test and changed card/list row ownership notes.

## Verification Performed

- Reviewed the scoped git diff.
- Reviewed `IssueContextMenu` and the context menu trigger wrapper for `asChild` compatibility.
- Reviewed the board's dnd-kit sensor setup for listener compatibility.
- Ran `git diff --check` for the scoped files; it reported no whitespace errors.

No source files were modified during this review.
