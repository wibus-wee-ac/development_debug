# Capsule Composer Send A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/workspace-detail`.

The target was the workspace overview capsule composer send action:

- expose a stable English accessible name for the icon-only send button;
- keep the visual sending/send icon decorative;
- preserve empty-state disabling and standard runtime submission payload behavior;
- document the new focused regression test.

## Changes

- Updated `apps/web/src/features/workspace-detail/capsule-composer.tsx`.
  - Changed the send button accessible name from `发送` to `Send message`.
- Added `apps/web/src/features/workspace-detail/capsule-composer.test.tsx`.
  - Covers the send control by role/name.
  - Verifies empty input leaves the send button disabled.
  - Verifies the named send control calls `onSend` with the existing standard runtime payload shape.
- Updated `apps/web/src/features/workspace-detail/README.md`.
  - Documents the capsule composer accessible send action and focused regression test.

## Review Loop

- ReviewAO passed and confirmed:
  - the icon-only capsule send button exposes a stable English accessible name;
  - the visual send/loading icons remain decorative;
  - disabled state, `handleSend`, and payload construction are preserved;
  - the focused regression test covers role/name lookup, empty disabled behavior, decorative icon state, and standard runtime payload wiring;
  - Tailwind constraints are unaffected;
  - README coverage is current for the scoped change.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/workspace-detail/capsule-composer.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused CapsuleComposer test: 1 file / 2 tests passed.
- Web typecheck: passed.
- React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 39 files / 133 tests passed.

## Notes

- This batch intentionally does not change capsule expansion behavior, mention handling, runtime selection, composer layout, workspace detail pane loading, or chat session creation.
