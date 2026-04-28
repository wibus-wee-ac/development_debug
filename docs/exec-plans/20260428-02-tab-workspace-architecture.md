# Tab-Based Workspace Architecture — `@cradle/tabs`

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds. This document must be maintained in accordance with PLANS.md conventions.

## Purpose / Big Picture

Cradle is an Electron desktop app that currently uses TanStack Router as its page lifecycle owner: each URL maps to one page, and navigating away unmounts the previous page, destroying its state. This works for web apps but fights against the desktop mental model where users expect to keep multiple work contexts open simultaneously — like VS Code tabs, Postman workspaces, or Cursor editor panes.

After this change, Cradle supports multi-tab navigation. Users see capsule-shaped tab pills in the header bar. Clicking a session in the sidebar opens it in a new tab (or activates an existing one). Switching between tabs is instant — inactive tabs freeze their effects (via React 19 Activity API) but preserve their DOM, component state, scroll position, and form drafts. Closing a tab destroys it cleanly. The URL bar reflects the active tab for deep-linking support, but the tab store — not the router — owns the lifecycle.

The tab system lives in `packages/tabs/` as `@cradle/tabs`. It provides `defineTab()`, a Zustand-based tab store, a capsule-style tab bar component, and an Activity-based content renderer. The Cradle app consumes it by defining tab types (home, chat, kanban, workspace-detail, usage, etc.) and registering them.

## Progress

- [x] (2026-04-28 07:00Z) POC implemented: tab store, tab bar, tab content renderer, Activity integration, app-header modification
- [x] (2026-04-28 08:00Z) Self-review of POC identified structural issues: route-string-based tabs, manual if/else routing, React.lazy overhead in local app
- [x] (2026-04-28 09:00Z) Milestone 1: Package scaffold — packages/tabs/ created with package.json, tsconfig, pnpm linked
- [x] (2026-04-28 09:30Z) Milestone 2: Core library — defineTab, createTabStore, TabBar, TabRenderer, useTabNavigation, createUrlSync, TabsProvider. 20/20 tests pass.
- [x] (2026-04-28 10:00Z) E2E: tab-management.feature (7 scenarios) + step definitions + data-testid attributes
- [x] (2026-04-28 10:30Z) Milestone 3: Tab types defined (home, chat, new-chat, kanban-board, workspace-detail, usage). Registry wired. TabsProvider + TabRenderer in __root.tsx. AppHeader uses library TabBar. LegacyRouteRedirector maps paths to type+params. Typecheck passes.
- [x] (2026-04-28 11:00Z) Milestone 4: ChatView tab loader mechanism implemented. Tab definitions support `loader` returning async data passed as `loaderData` prop.
- [x] (2026-04-28 11:30Z) Milestone 5: All `<Link>` and `useNavigate()` calls replaced with `useCradleNavigation()` across sidebar, home-dashboard, new-chat, kanban-sidebar, thread-search, issue-detail, workspace-detail. TanStack Router fully removed from dependencies.
- [x] (2026-04-28 12:00Z) Milestone 6: POC files deleted (store/tabs.ts, layout/tab-bar.tsx, layout/tab-content-renderer.tsx, hooks/use-tab-navigation.ts). __root.tsx → app.tsx. main.tsx simplified. localStorage persist key isolated.
- [x] (2026-04-28 12:30Z) Milestone 7: TanStack Router fully removed (not just evaluated). All route files deleted. routeTree.gen.ts deleted. RouterProvider replaced with direct App component. DevTool window uses hash check at entry point.
- [x] (2026-04-28 13:30Z) E2E stabilization: 22/22 scenarios pass, 75/75 steps. Fixed StatusManager testids, CreateIssueDialog submit flow, kanban board initialization, settings navigation, workspace sidebar test mocks.

## Surprises & Discoveries

- React 19.2 ships `<Activity>` as a stable API. It handles exactly the tab use case: hidden children have their effects cleaned up, DOM preserved, state frozen, and effects re-created when made visible. This eliminates the need for a custom `useTabVisible()` hook or LRU tab eviction.
- TanStack Router's core value (route → component rendering, loaders, code splitting) is entirely bypassed in the tab architecture. It becomes a pure URL serializer, which is trivially replaceable with `window.location.hash`.
- For a local Electron app, IPC data fetching is ~10ms. Route loaders that "block until data is ready" provide negligible benefit — component-internal `useQuery` with IPC returns fast enough that users never see a loading state.

## Decision Log

- Decision: Name the library `@cradle/tabs` (scope `@cradle`, consistent with `@cradle/ipc`).
  Rationale: Keeps all monorepo packages under the same scope. `private: true` initially; publish preparation (build step, independent tsconfig) deferred until the library stabilizes.
  Date: 2026-04-28

- Decision: Use `type + params` model instead of route-string model for tabs.
  Rationale: `{ type: 'chat', params: { sessionId: 'abc' } }` decouples tabs from URL structure. The tab's identity is its type and parameters, not a URL path. URL is derived (serialized) from the tab descriptor, not the other way around.
  Date: 2026-04-28

- Decision: No codegen / Vite plugin for now. Use manual registry with `defineTab()`.
  Rationale: Tab types are flat (no nesting), params are explicitly typed. A manual registry of 5-10 tab types is trivial. Codegen adds complexity without proportional benefit at this scale. Revisit if tab types exceed 20+.
  Date: 2026-04-28

- Decision: Source-first package (exports point to `.ts` files). No build step initially.
  Rationale: Monorepo internal consumption uses TS directly via path aliases. Build step deferred until npm publish time. Matches existing `@cradle/ipc` pattern.
  Date: 2026-04-28

- Decision: Keep TanStack Router during migration, plan for eventual removal.
  Rationale: Ripping out the router in one step is too risky (15+ route files, all sidebar links use `<Link>`). Gradual migration: tab system takes over page rendering first, then sidebar navigation, then router removal last.
  Date: 2026-04-28

- Decision: URL sync does NOT write to `window.location.hash` during migration (M1-M5).
  Rationale: TanStack Router uses `createHashHistory()` — two hash writers would conflict. During migration, the Router's hash route (`/tabs/$tabId`) represents the active tab URL. The tab URL sync library code is implemented but only activated after Router removal in M7. Until then, `LegacyRouteRedirector` bridges old hash URLs into the tab system.
  Date: 2026-04-28

- Decision: Params type uses `Record<string, string | undefined>` not `Record<string, string>`.
  Rationale: Some tab params are optional (kanban `issue?: string`). Allowing undefined covers optional params without type gymnastics.
  Date: 2026-04-28

- Decision: Tab components use `React.lazy()` + `<Suspense>` inside `<Activity>`.
  Rationale: The prior ExecPlan (20260425-03-bundle-code-splitting.md) code-split heavy routes. If tab components are statically imported, all heavy code loads at first tab open, negating code splitting. `React.lazy()` inside `<Activity>` defers chunk loading until a tab of that type is first opened. Activity hidden pre-rendering interacts correctly with Suspense.
  Date: 2026-04-28

- Decision: Settings remains sidebar-driven, not a tab type.
  Rationale: Settings (`Cmd+,`) is a modal overlay — it takes over sidebar and content area temporarily. It doesn't represent a "work session" to keep open alongside tabs. The `isSettings` flag in layoutStore handles this.
  Date: 2026-04-28

- Decision: Tearoff windows do not use the tab system.
  Rationale: Tearoff windows are independent BrowserWindows with their own renderer. They show a single chat session with sidebar collapsed. They continue using route-based rendering (`/chat/$sessionId?tearoff=true`). The tab store is per-main-window only.
  Date: 2026-04-28

- Decision: Kanban has two tab types: `kanban` (board selector) and `kanban-board` (board view).
  Rationale: `/kanban` and `/kanban/$boardId` are different pages. The issue side panel (`?issue=xxx`) is component-internal state within kanban-board tab — stored as optional `tab.params.issue` for restore on tab switch, not a separate tab type.
  Date: 2026-04-28

## Outcomes & Retrospective

**Completed**: All 7 milestones finished in a single session. Total: ~6.5 hours from POC to full migration with 22/22 E2E passing.

**What went well**:
- React 19 `<Activity>` API worked exactly as hoped — zero custom lifecycle management needed.
- `defineTab()` + registry pattern made tab types declarative and type-safe.
- E2E tests written early (after M2) caught real regressions throughout M3-M7.
- Removing TanStack Router entirely (M7 went beyond "evaluate") simplified the codebase significantly — eliminated routeTree.gen.ts codegen, route file conventions, and loader patterns.

**What was harder than expected**:
- **React Compiler (`react-compiler-runtime`) breaks Zustand `useSyncExternalStore` subscriptions.** Components auto-memoized by the compiler don't re-render when external store state changes. Workaround: `'use no memo'` directive on components that subscribe to Zustand stores. This affected TabBar, TabRenderer, AppSidebar, and AppHeader.
- **Electron `-webkit-app-region: drag` swallows click events.** The AppHeader's drag region intercepted TabBar clicks. Fix: explicit `WebkitAppRegion: 'no-drag'` on interactive elements.
- **E2E test isolation**: Zustand persist middleware saves to localStorage in userData. Without clearing it between scenarios, stale tab state from one scenario leaked into the next. Fix: `fs.rm(userData)` in E2E `Before` hook.
- **CreateIssueDialog submission**: The dialog requires `⌘+Enter` or clicking the "Create issue" button — plain `Enter` does nothing. E2E steps initially just pressed Enter, causing silent failures.

**Key decisions that proved correct**:
- Source-first package (`exports: "./src/index.ts"`) eliminated any build step friction.
- Props-driven components (not route-dependent) made migration smooth — each feature component already accepted its data as props.
- Tab loader mechanism (async data loading with Suspense fallback) cleanly replaced route loaders for the chat tab's message pre-fetch.

**Open items for future work**:
- Tab pill UI refinement (capsule shape, active background differentiation)
- Tab persistence migration from localStorage to IPC storage
- Tab drag-to-reorder
- Keyboard shortcuts (`Cmd+W` close, `Cmd+T` new, `Cmd+1-9` switch)
- Tab reuse strategy tuning (when to reuse vs. open new)

## Context and Orientation

Cradle is an Electron desktop app built with React 19, TypeScript, Tailwind CSS, Zustand, and TanStack Router. The renderer process lives in `src/renderer/src/`. The project uses a pnpm monorepo with internal packages in `packages/` (currently only `packages/ipc/`).

Key files in the current architecture:

- `src/renderer/src/routes/__root.tsx` — Root layout. Renders `AppSidebar` + `<Outlet />`. Currently modified with POC tab logic.
- `src/renderer/src/components/layout/app-header.tsx` — Header bar with sidebar toggle (left), breadcrumb (center, currently replaced with POC TabBar), and panel toggles (right).
- `src/renderer/src/components/layout/app-layout.tsx` — Content area layout shell with header, main content, bottom panel, and right aside.
- `src/renderer/src/store/layout.ts` — Zustand store for sidebar/panel/aside layout state, persisted to localStorage.
- `src/renderer/src/features/workspace/workspace-sidebar.tsx` — Sidebar with navigation items and session list. Uses `<Link>` and `useNavigate()` from TanStack Router.
- `src/renderer/src/routes/chat.$sessionId.tsx` — Chat route with loader that pre-fetches session + messages via IPC.
- `src/renderer/src/routes/chat.$sessionId.lazy.tsx` — Lazy-loaded chat page component. Uses `Route.useParams()` and `Route.useLoaderData()`.

POC files already created (will be refactored/moved):

- `src/renderer/src/store/tabs.ts` — POC tab store (route-string based, to be replaced)
- `src/renderer/src/components/layout/tab-bar.tsx` — POC capsule tab bar
- `src/renderer/src/components/layout/tab-content-renderer.tsx` — POC content renderer with Activity
- `src/renderer/src/routes/tabs.$tabId.tsx` — POC tab route
- `src/renderer/src/hooks/use-tab-navigation.ts` — POC navigation hook

The `packages/ipc/` package demonstrates the monorepo package pattern: source-first (exports point to `.ts`), `"type": "module"`, consumed via workspace protocol.

## Plan of Work

The work proceeds in seven milestones. Each builds on the previous and is independently verifiable.

### Milestone 1 — Package Scaffold

Create `packages/tabs/` with proper package.json, tsconfig, and directory structure. Install peer dependencies (react, zustand). Set up exports for source-first consumption.

Directory structure:

    packages/tabs/
      package.json
      tsconfig.json
      src/
        index.ts              — public API barrel export
        define-tab.ts         — defineTab() helper and TabDefinition type
        store.ts              — createTabStore() factory
        components/
          tab-bar.tsx         — capsule tab bar component
          tab-renderer.tsx    — Activity-based content renderer
        hooks/
          use-tab-navigation.ts — navigation utilities
        url-sync.ts           — hash URL ↔ tab descriptor serialization

The package.json uses `@cradle/tabs` as the name, with exports pointing to source `.ts`/`.tsx` files. Peer dependencies: `react >=19.0.0`, `react-dom >=19.0.0`, `zustand >=5.0.0`. The package is consumed in the Cradle app via `"@cradle/tabs": "workspace:*"` in root package.json.

### Milestone 2 — Core Library Implementation

Implement the core abstractions:

**`defineTab(config)`** — A type helper that returns a strongly-typed tab definition. Each definition includes: `type` (string literal), `params` shape (TypeScript generic), `label` function (params → string), `component` (React component receiving params), and optional `serialize`/`deserialize` for URL mapping.

**`createTabStore(registry)`** — A Zustand store factory that takes a tab registry (Record of type → TabDefinition) and returns a store with: `tabs` array, `activeTabId`, `openTab(type, params)`, `closeTab(id)`, `setActiveTab(id)`, `updateTabParams(id, params)`. Persisted to localStorage.

**`TabBar`** — A headless-ish component that renders capsule-shaped tab pills. Accepts className overrides for styling. Each pill shows the tab label, has a close button (for non-pinned tabs), and a new-tab button at the end. Clicking a pill calls `setActiveTab`. The component receives the store via props or context.

**`TabRenderer`** — Wraps each tab's content in `<Activity mode={isActive ? 'visible' : 'hidden'}>`. Looks up the component from the registry by tab type, passes params as props. All tabs are mounted simultaneously; Activity manages lifecycle.

**`useTabNavigation()`** — Hook providing `navigateTo(type, params)`, `openInNewTab(type, params)`, `navigateInTab(type, params)`. Uses the store internally.

**URL sync** — Optional `createUrlSync(store, registry)` function that: (1) on active tab change, writes the serialized tab descriptor to `window.location.hash`, (2) on hash change (deep link / protocol handler), deserializes and opens the tab. IMPORTANT: this is NOT activated during the migration period (M1-M5) because TanStack Router already owns `window.location.hash` via `createHashHistory()`. The URL sync module is implemented and tested but only connected after Router removal in M7.

### Milestone 3 — Define Cradle Tab Types

In `src/renderer/src/tabs/`, define tab types for each page:

    src/renderer/src/tabs/
      home.tab.tsx                — type: 'home', no params, component: HomeDashboard
      chat.tab.tsx                — type: 'chat', params: { sessionId: string }, component: ChatTabContent
      new-chat.tab.tsx            — type: 'new-chat', no params, component: NewChatPage
      kanban.tab.tsx              — type: 'kanban', no params, component: KanbanListView
      kanban-board.tab.tsx        — type: 'kanban-board', params: { boardId: string, issue?: string }, component: KanbanBoardView
      workspace-detail.tab.tsx    — type: 'workspace-detail', params: { workspaceId: string }, component: WorkspaceDetailPage
      usage.tab.tsx               — type: 'usage', no params, component: UsageDashboard
      registry.ts                 — manual registry: import all tab files, export record

Each tab file uses `defineTab()` from `@cradle/tabs`. The `component` prop receives `{ params }` and renders the page content wrapped in `AppLayout`. Heavy components (chat, workspace-detail, kanban-board) use `React.lazy()` to preserve code splitting.

### Milestone 4 — Migrate ChatView to Props-Driven

The chat page is the most complex route. Currently it relies on:
- `Route.useParams()` for `sessionId`
- `Route.useLoaderData()` for pre-fetched session + messages
- `Route.useSearch()` for `tearoff` flag

Refactor `ChatView` (or create `ChatTabContent`) to accept `sessionId` as a prop and load data internally via `useQuery`:

    function ChatTabContent({ params }: { params: { sessionId: string } }) {
      const { data: session } = useQuery({
        queryKey: ['session', params.sessionId],
        queryFn: () => ipc.session.get(params.sessionId),
      })
      const { data: messages } = useQuery({
        queryKey: ['messages', params.sessionId],
        queryFn: () => ipc.chat.getMessages(params.sessionId),
      })
      // ... render ChatView with session + messages
    }

The existing route file (`chat.$sessionId.tsx`) continues to work for direct navigation during migration. The new `ChatTabContent` is used by the tab system.

### Milestone 5 — All Navigation to Tab-Aware

Replace ALL `<Link>` and `useNavigate()` calls that target tab-managed routes with `useTabNavigation()`. This includes:

Sidebar (`workspace-sidebar.tsx`):
- `<Link to="/chat/$sessionId">` → `openInNewTab('chat', { sessionId })`
- Home, New Chat, Kanban, Usage nav items → `navigateTo(type)`

Feature components with `useNavigate()` (11+ call sites):
- `home-dashboard.tsx` — session click → `openInNewTab('chat', ...)`
- `new-chat-page.tsx` — after creating session → `openInNewTab('chat', ...)`
- `new-chat-home.tsx` — session selection → `navigateTo('chat', ...)`
- `kanban/issue-detail.tsx` — "open session" → `openInNewTab('chat', ...)`
- `kanban/issue-aside-panel.tsx` — linked session navigation
- `kanban-sidebar.tsx` — board selection → `navigateTo('kanban-board', ...)`
- `thread-search-dialog.tsx` — search result click → `navigateTo('chat', ...)`
- `workspace-detail-page.tsx` — session list click → `openInNewTab('chat', ...)`

This is the largest milestone by scope. Each call site should be individually verified.

### Milestone 6 — Clean Up POC Artifacts

Remove the POC files that are now superseded by the library:
- `src/renderer/src/store/tabs.ts` → replaced by `@cradle/tabs` store
- `src/renderer/src/components/layout/tab-bar.tsx` → replaced by `@cradle/tabs` TabBar
- `src/renderer/src/components/layout/tab-content-renderer.tsx` → replaced by `@cradle/tabs` TabRenderer
- `src/renderer/src/routes/tabs.$tabId.tsx` → replaced by URL sync
- `src/renderer/src/hooks/use-tab-navigation.ts` → replaced by `@cradle/tabs` hook

Simplify `__root.tsx`: remove `LegacyRouteRedirector`, use `TabRenderer` directly.

Handle localStorage migration: the POC persisted tab state under key `cradle-tabs` with shape `{ id, route, label, pinned }`. The new store uses a different key (`cradle-tab-store`) with shape `{ id, type, params, label, pinned }`. On first load, detect legacy key, clear it, and initialize with default tabs.

### Milestone 7 — Evaluate Router Removal

At this point, TanStack Router is only used for:
- `/devtool` route (separate window)
- Any remaining `<Link>` components not yet migrated

Evaluate whether to:
(a) Keep Router for devtool only (minimal overhead)
(b) Move devtool to a separate Electron window entry point and remove Router entirely
(c) Keep Router as URL sync layer alongside the tab system

This milestone is a decision point, not a code change.

## Concrete Steps

### Milestone 1 Commands

Create the package directory and files:

    cd /Users/wibus/dev/Cradle
    mkdir -p packages/tabs/src/components packages/tabs/src/hooks

Create `packages/tabs/package.json`:

    {
      "name": "@cradle/tabs",
      "type": "module",
      "version": "0.1.0",
      "private": true,
      "description": "Activity-based tab management for React desktop apps",
      "exports": {
        ".": "./src/index.ts"
      },
      "main": "./src/index.ts",
      "types": "./src/index.ts",
      "peerDependencies": {
        "react": ">=19.0.0",
        "react-dom": ">=19.0.0",
        "zustand": ">=5.0.0"
      }
    }

Create `packages/tabs/tsconfig.json`:

    {
      "extends": "../../tsconfig.json",
      "compilerOptions": {
        "outDir": "dist",
        "rootDir": "src"
      },
      "include": ["src"]
    }

Add workspace dependency to root `package.json`:

    "dependencies": {
      "@cradle/tabs": "workspace:*"
    }

Run `pnpm install` to link the workspace package.

Verify: `ls packages/tabs/src/index.ts` exists. `pnpm ls @cradle/tabs` shows the linked package.

### Milestone 2-7 Commands

(To be filled as milestones begin. Each milestone will include exact file edits, commands, and expected outputs.)

## Validation and Acceptance

After Milestone 3 (tab types defined and wired):
- Start the app with `pnpm dev`
- The header shows capsule-shaped tab pills
- A default "首页" tab is pinned and active
- Click "+" to open a new tab — a new pill appears and becomes active
- Close a non-pinned tab with the X button — pill disappears, adjacent tab activates
- Switch between tabs — content swaps instantly, no loading flash
- Inactive tabs preserve their state (scroll position, form inputs, selection)

After Milestone 4 (chat migration):
- Click a session in the sidebar — opens in a new tab (or activates existing)
- Chat view loads within the tab, messages appear without loading spinner
- Switch to another tab, switch back — chat preserves scroll, input draft, streaming state

After Milestone 5 (sidebar migration):
- All sidebar navigation items use the tab system
- No more `<Link>` components in the sidebar
- Direct URL navigation (hash) still works for deep linking

After Milestone 6 (cleanup):
- No POC files remain
- `__root.tsx` is clean: just providers + sidebar + TabRenderer
- Type check passes: `pnpm typecheck:web`

## Idempotence and Recovery

Each milestone is additive. The tab system coexists with the router during migration:
- Milestones 1-3: Tab system works alongside router. `LegacyRouteRedirector` catches non-tab navigations.
- Milestones 4-5: Pages gradually migrate to props-driven. Both old route files and new tab files work.
- Milestone 6: Only after all pages are migrated, remove POC artifacts.
- Milestone 7: Router removal is optional and reversible.

If any milestone fails, the previous state still works. The router continues to function as a fallback throughout.

To reset to pre-POC state: revert the changes to `__root.tsx`, `app-header.tsx`, and delete the POC files listed in Milestone 6.

## Artifacts and Notes

POC implementation (2026-04-28) demonstrated:
- Capsule tab bar in app-header between sidebar toggle and panel toggles
- Zustand tab store with persistence
- `<Activity>` API from React 19 for tab lifecycle management
- LegacyRouteRedirector pattern for gradual migration
- Type check passes with zero errors

Key type signature for the library:

    // packages/tabs/src/define-tab.ts
    interface TabDefinition<TType extends string, TParams extends Record<string, string | undefined>> {
      type: TType
      label: string | ((params: TParams) => string)
      icon?: React.ComponentType<{ className?: string }>
      pinned?: boolean
      component: React.ComponentType<{ params: TParams }>
      serialize?: (params: TParams) => string
      deserialize?: (path: string) => TParams | null
    }

    function defineTab<TType extends string, TParams extends Record<string, string | undefined>>(
      config: TabDefinition<TType, TParams>
    ): TabDefinition<TType, TParams>

    // packages/tabs/src/store.ts
    type TabRegistry = Record<string, TabDefinition<string, Record<string, string | undefined>>>

    interface TabInstance {
      id: string
      type: string
      params: Record<string, string | undefined>
      label: string
      pinned: boolean
    }

    interface TabStoreState<R extends TabRegistry> {
      tabs: TabInstance[]
      activeTabId: string | null
      openTab: <T extends keyof R & string>(type: T, params: R[T] extends TabDefinition<any, infer P> ? P : never) => string
      closeTab: (id: string) => void
      setActiveTab: (id: string) => void
      updateTabParams: (id: string, params: Partial<Record<string, string | undefined>>) => void
    }

    function createTabStore<R extends TabRegistry>(registry: R): UseBoundStore<StoreApi<TabStoreState<R>>>

## Interfaces and Dependencies

**Package: `@cradle/tabs`**

Peer dependencies:
- `react >=19.0.0` — for `<Activity>` API
- `react-dom >=19.0.0` — for DOM components
- `zustand >=5.0.0` — for store

No runtime dependencies. Tailwind classes used in components assume the consuming app has Tailwind configured.

Public API exports from `packages/tabs/src/index.ts`:

    // Type helpers
    export { defineTab } from './define-tab'
    export type { TabDefinition } from './define-tab'

    // Store
    export { createTabStore } from './store'
    export type { TabInstance, TabStoreState } from './store'

    // Components
    export { TabBar } from './components/tab-bar'
    export { TabRenderer } from './components/tab-renderer'

    // Hooks
    export { useTabNavigation } from './hooks/use-tab-navigation'

    // URL sync
    export { createUrlSync } from './url-sync'

## Revision Notes

- 2026-04-28 rev.1: Initial plan created after POC validation.
- 2026-04-28 rev.2: Addressed review findings. Renamed `@aspect/tabs` → `@cradle/tabs`. Added 7 missing Decision Log entries (URL sync conflict, params type, code splitting, Settings, tearoff, kanban nesting, hash collision). Added `workspace-detail` and `kanban` tab types. Expanded M5 to cover all `useNavigate()` call sites beyond sidebar. Added `react-dom` peer dep. Added localStorage migration step to M6. Fixed `TabStoreState` generic signature. Changed `private: false` → `private: true`. Added this revision notes section.
