<!--
Input: AppFooter session close accessibility work, focused test, review report, and validation commands
Output: Batch record for the AppFooter Jarvis session close accessibility node
Position: Multi-work audit trail for continuous app layout UX improvements
-->

# AppFooter Session Close A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/components/layout`.

The target was the AppFooter Jarvis session tab controls:

- replace the nested `span role="button"` close control with a sibling native button;
- expose a stable accessible name for closing a Jarvis session;
- keep the visual close and Ask Jarvis icons decorative;
- preserve separate activation and close callback behavior;
- document the focused regression test.

## Changes

- Updated `apps/web/src/components/layout/app-footer.tsx`.
  - Split each Jarvis session tab into sibling native buttons for activation and close actions.
  - Added `aria-label="Close Jarvis session <title>"` to the close button.
  - Marked close and Ask Jarvis icons as `aria-hidden="true"`.
- Added `apps/web/src/components/layout/app-footer.test.tsx`.
  - Covers close control lookup by role/name.
  - Verifies closing a session does not activate it.
  - Verifies activating a session does not remove it.
- Updated `apps/web/src/components/layout/README.md`.
  - Documents AppFooter session tab semantics and the focused regression test.

## Review Loop

- ReviewAS passed and confirmed:
  - the nested `span role="button"` close control was replaced with a sibling native button;
  - session activation and close actions no longer create nested interactive content;
  - the close action has a stable accessible name;
  - decorative icons are hidden from the accessibility tree;
  - the close button remains keyboard reachable and visible on `focus-visible`;
  - Tailwind classes remain static;
  - focused tests cover close-vs-activate callback separation;
  - README coverage is current for the scoped change.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/components/layout/app-footer.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused AppFooter test: 1 file / 2 tests passed.
- Web typecheck: passed.
- React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 42 files / 139 tests passed.

## Notes

- This batch intentionally does not change Jarvis popover behavior, session persistence, layout geometry measurement, or footer positioning.
