# AppHeader Toggle A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/components/layout`.

The target was the AppHeader chrome toggle controls:

- expose accessible names for icon-only shell controls;
- expose pressed state for panel-style toggles;
- hide decorative icons from assistive technology;
- preserve existing `data-testid` anchors and click wiring.

## Changes

- Updated `apps/web/src/components/layout/app-header.tsx`.
  - Added state-specific sidebar toggle labels.
  - Added accessible names for browser, bottom panel, and right panel toggles.
  - Added `aria-pressed` for browser, bottom panel, and right panel toggle state.
  - Marked the toggle icons as decorative.
- Added `apps/web/src/components/layout/app-header.test.tsx`.
  - Covers accessible role/name queries.
  - Covers pressed-state output.
  - Covers callback wiring through the accessible controls.
- Updated `apps/web/src/components/layout/README.md`.
  - Documented AppHeader accessible toggle semantics and the new regression test.

## Review Loop

- ReviewAD passed and confirmed:
  - accessible names and pressed states are appropriate for the controls;
  - decorative icons are hidden from the accessibility tree;
  - focused tests cover the changed behavior;
  - static Tailwind constraints are respected;
  - README coverage is current for the scoped change.

## Verification

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/components/layout/app-header.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Focused AppHeader test: 1 file / 3 tests passed.
- Web typecheck: passed.
- React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 32 files / 118 tests passed.

## Notes

- This batch intentionally does not change the visual labels, layout geometry, tab bar behavior, or Electron-only browser panel gating.
