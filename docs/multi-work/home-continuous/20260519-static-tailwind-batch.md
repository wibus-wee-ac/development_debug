# Home Static Tailwind Batch

## Scope

This batch continued the Cradle DX/code-quality improvement stream in `apps/web/src/features/home`.

The target was the home dashboard activity card theme composition:

- remove dynamic Tailwind class interpolation;
- keep activity card visuals and behavior unchanged;
- document the static theme ownership in the feature README.

## Changes

- Updated `apps/web/src/features/home/home-dashboard.tsx`.
  - Imported `cn` from `~/lib/cn`.
  - Replaced the themed preview area's template literal class composition with `cn('relative flex h-14 w-full items-center justify-center', theme.bg)`.
  - Kept `CARD_THEMES` background values as literal static Tailwind class strings.
- Updated `apps/web/src/features/home/README.md`.
  - Documented that `home-dashboard.tsx` owns static activity card themes.

## Review Loop

- ReviewU passed and confirmed:
  - `ActivityCard` no longer uses template literal Tailwind composition;
  - the project `cn()` convention is used;
  - `CARD_THEMES` remains statically discoverable by Tailwind;
  - no visual or behavior regression was found;
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

- This batch intentionally does not change home dashboard mock data, routing, or workspace/session query behavior.
