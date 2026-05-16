<!-- Once this directory changes, update this README.md -->

# @cradle/tabs-next

`@cradle/tabs-next` is the prototype tab runtime that treats each tab as an independent navigation context instead of a `type + params` component slot.

## Architecture

- `TabLocation` describes the route currently shown in a tab.
- `TabContextState` stores tab-local history, current history index, keep-alive policy, timestamps, and view snapshots.
- `createTabStore(registry)` owns runtime tab contexts and exposes a compatibility surface for the current Cradle app.
- `<TabRenderer>` renders active contexts through a render policy:
  - `single`: only the active tab is mounted.
  - `activity-pool`: active tab plus recent retained tabs are mounted through React `<Activity>`.
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
- **src/context.ts**: React context and `useTabsContext()`.
- **src/provider.tsx**: Provider component for store and registry injection.
- **src/hooks/use-tab-navigation.ts**: Programmatic navigation helper for open-or-activate, explicit new-tab, and current-tab navigation.
- **src/components/tab-renderer.tsx**: Policy-driven renderer with React Activity pool support.
- **src/components/tab-bar.tsx**: DnD tab bar with close, activate, reorder, tear-off hooks, and optional per-tab presentation overrides.
- **src/components/screen-coordinates.ts**: Tear-off coordinate helpers.
- **src/__tests__/store.test.ts**: Store lifecycle and history tests.
- **src/__tests__/renderer-policy.test.ts**: Render policy tests.

## Migration Notes

The prototype intentionally ships with a compatibility layer:

- `openTab(type, params)` still works.
- `createTab(type, params)` opens a fresh context and bypasses dedupe.
- `updateTabParams()` replaces the current tab location without changing the tab identity.
- `navigateTab()` pushes a new location into the tab-local history.
- `useTabNavigation().navigateInTab()` pushes into the active tab history by default, while pinned active tabs fall back to `openTab()`.
- `goBack()` and `goForward()` move within the tab-local history.

This lets Cradle migrate first while keeping existing tab definitions readable. The next migration step is to move `defineTab()` metadata into route-owned capability objects.
