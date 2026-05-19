# ReviewG: Search + Git Continuous Audit

## Verdict

PASS

The scoped git/search changes satisfy the batch goal. File search results are now selectable actions, and the new pure helper keeps the side effects covered by focused unit tests. I did not find a blocking correctness, AGENTS, React render, or performance issue in the requested files.

## Scope

- `apps/web/src/features/git/graph-layout.test.ts`
- `apps/web/src/features/git/README.md`
- `apps/web/src/features/search/global-search-actions.ts`
- `apps/web/src/features/search/global-search-actions.test.ts`
- `apps/web/src/features/search/global-search-dialog.tsx`
- `apps/web/src/features/search/README.md`

## Findings

No blocking findings.

## Non-Blocking Notes

1. File-result availability is still tied to the active chat tab workspace.
   - Evidence: `useFileSearch` derives `workspaceId` from `t?.type === 'chat' ? t.params : null` in `apps/web/src/features/search/global-search-dialog.tsx`.
   - Impact: When Global Search is opened from `home`, `workspace-detail`, or another non-chat tab, file results will not be searched or shown. This does not break the current actionability goal for rendered file results, but it is a product-scope limitation for a truly global file search.
   - Suggested follow-up: decide whether Global Search should search the current workspace outside chat tabs, the selected workspace in sidebar context, or all workspaces.

2. Dialog-level wiring is not covered by a UI test.
   - Evidence: `global-search-actions.test.ts` covers `selectFileSearchResult`, including copy failure fallback, but no test renders `GlobalSearchDialog` and selects a file item.
   - Impact: The side-effect helper is covered, but regressions in `handleSelectFile`, clipboard injection, toast wiring, or the `CommandItem` `onSelect` binding would not be caught by the new tests.
   - Suggested follow-up: add a focused component test once the command dialog mocks are stable enough to keep maintenance cost low.

## AGENTS Compliance

- Static Tailwind: PASS. I did not see dynamic Tailwind class construction in the scoped diff.
- Directory README updates: PASS. Both affected feature directories update their README inventory.
- New file headers: PASS. `global-search-actions.ts`, `global-search-actions.test.ts`, and `graph-layout.test.ts` include file header comments.
- Code English: PASS for new identifiers and comments. Existing UI copy remains Chinese, which matches the app surface and is not a new code/comment naming issue.
- Source ownership: PASS. Search behavior stays under `features/search`; git test coverage stays under `features/git`.

## React / Render / Performance Review

- `handleSelectFile` is memoized with stable dependencies and only performs work on selection.
- The added file pending state prevents premature empty-state rendering while workspace files are fetching.
- File filtering remains bounded to 10 rendered file results, so the UI render path stays constrained.
- No nested cards, dynamic class names, or obvious layout overlap risks were introduced in the scoped diff.

## Test Coverage Review

- Git layout tests cover linear history, merge lane split/convergence, and empty input.
- Search action tests cover the success path and clipboard failure path.
- Missing but non-blocking coverage: no direct test for the optional no-clipboard path, no dialog-level file item selection test, and no test documenting the active-chat-only file-search scope.

## Verification Run

```sh
pnpm vitest run --config apps/web/vite.config.ts --environment jsdom apps/web/src/features/search/global-search-actions.test.ts apps/web/src/features/git/graph-layout.test.ts
```

Result: 2 files passed, 5 tests passed.
