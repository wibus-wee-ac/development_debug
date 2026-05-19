# Directory Browser UX Batch

## Scope

This batch continued the Cradle UX improvement stream in `apps/web/src/features/filesystem`.

The target was the browser fallback directory picker, specifically:

- make the existing `description` prop visible and accessible;
- improve directory list keyboard ergonomics;
- keep the PathBar input suggestion keyboard handling isolated;
- document the filesystem feature directory.

## Changes

- Updated `apps/web/src/features/filesystem/directory-browser-dialog.tsx`.
  - Renders `description` in the sidebar.
  - Uses `DialogTitle` and `DialogDescription` so the dialog has an accessible title/description.
  - Adds keyboard handling for the directory listing:
    - `ArrowDown` / `ArrowUp` move the selected directory when the listing container has focus.
    - `Enter` on the listing container enters the selected directory, or the first directory when none is selected.
    - `Enter` on a focused directory row enters that exact row.
    - `Cmd+Enter` / `Ctrl+Enter` on a directory row selects that exact directory.
  - Avoids incomplete composite tree semantics by keeping directory rows as ordinary buttons.
- Added `apps/web/src/features/filesystem/directory-browser-dialog.test.ts`.
  - Covers directory selection movement bounds for the pure helper.
- Added `apps/web/src/features/filesystem/README.md`.
  - Documents directory picker ownership and file inventory.

## Review Loop

Initial ReviewH failed the first implementation because:

- bubbled `Enter` from focused row buttons could navigate to a stale selected directory;
- `role="tree"` was incomplete for the rendered structure;
- visible title/description were not connected to dialog accessibility semantics.

The follow-up implementation moved row `Enter` handling onto each row button, changed the listing to ordinary button semantics, and uses `DialogTitle` / `DialogDescription`.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/filesystem/directory-browser-dialog.test.ts
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest . --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Filesystem targeted test: 1 file / 3 tests passed.
- Web typecheck: passed.
- React Doctor diff scan after the fix: 100/100, no issues.
- Web full test suite after ReviewI fixes: 25 files / 93 tests passed.

## Known Limits

- The test coverage is intentionally focused on selection bounds, not a full rendered dialog interaction test.
- Browser fallback directory picking still depends on filesystem API mocks for any future UI-level tests.
