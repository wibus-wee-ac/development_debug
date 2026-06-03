# Editor BubbleMenu Icons A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/components/editor`.

The target was the inline editor BubbleMenu toolbar:

- keep existing named formatting and link action buttons;
- mark visual-only Lucide icons as decorative;
- preserve formatting and link callback behavior;
- document the new focused regression test.

## Changes

- Updated `apps/web/src/components/editor/editor-bubble-menu.tsx`.
  - Marked the Bold, Italic, Strikethrough, Code, Link, and Apply link icons as `aria-hidden="true"`.
- Added `apps/web/src/components/editor/editor-bubble-menu.test.tsx`.
  - Covers toolbar actions by role/name.
  - Verifies toolbar icons are decorative.
  - Verifies Bold formatting and Apply link callbacks still run through the editor chain.
- Updated `apps/web/src/components/editor/README.md`.
  - Documents named BubbleMenu toolbar actions, decorative icons, and the focused regression test.

## Review Loop

- ReviewAP passed and confirmed:
  - toolbar buttons keep explicit accessible names;
  - Lucide icons are correctly marked decorative;
  - formatting and link callback paths are unchanged except for icon attributes;
  - the focused regression test covers named controls, decorative icons, Bold callback wiring, and Apply link callback wiring;
  - no dynamic Tailwind classes were introduced;
  - README coverage is current for the scoped change.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/components/editor/editor-bubble-menu.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused EditorBubbleMenu test: 1 file / 2 tests passed.
- Web typecheck: passed.
- React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 40 files / 135 tests passed.

## Notes

- This batch intentionally does not change Tiptap editor configuration, BubbleMenu placement, link input behavior, Markdown serialization, or toolbar visual styling.
