# AppHeader Toggle Accessibility Audit ReviewAD

Status: PASS

## Scope

Reviewed only the current diff for:

- `apps/web/src/components/layout/app-header.tsx`
- `apps/web/src/components/layout/app-header.test.tsx`
- `apps/web/src/components/layout/README.md`

## Findings

No blocking findings.

The patch adds explicit accessible names for the icon-only AppHeader controls, hides decorative lucide icons from the accessibility tree, and exposes `aria-pressed` on the browser, bottom panel, and right panel toggle buttons. The sidebar control uses state-specific action labels, which is appropriate for an expand/collapse command and avoids an ambiguous icon-only name.

The added regression tests cover accessible role/name lookup, pressed states, and callback wiring through those accessible controls. The test mocks are scoped to the component dependencies and the new test file includes the required file header.

The README update covers the changed AppHeader semantics and adds the new test file to the layout directory inventory.

## Verification

- `git diff --check -- apps/web/src/components/layout/app-header.tsx apps/web/src/components/layout/app-header.test.tsx apps/web/src/components/layout/README.md`
- `pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/components/layout/app-header.test.tsx`

Both commands passed.

## Notes

No dynamic Tailwind class construction was introduced in this diff.
