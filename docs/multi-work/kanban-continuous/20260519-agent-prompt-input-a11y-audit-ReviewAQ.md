# ReviewAQ Audit: Agent Prompt Input A11y

Result: FAIL

## Findings

1. `apps/web/src/features/kanban/issue-detail/agent-prompt-input.test.tsx:83`
   The submit-path test waits only for `fetch` to be called, then immediately asserts `invalidateQueries` at lines 93-95. In the component, `fetch` is invoked before `await sendPrompt(...)` resolves, while `invalidateQueries` runs after that await. This makes the test depend on promise/microtask timing and can fail even when the component behavior is correct. Move the invalidation assertion into `waitFor`, or wait for a post-submit UI state that can only happen after the async handler finishes.

## Checked

- Send button has a stable accessible name via `aria-label="Send prompt"`.
- `SendIcon` is decorative with `aria-hidden="true"`.
- Disabled behavior for empty text and busy sessions is covered.
- Request URL/body and agent activity invalidation intent are covered, subject to the async assertion issue above.
- Tailwind classes are static; no dynamic class construction was introduced.
- Added source/test/README headers are present, and README inventory coverage was added.
- Existing dirty updates in `apps/web/src/features/kanban/README.md` were reviewed only in scope and not reverted.

## Verification

Not run during this review. The batch records the focused test and typecheck as passed, with React Doctor and full web test pending.
