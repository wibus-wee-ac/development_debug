<!-- Once this directory changes, update this README.md -->

# @cradle/tabs

Activity-based tab management for React desktop apps. Uses React 19 `<Activity>` for tab lifecycle (frozen effects, preserved DOM), Zustand for state, and a registry pattern for tab types.

## Architecture

- `defineTab()` registers tab types with type-safe params
- `createTabStore(registry)` creates a persisted Zustand store
- `<TabsProvider>` provides store + registry via context
- `<TabBar>` renders capsule-shaped tab pills
- `<TabRenderer>` wraps each tab in `<Activity mode="visible"|"hidden">`
- `useTabNavigation()` provides `navigateTo`, `openInNewTab`, `navigateInTab`
- `createUrlSync()` bidirectional hash URL sync (dormant during Router migration)

## Files

- **src/index.ts**: Barrel export — public API entry point
- **src/define-tab.ts**: `defineTab()` type helper and `TabDefinition` interface
- **src/store.ts**: `createTabStore()` Zustand store factory with persistence
- **src/context.ts**: `TabsContext` and `useTabsContext()` for component access
- **src/provider.tsx**: `<TabsProvider>` component wrapping context
- **src/url-sync.ts**: `createUrlSync()` hash URL ↔ tab descriptor sync
- **src/components/tab-bar.tsx**: `<TabBar>` capsule-shaped tab pill component
- **src/components/tab-renderer.tsx**: `<TabRenderer>` Activity-based content renderer
- **src/hooks/use-tab-navigation.ts**: `useTabNavigation()` programmatic navigation hook
- **src/\_\_tests\_\_/store.test.ts**: Unit tests for store and defineTab
