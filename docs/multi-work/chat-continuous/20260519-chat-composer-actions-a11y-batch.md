# Chat Composer Actions A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/chat`.

The target was the chat composer send/stop controls:

- expose stable English accessible names for the icon-only send and stop buttons;
- keep the visual send/stop icons decorative;
- preserve send disabled behavior, submit behavior, and stop callback behavior;
- document the new focused regression coverage.

## Changes

- Updated `apps/web/src/features/chat/composer.tsx`.
  - Changed the send button accessible name to `Send message`.
  - Changed the stop button accessible name to `Stop generation`.
- Updated `apps/web/src/features/chat/composer.test.tsx`.
  - Covers the send control by role/name.
  - Verifies empty input leaves send disabled.
  - Verifies send still submits the trimmed composer text.
  - Covers the streaming stop control by role/name and callback.
  - Verifies send/stop icons remain decorative.
- Updated `apps/web/src/features/chat/README.md`.
  - Documents named composer send/stop actions and focused regression coverage.

## Review Loop

- ReviewAT passed the scoped accessibility diff and confirmed:
  - send/stop controls expose stable English accessible names;
  - icons remain decorative;
  - focused tests cover role/name lookup, disabled state, send callback, stop callback, and icon state;
  - Tailwind classes remain static;
  - README coverage is present.
- React Doctor then reported a `react-doctor/no-giant-component` regression for `Composer`.
- Fixed by extracting `ComposerActions` as a narrow local helper that owns only the context bar plus send/stop branch.
- ReviewAU passed and confirmed:
  - send/stop accessible names remain correct after extraction;
  - `ComposerActions` is behavior-preserving and narrow;
  - send disabled behavior still uses trimmed input;
  - callbacks remain wired to the same parent handlers;
  - tests and README coverage remain scoped and relevant.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/chat/composer.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused Composer test: 1 file / 5 tests passed.
- Web typecheck: passed.
- Initial React Doctor diff scan reported 99/100 due to `react-doctor/no-giant-component` in `Composer`.
- After extracting `ComposerActions`, React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 42 files / 141 tests passed.

## Notes

- This batch intentionally does not change slash command parsing, mention handling, chat session transport, stop implementation, toolbar slots, or composer layout.
