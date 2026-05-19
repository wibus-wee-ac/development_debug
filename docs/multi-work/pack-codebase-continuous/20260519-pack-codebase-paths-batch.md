# Pack Codebase Paths UX Batch

## Scope

This batch continued the Cradle UX/DX improvement stream in `apps/web/src/features/pack-codebase`.

The target was the scope-path input contract in `PackCodebaseDialog`:

- the UI text says comma/newline-separated paths are supported;
- the previous implementation only committed the whole raw input as one path;
- include glob construction and token formatting were untested local helpers.

## Changes

- Added `apps/web/src/features/pack-codebase/pack-codebase-utils.ts`.
  - Splits scope path input on commas and newlines.
  - Merges paths while preserving order and skipping duplicates.
  - Builds repomix include globs from committed chips plus pending draft input.
  - Owns pack-codebase token label formatting.
- Added `apps/web/src/features/pack-codebase/pack-codebase-utils.test.ts`.
  - Covers comma/newline splitting.
  - Covers deduped merges.
  - Covers include glob construction.
  - Covers pending multiline draft inclusion.
  - Covers token formatting.
- Updated `apps/web/src/features/pack-codebase/pack-codebase-dialog.tsx`.
  - Replaced the single-line path input with a small textarea so multiline input has a visible interaction surface.
  - Keeps comma submission behavior.
  - Includes pending multiline draft paths during pack even if the textarea has not blurred into chips.
  - Moves include glob and token formatting logic into the feature-owned helper.
- Updated `apps/web/src/features/pack-codebase/README.md`.
  - Corrected the API description from the old IPC path to `POST /workspaces/:id/pack`.
  - Added the helper and test files to the feature inventory.

## Review Loop

- ReviewL failed the first version because newline parsing existed only in helpers while the dialog still used a single-line input.
- The fix changed the input to a textarea and made `handlePack()` call `pathsToIncludeFromDraft(state.scopePaths, state.pathInput)`.
- ReviewM passed and confirmed newline-separated draft paths now enter the final `include` payload.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/pack-codebase/pack-codebase-utils.test.ts
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest . --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Pack-codebase targeted test after fix: 1 file / 5 tests passed.
- Web typecheck: passed.
- React Doctor diff scan: 100/100, no issues.
- Web full test suite after fix: 27 files / 100 tests passed.

## Notes

- This batch intentionally does not change the server packing endpoint or repomix semantics.
- The file/directory heuristic for `pathToGlob()` preserves the existing behavior: paths with a dot in the last segment are treated as files; other paths become recursive directory globs.
