<!--
Input: New Chat composer action accessibility batch, scoped source diff, focused regression test, and validation command output
Output: ReviewAM audit report for New Chat composer action accessibility changes
Position: Multi-work review artifact for the New Chat continuous improvement stream
-->

# ReviewAM Audit: New Chat Composer Actions A11y

## Verdict

PASS

## Scope Reviewed

- `docs/multi-work/new-chat-continuous/20260519-new-chat-composer-actions-a11y-batch.md`
- `apps/web/src/features/new-chat/new-chat-page.tsx`
- `apps/web/src/features/new-chat/new-chat-page.test.tsx`
- `apps/web/src/features/new-chat/README.md`

## Findings

No blocking findings.

## Review Notes

- The attach and send icon-only controls now expose stable English accessible names.
- Decorative Lucide icons in the reviewed controls are hidden from the accessibility tree.
- Send enablement remains tied to `canSend`, so an empty composer stays disabled.
- The focused test covers role/name lookup, decorative icon state, empty disabled behavior, and the send path through session creation, response start, query invalidation, and chat tab navigation.
- Tailwind classes added or touched in this change are statically defined.
- The feature README documents the new focused test and named composer controls.

## Verification

```sh
git diff -- apps/web/src/features/new-chat/new-chat-page.tsx apps/web/src/features/new-chat/new-chat-page.test.tsx apps/web/src/features/new-chat/README.md
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/new-chat/new-chat-page.test.tsx
npx -y react-doctor@latest apps/web --verbose --diff
git diff --check -- apps/web/src/features/new-chat/new-chat-page.tsx apps/web/src/features/new-chat/new-chat-page.test.tsx apps/web/src/features/new-chat/README.md
```

Observed:

- Focused Vitest file passed: 1 file, 2 tests.
- React Doctor diff scan passed with score 100/100.
- Scoped whitespace check passed.
