PASS

Reviewed current diff only for:

- `apps/web/src/features/git/git-panel.tsx`
- `apps/web/src/features/git/branch-picker.tsx`
- `apps/web/src/features/git/git-controls-a11y.test.tsx`
- `apps/web/src/features/git/README.md`

Findings:

- No blocking issues found.
- Icon-only fetch controls now expose stable accessible names:
  - `GitPanel` fetch button: `aria-label="Fetch git updates"`.
  - `BranchPicker` fetch button: `aria-label="Fetch branches"`.
  - `BranchPicker` create cancel button: `aria-label="Cancel branch creation"`.
- Decorative Lucide icons inside the changed icon-only controls are hidden from the accessibility tree with `aria-hidden`, so they should not pollute button names.
- Tailwind usage remains static. The existing `cn('size-3.5', fetching && 'animate-spin')` pattern uses literal class names and does not violate the no-dynamic-Tailwind constraint.
- Callback behavior remains scoped to the existing control paths. The fetch controls still call `postWorkspacesByIdGitFetch` with the workspace id and invalidate the related git queries through the existing helper.
- The new regression tests query the controls by role and accessible name, which meaningfully protects the specific accessibility contract introduced by this patch.
- Test mocks are scoped to external UI/query/SDK dependencies. The mocked `Button` preserves native button semantics and props, so `aria-label`, `disabled`, and click behavior remain observable.
- The Popover mock renders content eagerly instead of modeling real open/closed behavior. That is acceptable for this node because the test target is accessible naming of the controls, not Popover interaction semantics.
- README coverage was updated to include the new test file and the named fetch/cancel control behavior.

Residual risk:

- The test does not assert that the decorative SVG icons are absent from the accessibility tree. It indirectly protects the button names, which is sufficient for this patch, but a future stricter audit could add an explicit icon-hidden assertion if the project standardizes one.
