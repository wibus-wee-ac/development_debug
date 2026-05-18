# Tabs Next WorkerB Handoff

## Scope

Implemented Milestone 2 from `docs/exec-plans/20260519-01-frontend-architecture-fixes.md`.

Write ownership was kept to:

- `packages/tabs-next/**`
- this handoff file

No edits were made to `apps/web`, root package files, or `pnpm-lock.yaml`.

## Changed Files

- `packages/tabs-next/src/store.ts`
  - Added `restoreTabHistoryIndex(tabId, historyIndex)` as the store-owned path for restoring tab-local history.
  - Updated persisted context sanitization to prune history entries whose `location.routeId` is not present in the current registry.
  - Added tab/context normalization so hydrated tabs align with the restored current history entry, including label and params.
  - Rebuilds missing contexts for otherwise valid tabs when persisted contexts are partially invalid.

- `packages/tabs-next/src/url-sync.ts`
  - Replaced direct `store.setState` mutation in `popstate` handling with `restoreTabHistoryIndex`.
  - This keeps route, params, history index, timestamp, and label updates under store ownership.

- `packages/tabs-next/src/components/tab-bar.tsx`
  - Added unmount cleanup for the global capture-phase `pointermove` listener installed during drag start.
  - Clears transient drag pointer state on unmount.
  - Added `aria-label` and `type="button"` to close and new-tab buttons.
  - Increased close/new-tab hit areas and replaced the tab pill `transition-all` with specific transition properties.

- `packages/tabs-next/src/__tests__/url-sync.test.ts`
  - Added jsdom coverage for `popstate` restoring route, params, context index, and tab label.
  - Added URL sync destroy listener cleanup coverage.

- `packages/tabs-next/src/__tests__/persisted-contexts.test.ts`
  - Added persisted localStorage repair coverage for unknown route history pruning and label normalization.

- `packages/tabs-next/src/__tests__/tab-bar.test.tsx`
  - Added component coverage for close/new-tab accessible names.
  - Added drag-start then unmount coverage to verify global listener removal.

- `packages/tabs-next/package.json`
  - Added package-local scripts: `test`, `test:watch`, and `typecheck`.

- `packages/tabs-next/README.md`
  - Updated the package inventory for URL sync, tab link, debug, cn, and new tests.
  - Documented `popstate` label restoration, persisted context repair, and Activity pool soft-limit behavior.

## Behavior Fixed

- Browser Back/Forward restoration now keeps the tab label consistent with the restored tab-local location.
- Persisted contexts no longer keep history entries for unknown routes.
- Hydrated tab descriptors are synchronized to the repaired current history entry.
- `TabBar` no longer leaks its global drag `pointermove` listener when unmounted during a drag.
- Close and new-tab controls now have basic accessible names and safer hit areas.

## Validation

Ran:

```bash
pnpm --filter @cradle/tabs-next test
pnpm --filter @cradle/tabs-next typecheck
git diff --check -- packages/tabs-next docs/multi-work/frontend-architecture-fixes
npx -y react-doctor@latest . --verbose --diff
```

Results:

- `@cradle/tabs-next` tests passed: 6 files, 16 tests.
- `@cradle/tabs-next` typecheck passed.
- Focused `git diff --check` passed.
- React Doctor reported `@cradle/tabs-next` score 99/100 with one remaining warning about the existing render-prop customization surface in `TabBar`.

## Risks

- `restoreTabHistoryIndex` preserves explicit history entry titles when present. This matches the existing history model, but route owners with dynamic async labels may still update labels after render through the existing compatibility path.
- `TabBar` still exposes several render props. React Doctor flagged this as an API-shape concern, but changing it would be a public API refactor outside Milestone 2.
- The React Doctor full diff scan also reported issues in other packages and `apps/web`; those are outside this worker ownership and were not modified.

## Escalation

No blocker. The only escalation candidate is the existing `TabBar` render-prop API shape if the project wants to move toward a slot or compound-component contract later.
