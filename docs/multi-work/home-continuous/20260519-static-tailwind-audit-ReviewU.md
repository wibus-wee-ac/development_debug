# Home Static Tailwind Audit ReviewU

## Result

Pass.

## Scope

- `apps/web/src/features/home/home-dashboard.tsx`
- `apps/web/src/features/home/README.md`

## Findings

No blocking findings.

## Review Notes

- `ActivityCard` no longer uses a template literal to compose Tailwind classes for the themed preview area.
- The themed preview area now uses `cn('relative flex h-14 w-full items-center justify-center', theme.bg)`, matching the project convention for static class composition.
- `CARD_THEMES` keeps background classes as literal strings:
  - `bg-blue-500/10`
  - `bg-violet-500/10`
  - `bg-emerald-500/10`
  - `bg-orange-500/10`
  - `bg-pink-500/10`
- The `ActivityCard` structural classes, dimensions, link/button branching, click behavior, and icon theme mapping are otherwise unchanged. I did not find a visual or behavioral boundary regression in the diff.
- The README now documents that `home-dashboard.tsx` owns static activity card themes, which covers the feature-directory responsibility touched by this change.

## Verification

- Reviewed the file diff for the scoped files.
- Ran a scoped grep for Tailwind-related dynamic class patterns in the target files. Matches were limited to non-class template strings for relative time labels and React keys.
- Accepted the provided validation context:
  - dynamic Tailwind scan passed with no matches across `apps/web/src`
  - `pnpm --filter @cradle/web exec tsc --noEmit --pretty false` passed
  - `npx -y react-doctor@latest apps/web --verbose --diff` passed with `100/100`
  - `pnpm --filter @cradle/web test` passed with `30 files / 110 tests`

## Residual Risk

Low. This is a narrow mechanical change from template interpolation to `cn()` with the same base classes and the same literal theme values.
