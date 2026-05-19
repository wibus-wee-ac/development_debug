# Pack Codebase Scope Input A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/pack-codebase`.

The target was the scope path input area:

- remove the extra wrapper tab stop;
- associate the visible label directly with the textarea;
- preserve mouse click-to-focus behavior for wrapper whitespace;
- avoid clickable non-interactive element warnings;
- preserve chip deletion, comma input, multiline input, blur commit, and pending draft pack behavior.

## Changes

- Updated `apps/web/src/features/pack-codebase/pack-codebase-dialog.tsx`.
  - Added `htmlFor="pack-scope-paths"` to the scope label.
  - Added `id="pack-scope-paths"` to the scope textarea.
  - Removed wrapper `tabIndex={0}` and manual Enter/Space focus handling.
  - Replaced wrapper `onClick` focus handling with `onMouseDown`.
  - Skips wrapper mouse focus handling for events that start inside `button` or `textarea`.
- Updated `apps/web/src/features/pack-codebase/README.md`.
  - Documented the accessible scope path input responsibility.

## Review Loop

- The first validation pass failed React Doctor with `jsx-a11y/click-events-have-key-events` because the wrapper still used `onClick`.
- The fix changed wrapper focus behavior to `onMouseDown`, keeping mouse whitespace focus without making the wrapper a keyboard-operable pseudo-control.
- ReviewAA passed and confirmed:
  - the extra tab stop is removed;
  - the label is directly associated with the textarea;
  - wrapper whitespace can still focus the textarea;
  - remove buttons and textarea input are not hijacked by wrapper focus handling;
  - chip deletion, comma/multiline input, blur commit, and pending draft pack behavior did not visibly regress;
  - Tailwind classes remain static;
  - README coverage is current.

## Verification

```sh
rg -n 'tabIndex=\{0\}|onClick=\{\(\) => pathInputRef|onClick=\{\(e\) => pathInputRef|pack-scope-paths|onMouseDown' apps/web/src/features/pack-codebase/pack-codebase-dialog.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Scoped grep: only `htmlFor` / `id` and `onMouseDown` remain for the scope input path.
- Web typecheck: passed.
- React Doctor diff scan for `apps/web`: 100/100, no issues after the `onMouseDown` fix.
- Web full test suite: 30 files / 112 tests passed.

## Notes

- This batch intentionally does not change pack request shape, include glob construction, clipboard write behavior, or the existing scope path parsing helpers.
