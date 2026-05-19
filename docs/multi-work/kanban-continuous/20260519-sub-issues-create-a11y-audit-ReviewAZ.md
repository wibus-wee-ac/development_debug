<!--
Input: Scoped SubIssuesList accessibility diff and focused regression tests
Output: ReviewAZ audit report for the Sub-Issues Create A11y node
Position: Multi-work review artifact for kanban continuous improvements
-->

# ReviewAZ Audit: Sub-Issues Create A11y

## Verdict

PASS

## Findings

No blocking findings in the scoped diff.

## Checks

- Accessibility: The Add sub-issue icon is decorative while the button keeps the accessible name `Add sub-issue`; the Create shortcut hint is hidden from assistive technology while the button keeps the accessible name `Create`.
- Behavior regression risk: The create payload still trims the title and preserves default `statusId: undefined` and `priority: 'none'` behavior.
- Test quality: Focused tests cover role/name lookup, decorative plus icon semantics, and create payload wiring.
- Static Tailwind: No dynamic Tailwind class construction introduced.
- Header/README coverage: `sub-issues-list.tsx`, `sub-issues-list.test.tsx`, and `issue-detail/README.md` include the expected documentation coverage for this node.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/issue-detail/sub-issues-list.test.tsx
```

Result: 1 file / 2 tests passed.
