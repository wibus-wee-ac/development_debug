# Search + Git Continuous Batch

## Scope

This batch continued the Cradle UX/DX/Feature improvement stream with two small, independently verifiable web nodes:

- Git graph layout QA coverage.
- Global Search file-result actionability.

## Changes

### Git graph layout QA

- Added `apps/web/src/features/git/graph-layout.test.ts`.
- Covered linear history lane stability, merge parent lane split/convergence, and empty graph behavior.
- Updated `apps/web/src/features/git/README.md` inventory.

### Global Search file results

- Added `apps/web/src/features/search/global-search-actions.ts`.
- Added `apps/web/src/features/search/global-search-actions.test.ts`.
- Updated `apps/web/src/features/search/global-search-dialog.tsx` so file results:
  - open the owning `workspace-detail` tab;
  - copy the relative file path when clipboard is available;
  - report clipboard success/failure through the existing toast manager.
- Included workspace file fetching in global pending state so the dialog does not show a premature no-results state while file results are still loading.
- Updated `apps/web/src/features/search/README.md` inventory and behavior notes.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/git/graph-layout.test.ts
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/search/global-search-actions.test.ts src/features/search/thread-search-groups.test.ts src/features/search/thread-search-normalize.test.ts src/features/git/graph-layout.test.ts
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest . --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Git graph targeted test: 1 file / 3 tests passed.
- Search/git targeted test run: 4 files / 11 tests passed.
- Web typecheck: passed.
- React Doctor diff scan: 100/100, no issues.
- Web full test suite: 24 files / 90 tests passed.

## Follow-up Candidates

- Add a UI-level test for `GlobalSearchDialog` once command/dialog mocks are worth maintaining.
- Consider a first-class file viewer/open-file intent if workspace detail grows stable file navigation semantics.
- Explorer recommended `apps/web/src/features/filesystem/directory-browser-dialog.tsx` keyboard selection and discoverability as the next UX node.
