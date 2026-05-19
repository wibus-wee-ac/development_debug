# Browser Tab A11y Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/browser`.

The target was the browser panel tab strip:

- remove nested interactive controls from browser tabs;
- keep tab activation and close behavior separate;
- improve close button pointer and keyboard affordance;
- document the browser feature directory inventory.

## Changes

- Updated `apps/web/src/features/browser/browser-panel.tsx`.
  - Replaced the previous tab `button` containing a nested `role="button"` close control with a non-interactive wrapper containing two sibling native buttons.
  - The tab activation button now owns `setActiveTab(tab.id)` and `aria-current`.
  - The close button now owns `closeTab(tab.id)` and has an explicit `aria-label`.
  - Expanded the close button hit target to `size-6` while preserving the visual `XIcon` size at `size-2.5`.
- Added `apps/web/src/features/browser/README.md`.
  - Documents the browser feature files and ownership boundary.

## Review Loop

- ReviewS failed the first version because the close button hit target was still too small after the nested interactive control was removed.
- The fix changed the close button from a tiny padding-only target to `flex size-6 items-center justify-center`.
- ReviewT passed and confirmed:
  - nested interactive controls did not return;
  - the close button hit target is acceptable;
  - Tailwind classes remain static;
  - tab activation and close behavior did not regress.

## Verification

```sh
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest . --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Web typecheck: passed.
- React Doctor diff scan: `apps/web` reported 100/100 with no issues.
- React Doctor command exited non-zero because unrelated monorepo projects had existing findings.
- Web full test suite: 30 files / 110 tests passed.

## Notes

- This batch intentionally does not change browser tab store semantics or Electron webview lifecycle handling.
- The close icon remains visually compact to preserve tab strip density while the button target is larger for reliable pointer use.
