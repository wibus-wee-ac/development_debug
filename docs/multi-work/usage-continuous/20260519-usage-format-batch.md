# Usage Format DX Batch

## Scope

This batch continued the Cradle DX/QA improvement stream in `apps/web/src/features/usage`.

The target was a small, low-risk usage dashboard cleanup:

- extract numeric formatting into a pure helper;
- add regression coverage for token and USD display labels;
- remove dynamic Tailwind-style class construction from `UsageDashboard`.

## Changes

- Added `apps/web/src/features/usage/usage-format.ts`.
  - Owns `formatTokens`.
  - Owns `formatUsd`.
- Added `apps/web/src/features/usage/usage-format.test.ts`.
  - Covers compact token formatting around raw, `K`, and `M` boundaries.
  - Covers the `K` to `M` rounding rollover so `999_950` displays as `1.0M` instead of `1000.0K`.
  - Covers tiny non-zero USD values so low estimated costs remain visible.
- Updated `apps/web/src/features/usage/usage-dashboard.tsx`.
  - Imports formatting helpers from the usage-owned pure helper.
  - Uses `cn()` with statically defined Tailwind classes for conditional text and pill styling.
- Updated `apps/web/src/features/usage/README.md`.
  - Added the new helper and test files to the feature inventory.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/usage/usage-format.test.ts
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest . --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Usage targeted test: 1 file / 2 tests passed.
- Web typecheck: passed.
- React Doctor diff scan: 100/100, no issues.
- Web full test suite: 26 files / 95 tests passed.

## Review Loop

- ReviewJ passed with one non-blocking QA gap: `formatTokens(999_950)` could display `1000.0K`.
- The gap was fixed by promoting rounded `1000.0K` values to the `M` suffix.
- ReviewK passed and confirmed the rollover tests close the gap.

## Notes

- This batch intentionally does not change dashboard data fetching behavior.
- Heatmap internals still have no direct unit coverage; this batch only covers formatting and styling hygiene.
