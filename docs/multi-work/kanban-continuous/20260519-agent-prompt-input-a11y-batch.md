<!--
Input: AgentPromptInput accessibility work, focused test, review report, and validation commands
Output: Batch record for the kanban issue agent prompt send action accessibility node
Position: Multi-work audit trail for continuous kanban UX improvements
-->

# Agent Prompt Input A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/kanban/issue-detail`.

The target was the issue agent prompt send control:

- expose a stable accessible name for the icon-only send button;
- keep the visual send icon decorative;
- preserve empty/busy disabled behavior;
- preserve successful prompt request and agent activity invalidation behavior;
- document the issue-detail subdirectory and focused regression test.

## Changes

- Updated `apps/web/src/features/kanban/issue-detail/agent-prompt-input.tsx`.
  - Added the required file header.
  - Added `aria-label="Send prompt"` to the send button.
  - Marked the visual send icon as `aria-hidden="true"`.
- Added `apps/web/src/features/kanban/issue-detail/agent-prompt-input.test.tsx`.
  - Covers the send control by role/name.
  - Verifies empty and busy disabled states.
  - Verifies the successful prompt request URL/body and agent activity query invalidation.
- Added `apps/web/src/features/kanban/issue-detail/README.md`.
  - Documents issue detail subview ownership and file inventory.
- Updated `apps/web/src/features/kanban/README.md`.
  - Documents issue-detail README ownership and agent prompt input accessibility regression coverage.

## Review Loop

- ReviewAQ failed on one test-quality issue:
  - the first submit-path test waited for `fetch`, then immediately asserted `invalidateQueries`, which depended on promise/microtask timing.
- Fixed by moving the `invalidateQueries` assertion into its own `waitFor`.
- ReviewAR passed and confirmed:
  - ReviewAQ's async assertion issue is fixed;
  - the icon-only send button has a stable accessible name;
  - the send icon is decorative;
  - empty text, busy sessions, trimmed request body, and agent activity invalidation remain covered;
  - the focused test queries by role/name and waits for both async request and invalidation effects;
  - Tailwind classes are static;
  - source/test headers and README coverage are present.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/issue-detail/agent-prompt-input.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused AgentPromptInput test: 1 file / 2 tests passed.
- Web typecheck: passed.
- React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 41 files / 137 tests passed.

## Notes

- This batch intentionally does not change agent session selection, activity rendering, stop/rerun behavior, error recovery semantics, or the issue detail layout.
