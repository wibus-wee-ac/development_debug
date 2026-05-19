# Browser Tab A11y Audit ReviewS

## Verdict

Fail.

The nested interactive control regression is fixed: the tab select control and close control are now sibling native `button` elements, so the previous `button > role=button` nesting problem is gone. Active tab selection and `closeTab` behavior are also preserved by the new event structure.

One a11y/UX issue remains blocking: the close button hit target is substantially below a reasonable minimum target size.

## Findings

### Medium: close tab button target is too small

- File: `apps/web/src/features/browser/browser-panel.tsx:246`
- The close control is now a real `button`, which is correct, but its interactive box is only the `size-2.5` icon plus `p-0.5` padding. That yields an approximately 14px target, below the 24px WCAG 2.2 minimum target-size guidance and below the project UI review guideline of 32px for reliable pointer interaction.
- This is especially risky because the close button sits directly beside the tab selection button. A small target increases accidental tab selection and missed close attempts.
- Suggested fix: keep the visual icon compact, but give the button a stable `size-6` or larger hit area, for example with centered icon content and no layout shift. Preserve static Tailwind classes.

## Checks

- Nested controls: Pass. The outer tab wrapper is a `div`; the select and close controls are sibling native `button` elements at `apps/web/src/features/browser/browser-panel.tsx:234` and `apps/web/src/features/browser/browser-panel.tsx:246`.
- Selection semantics: Pass. Clicking the tab title button still calls `setActiveTab(tab.id)` at `apps/web/src/features/browser/browser-panel.tsx:236`.
- Close semantics: Pass. Clicking the close button calls `closeTab(tab.id)` at `apps/web/src/features/browser/browser-panel.tsx:248`. Because the close button is no longer inside the select button, it no longer needs `stopPropagation` to avoid tab selection.
- Store behavior: Pass. `closeTab` still removes the requested tab and, when the closed tab is active, selects the last remaining tab or `null` at `apps/web/src/store/browser-panel.ts:76`.
- Keyboard behavior: Pass with note. Native buttons restore default Enter/Space activation. The close button becomes visible on keyboard focus via `focus-visible:opacity-100`.
- ARIA: Pass with note. The close button has a computed accessible label. `aria-current="page"` on the selected tab button is acceptable as a lightweight current-item marker, though a full tab pattern would use `role="tablist"`, `role="tab"`, `aria-selected`, and an associated tab panel if this component later formalizes browser tabs as ARIA tabs.
- AGENTS compliance: Pass. The new `README.md` exists for the changed feature directory, Tailwind classes are static, and code identifiers/comments in the modified source are English.
- React/render/perf: Pass for this diff. Inline handlers are bounded by `MAX_TABS = 5`, so there is no meaningful render-cost concern introduced by this change.

## Verification

Reviewed by reading:

- `apps/web/src/features/browser/browser-panel.tsx`
- `apps/web/src/features/browser/README.md`
- `apps/web/src/store/browser-panel.ts`
- Current `git diff` for the scoped files

No source files were modified. No automated test or browser a11y audit was run for this review.
