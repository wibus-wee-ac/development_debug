# New Chat Composer Actions A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/new-chat`.

The target was the new chat composer action buttons:

- expose stable English accessible names for icon-heavy composer controls;
- keep visual-only Lucide icons decorative;
- preserve the existing send enablement and session creation path;
- document the new focused regression test.

## Changes

- Updated `apps/web/src/features/new-chat/new-chat-page.tsx`.
  - Changed the attach button accessible name to `Attach file`.
  - Added `aria-label="Send message"` to the send button.
  - Marked the attach, send, and sending icons as `aria-hidden="true"`.
- Added `apps/web/src/features/new-chat/new-chat-page.test.tsx`.
  - Covers attach and send controls by role/name.
  - Verifies the send button stays disabled while the composer is empty.
  - Verifies the named send control still creates a session, starts the initial response, invalidates sessions, and opens the chat tab.
- Updated `apps/web/src/features/new-chat/README.md`.
  - Documents the named composer controls and focused regression test.

## Review Loop

- ReviewAM passed and confirmed:
  - attach and send icon-only controls now expose stable English accessible names;
  - the reviewed Lucide icons are decorative;
  - send enablement remains tied to `canSend`;
  - the focused regression test covers role/name lookup, icon state, disabled behavior, and the send path;
  - Tailwind classes remain static;
  - README coverage is current for the scoped change.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/new-chat/new-chat-page.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused NewChatPage test: 1 file / 2 tests passed.
- Web typecheck: passed.
- React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 38 files / 131 tests passed.

## Notes

- This batch intentionally does not change composer layout, workspace selection, persisted composer preferences, session title derivation, runtime selection, or recent session rendering.
