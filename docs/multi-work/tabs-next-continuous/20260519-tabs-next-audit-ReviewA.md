# ReviewA tabs-next audit

## Findings

- README is accurate for the current `packages/tabs-next` behavior. The documented ownership, render policies, navigation compatibility layer, URL sync, persisted-context repair, and file inventory match the inspected source and tests.
- Current diffs affect `README.md`, `tab-link.tsx`, and `tab-renderer.tsx`; `tab-bar.tsx` and tests have no diff in the inspected worktree.
- `tab-link.tsx` changes are behavior-preserving cleanup: shared default empty params and clearer callback names. README now documents the anchor semantics and new-tab activation gestures accurately.
- `tab-renderer.tsx` changes replace local loader `useState` updates with a reducer while preserving the loader state machine: idle/loading shows fallback, success renders with `loaderData`, error renders the loader error panel. README now documents the reducer-managed loader boundary accurately.
- Obvious small test gap: there is no direct component test for `<Link>`. `use-tab-navigation.test.tsx` covers the underlying hook semantics, but not the anchor-facing contract: generated `href`, primary click prevention, default-prevented click pass-through, modifier/new-tab gestures, and middle-click `onAuxClick`.

## Risks

- The `params = EMPTY_TAB_PARAMS` default in `tab-link.tsx` is module-scoped. It is safe as long as navigation/store code treats params as immutable. A direct Link test would make regressions around default params and event handling easier to catch.
- Loader reducer behavior is simple and already equivalent to the previous code, but current tests only cover `chooseMountedTabIds`; there is no renderer integration test for loader success/error transitions. This is less urgent than the Link gap because the current diff is a mechanical state-management refactor.

## Recommended next action

- Add a focused `packages/tabs-next/src/__tests__/tab-link.test.tsx` covering the public `<Link>` component contract:
  - renders an `href` produced from the route registry and params;
  - primary click calls current-tab navigation and prevents browser navigation;
  - `onClick` with `preventDefault()` prevents tab navigation;
  - `metaKey`/`ctrlKey`, `newTab`, and middle-click open a new tab.
- README can stay unchanged for this pass. If `tab-link.test.tsx` is added, update the README file inventory in the same patch.

## Exact files inspected

- `packages/tabs-next/README.md`
- `packages/tabs-next/src/components/tab-link.tsx`
- `packages/tabs-next/src/components/tab-renderer.tsx`
- `packages/tabs-next/src/components/tab-bar.tsx`
- `packages/tabs-next/src/__tests__/renderer-policy.test.ts`
- `packages/tabs-next/src/__tests__/use-tab-navigation.test.tsx`
- `packages/tabs-next/src/__tests__/tab-bar.test.tsx`
- `packages/tabs-next/src/__tests__/store.test.ts`
- `packages/tabs-next/src/__tests__/url-sync.test.ts`
- `packages/tabs-next/src/__tests__/persisted-contexts.test.ts`
