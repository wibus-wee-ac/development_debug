# ReviewAR Rereview: Agent Prompt Input A11y

Result: PASS

## Scope

Re-reviewed only the Agent Prompt Input A11y node after ReviewAQ failed, covering:

- `apps/web/src/features/kanban/issue-detail/agent-prompt-input.tsx`
- `apps/web/src/features/kanban/issue-detail/agent-prompt-input.test.tsx`
- `apps/web/src/features/kanban/issue-detail/README.md`
- `apps/web/src/features/kanban/README.md`

## Findings

No blocking findings.

## ReviewAQ Follow-up

The async assertion finding is fixed. The test now waits separately for the post-`sendPrompt` invalidation path:

- `apps/web/src/features/kanban/issue-detail/agent-prompt-input.test.tsx:83` waits for the `fetch` call.
- `apps/web/src/features/kanban/issue-detail/agent-prompt-input.test.tsx:93` waits for `invalidateQueries`, which runs only after the awaited prompt request resolves.

This removes the microtask timing dependency called out by ReviewAQ.

## Checked

- Accessibility: the icon-only send button has `aria-label="Send prompt"`, and the `SendIcon` is decorative via `aria-hidden="true"`.
- Behavior risk: empty text, busy sessions, trimmed request body, and agent activity invalidation remain covered without changing session selection or layout behavior.
- Test quality: the focused test queries the control by role/name and now waits for both async request and invalidation effects.
- Static Tailwind: classes in the scoped component diff are statically declared; no dynamic Tailwind construction was introduced.
- Headers/README: added source/test headers are present, `issue-detail/README.md` inventories the new test/component coverage, and the kanban README mentions the issue-detail accessibility regression coverage.

## Verification

Not run during this re-review. This review is based on the scoped diff and current file contents.
