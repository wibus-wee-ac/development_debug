<!-- Once this directory changes, update this README.md -->

# @cradle/tabs-next

`@cradle/tabs-next` is the prototype tab runtime that treats each tab as an independent navigation context instead of a `type + params` component slot.

## Architecture

- `TabLocation` describes the route currently shown in a tab.
- `TabContextState` stores tab-local history, current history index, keep-alive policy, timestamps, and view snapshots.
- `createTabStore(registry)` owns runtime tab contexts and exposes a compatibility surface for the current Cradle app.
- `createUrlSync({ store, registry })` projects the active tab context into browser history and restores tab-local history on `popstate`.
- `<TabRenderer>` renders active contexts through a render policy:
  - `single`: only the active tab is mounted.
  - `activity-pool`: active tab plus recent retained tabs are mounted through React `<Activity>`. Pinned tabs and `keepAlive: 'always'` tabs may exceed `maxMountedTabs`; the limit only constrains default retained tabs.
  - Route loaders are isolated behind a reducer-managed boundary so async loader transitions stay tied to the route params that triggered them.
- `<TabBar>` exposes a single `TabBarCustomization` surface for chrome slots: close icon, new-tab icon, per-tab icon, and optional tooltip wrapper.
- `<Link>` preserves anchor semantics while routing primary activation through the active tab and modifier or middle-click activation through a new tab.
- `defineTab()` is kept as a migration helper. Long term, route owners should provide route metadata/capabilities directly.

## Ownership

The package owns tab lifecycle and render retention only:

- tab identity
- active tab selection
- tab-local history
- restore hygiene
- keep-alive policy
- view-state snapshot slots

The package does not own business data, route semantics, or domain state. Those remain with route owners, React Query, and app-level adapters.

## Files

- **src/index.ts**: Public package exports.
- **src/types.ts**: Runtime contracts for locations, contexts, route definitions, render policy, and persistence.
- **src/route-definition.ts**: `defineTab()` migration helper plus route-title/location utilities.
- **src/store.ts**: Zustand runtime store for tab contexts, history, restore validation, and compatibility actions.
- **src/url-sync.ts**: Hash-mode browser history projection and `popstate` restore coordination.
- **src/context.ts**: React context and `useTabsContext()`.
- **src/provider.tsx**: Provider component for store and registry injection.
- **src/hooks/use-tab-navigation.ts**: Programmatic navigation helper for open-or-activate, explicit new-tab, and current-tab navigation.
- **src/components/tab-link.tsx**: Anchor-like navigation helper for routes registered with tabs-next, including stable default params and new-tab activation gestures.
- **src/components/tab-renderer.tsx**: Policy-driven renderer with React Activity pool support and reducer-managed loader state.
- **src/components/tab-bar.tsx**: DnD tab bar with close, activate, reorder, tear-off hooks, per-tab presentation, and shared chrome customization slots.
- **src/components/screen-coordinates.ts**: Tear-off coordinate helpers.
- **src/debug.ts**: Debug channel, storage keys, metrics, and snapshot utilities.
- **src/cn.ts**: Package-local class name merge helper.
- **src/__tests__/store.test.ts**: Store lifecycle and history tests.
- **src/__tests__/renderer-policy.test.ts**: Render policy tests.
- **src/__tests__/tab-link.test.tsx**: Link href and tab navigation gesture tests.
- **src/__tests__/use-tab-navigation.test.tsx**: Hook tests for current-tab and new-tab navigation helpers.
- **src/__tests__/url-sync.test.ts**: Browser history and `popstate` URL sync tests.
- **src/__tests__/persisted-contexts.test.ts**: Persisted context repair tests.
- **src/__tests__/tab-bar.test.tsx**: Tab bar accessibility, drag cleanup, and tear-off trigger tests.

## Migration Notes

The prototype intentionally ships with a compatibility layer:

- `openTab(type, params)` still works.
- `createTab(type, params)` opens a fresh context and bypasses dedupe.
- `updateTabParams()` replaces the current tab location without changing the tab identity.
- `navigateTab()` pushes a new location into the tab-local history.
- `useTabNavigation().navigateInTab()` pushes into the active tab history by default, while pinned active tabs fall back to `openTab()`.
- `<Link>` keeps a browser-readable `href` for registered routes, prevents primary clicks for tab-local navigation, and opens a new tab for modifier clicks, middle clicks, or `newTab`.
- `goBack()` and `goForward()` move within the tab-local history.
- Browser `popstate` restoration updates both tab content location and tab label through the store-owned history restore path.
- Persisted contexts are repaired during store hydration: unknown routes are pruned from tab-local history, indices are clamped to the remaining history, and missing contexts are rebuilt from valid tabs.

This lets Cradle migrate first while keeping existing tab definitions readable. The next migration step is to move `defineTab()` metadata into route-owned capability objects.
