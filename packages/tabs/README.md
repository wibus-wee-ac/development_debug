<!-- Once this directory changes, update this README.md -->

# @cradle/tabs

Activity-based tab management for React desktop apps. Uses React 19 `<Activity>` for tab lifecycle (frozen effects, preserved DOM), Zustand for state, and a registry pattern for tab types.

## Architecture

- `defineTab()` registers tab types with type-safe params
- `createTabStore(registry)` creates a versioned persisted Zustand store with safe storage fallback outside the browser
- `<TabsProvider>` provides store + registry via context
- `<TabBar>` renders capsule-shaped tab pills
- `<TabRenderer>` wraps each tab in `<Activity mode="visible"|"hidden">`
- `useTabNavigation()` provides `navigateTo`, `openInNewTab`, `navigateInTab`
- `createUrlSync()` bidirectional hash URL sync (dormant during Router migration)

## Files

- **src/index.ts**: Barrel export — public API entry point
- **src/define-tab.ts**: `defineTab()` type helper and `TabDefinition` interface
- **src/store.ts**: `createTabStore()` Zustand store factory with versioned persistence and safe storage fallback
- **src/context.ts**: `TabsContext` and `useTabsContext()` for component access
- **src/provider.tsx**: `<TabsProvider>` component wrapping context
- **src/url-sync.ts**: `createUrlSync()` hash URL ↔ tab descriptor sync
- **src/components/tab-bar.tsx**: `<TabBar>` capsule-shaped tab pill component，包含更稳健的 tear-off 坐标采集逻辑，避免普通点击被误判成拖出窗口
- **src/components/tab-renderer.tsx**: `<TabRenderer>` Activity-based content renderer
- **src/hooks/use-tab-navigation.ts**: `useTabNavigation()` programmatic navigation hook
- **src/\_\_tests\_\_/store.test.ts**: Unit tests for store and defineTab
- **src/\_\_tests\_\_/tab-bar.test.ts**: TabBar tear-off helper regression tests，防止缺失 pointer 坐标时误触发拆分窗口
