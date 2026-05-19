# Browser Toolbar Hit Target Batch

## Scope

This batch continued the Cradle UX/accessibility improvement stream in `apps/web/src/features/browser`.

The target was compact icon-only controls in the browser panel toolbar:

- replace padding-only hit targets with explicit interactive boxes;
- keep visual icon sizes and toolbar density unchanged;
- preserve navigation callbacks and disabled semantics;
- document accessible navigation control ownership.

## Changes

- Updated `apps/web/src/features/browser/browser-panel.tsx`.
  - Expanded the new tab button to an explicit `size-6` hit target while keeping `PlusIcon` at `size-3`.
  - Expanded the back, forward, and reload buttons to explicit `size-7` hit targets while keeping icons at `size-3.5`.
  - Added consistent `focus-visible` ring treatment to the scoped icon-only controls.
  - Kept `handleNewTab`, `handleGoBack`, `handleGoForward`, `handleReload`, and existing disabled conditions unchanged.
- Updated `apps/web/src/features/browser/README.md`.
  - Documented browser ownership of accessible tab and navigation controls.

## Review Loop

- ReviewV passed and confirmed:
  - the four scoped controls now have explicit compact hit targets;
  - visual icon sizes remain unchanged;
  - callbacks and disabled semantics did not regress;
  - focus-visible treatment is present;
  - Tailwind classes remain static strings;
  - README coverage is current for the touched feature directory.

## Verification

```sh
rg -n 'className=\{`|text-\$\{|bg-\$\{|grid-cols-\$\{|col-span-\$\{|row-span-\$\{' apps/web/src --glob '*.tsx' --glob '*.ts'
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
npx -y react-doctor@latest apps/web --verbose --diff
pnpm --filter @cradle/web test
```

Observed results:

- Dynamic Tailwind scan: no matches.
- Web typecheck: passed.
- React Doctor diff scan for `apps/web`: 100/100, no issues.
- Web full test suite: 30 files / 110 tests passed.

## Notes

- The toolbar targets remain compact (`size-6` / `size-7`) to preserve browser panel density.
- This batch intentionally does not change browser tab store semantics, navigation behavior, or Electron webview lifecycle handling.
