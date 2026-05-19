# Chat Minimap A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/chat`.

The target was the right-edge chat minimap:

- expose the minimap track as a native accessible control;
- remove the `aria-hidden` pseudo-button pattern;
- preserve reading progress, click-to-message, drag-to-scroll, and hover preview behavior;
- add regression coverage for native button semantics and keyboard fallback behavior.

## Changes

- Updated `apps/web/src/features/chat/chat-minimap.tsx`.
  - Replaced the `div role="button"` minimap track with `button type="button"`.
  - Removed the `aria-hidden="true"` wrapper from the interactive minimap.
  - Moved the hover preview popover outside the button so the preview remains a sibling, not button content.
  - Switched pointer capture to `e.currentTarget` so internal bar spans do not receive capture.
  - Converted bar wrappers/fills from `div` to `span` to keep the button content inline-safe.
  - Preserved the React 19 ref prop imperative handle.
  - Added `activeIndexRef` so keyboard activation can fall back to the current reading-progress message when no pointer hover exists.
- Updated `apps/web/src/features/chat/chat-minimap.test.tsx`.
  - Kept coverage for `setScrollProgress()` updating fill transforms.
  - Added coverage for the accessible native minimap button.
  - Added click-to-index coverage.
  - Added no-hover keyboard activation coverage after `setScrollProgress(0.75)`.
- Updated `apps/web/src/features/chat/README.md`.
  - Documented the accessible minimap behavior and test coverage.

## Review Loop

- ReviewX failed the first version because keyboard activation called `preventDefault()` and only scrolled when `hoverIdx` existed.
- The fix introduced `scrollToKeyboardMessage()` with a fallback to `activeIndexRef.current`.
- ReviewY passed and confirmed:
  - keyboard activation no longer depends on pointer hover;
  - `activeIndexRef` matches the existing visual progress active-index semantics;
  - ref handle, pointer click, drag-to-scroll, and hover preview sibling structure did not regress;
  - the focused test covers the no-hover Enter fallback failure mode.

## Verification

```sh
rg -n 'aria-hidden="true"|role="button"|tabIndex=\{0\}' apps/web/src/features/chat/chat-minimap.tsx
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/chat/chat-minimap.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Scoped aria/role/tabIndex scan: no matches.
- ChatMinimap focused test: 1 file / 2 tests passed.
- Web typecheck: passed.
- React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 30 files / 111 tests passed.

## Notes

- This batch intentionally does not change chat stream transport, message projection, or virtual scrolling ownership.
- Space activation shares the same implementation branch as Enter; the focused test explicitly covers Enter.
