# Architecture Boundary Cleanup

> Historical note (2026-05-16): this plan belongs to an earlier Electron IPC era. References to chat event bridges or renderer-side chat orchestration should be read as historical context, not as the current server-owned snapshot + SSE delta runtime contract.

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintained in accordance with `docs/exec-plans/README.md` and PLANS.md at repository root.

## Purpose / Big Picture

The codebase has accumulated a set of "boundary leaks": places where the separation between layout, feature logic, routing, and domain ownership has blurred. This plan addresses each identified issue from the architecture review dated 2026-04-21, except `styles.css` font issues (explicitly excluded by the user).

After this change:
- `AppLayout` will be a pure shell that knows nothing about specific features.
- Settings will be a real route (`/settings` or `/settings/$section`), not a shell state switch.
- `router.tsx` dead file will be removed.
- `workspace/new-chat-home.tsx` and ACP-related hooks will live in a better-named domain.
- `settings/acp-settings.tsx` will become its own feature directory.
- `ipc-devtool` will be reorganized to reflect its two sub-domains.
- `ChatEngine` will be decomposed (Phase 3 / long-term).
- `preload` will be narrowed (Phase 3 / long-term).
- ACP permission broker will be added (Phase 3 / long-term).

## Progress

- [x] (2026-04-21) Phase 1 – Structural cleanup (dead code, routing, AppLayout)
  - [x] (P1-1) Delete `src/renderer/src/router.tsx` (dead file)
  - [x] (P1-2) Extract `AppSidebar` and `useGlobalEventListeners` from `AppLayout`; `AppLayout` is now a pure slot-based shell
  - [x] (P1-3) Promote settings to real route `/settings` with `?section=` search param; `SettingsSidebar` and `SettingsContent` use router nav
  - [ ] (P1-4) Unified `useChatEvents` bridge — deferred; current multiple-subscriber pattern works and refactor risk is not worth it now
- [x] (2026-04-21) Phase 2 – Feature domain reorganization
  - [x] (P2-1) Move `new-chat-home.tsx` from `workspace/` to `new-chat/` feature directory
  - [x] (P2-2) Move ACP probe / session hooks (`use-acp-agents.ts`, `use-acp-session-state.ts`) to `agent-runtime/` directory
  - [x] (P2-3) Promote `settings/acp-settings.tsx` to `acp-management/acp-settings.tsx`
  - [x] (P2-4) Reorganize `ipc-devtool/` into `devtool/ipc/` and `devtool/acp/` sub-directories
- [ ] Phase 3 – Security / long-term (separate plan needed)

## Surprises & Discoveries

- `router.tsx` exports `getRouter()` but it is never imported in `main.tsx`. `main.tsx` creates its own inline router. `router.tsx` is entirely dead code — safe to delete.
- `AppLayout` imports `WorkspaceSidebar`, `SettingsSidebar`, `SettingsContent` directly, making it aware of two entirely different feature domains. The fix is to introduce a thin `MainWindowShell` that knows about this orchestration, leaving `AppLayout` as a grid/slot provider.
- Settings navigation state is stored in `src/renderer/src/store/sidebar-nav.ts` as a Zustand slice. The store keys are `view: 'main' | 'settings'` and `settingsSection: string`. Promoting settings to a route means we can replace this store entirely and use URL params instead.
- `chat:response-event` is subscribed in three places: `app-layout.tsx` line ~(unknown, needs check), `use-chat-session.ts`, and `ipc-chat-transport.ts`. A shared `useChatEvents` hook would expose `onResponseEvent(handler)` and unify cleanup.

## Decision Log

- 2026-04-21: User requested "change everything except styles.css". Phase 3 items (preload narrowing, ACP broker, ChatEngine decomposition) are included in the plan but may be deferred if the scope is too wide for one session.
- 2026-04-21: `router.tsx` will be deleted rather than merged into `main.tsx`, because `main.tsx` already has a complete, working inline router definition.
- 2026-04-21: `MainWindowShell` will wrap `AppLayout` — `AppLayout` retains its slot-based API (header, aside, panel, children) but loses all knowledge of specific features; the knowledge moves up into `MainWindowShell`.
- 2026-04-21: Settings route will be `/settings` with an optional `$section` search param (not path param) to avoid breaking existing deep-links from sidebar-nav.

## Outcomes & Retrospective

(To be filled after completion)

---

## Context and Orientation

The renderer lives in `src/renderer/src/`. Key files for Phase 1:

- `src/renderer/src/router.tsx` — dead file to delete
- `src/renderer/src/main.tsx` — entry, creates real router inline
- `src/renderer/src/components/layout/app-layout.tsx` — layout shell, currently over-loaded
- `src/renderer/src/store/sidebar-nav.ts` — stores `view` ('main'|'settings') and `settingsSection`
- `src/renderer/src/features/settings/` — settings feature (SettingsSidebar, SettingsContent, sections)
- `src/renderer/src/features/workspace/` — workspace feature (includes new-chat-home, ACP hooks)
- `src/renderer/src/features/chat/` — chat feature (ipc-chat-transport, use-chat-session)
- `src/renderer/src/routes/` — TanStack Router route files

TanStack Router uses file-based routes. New routes go in `src/renderer/src/routes/`. The route tree is auto-generated into `src/renderer/src/routeTree.gen.ts` by `@tanstack/router-vite-plugin`.

IPC pattern: services in `src/main/services/` extend `IpcService` and use `@IpcMethod` decorators. Types are exported from `src/main/ipc-types.ts` and consumed in renderer via `src/renderer/src/lib/ipc.ts`.

## Plan of Work

### Phase 1 — Structural cleanup

**P1-1: Delete `src/renderer/src/router.tsx`**

This file exports a `getRouter()` function that is never called. Simply delete the file and verify no import refers to it.

To verify: search for `from.*router` or `import.*router.tsx` in `src/renderer/src/` — there should be no remaining references.

**P1-2: Extract `MainWindowShell` from `AppLayout`**

Current state: `AppLayout` (in `src/renderer/src/components/layout/app-layout.tsx`) imports and renders `WorkspaceSidebar`, `SettingsSidebar`, `SettingsContent`, and reads from `useLayoutStore` and `useSidebarNav` to decide which sidebar to show. It also registers PTY notification listeners.

Target state:
- `AppLayout` becomes a pure slot-based grid: it accepts `header`, `aside`, `panel`, `children` props and produces the visual layout. It reads only `useLayoutStore` for dimensions/open state. It does NOT import any feature-specific components.
- A new component `MainWindowShell` in `src/renderer/src/components/layout/main-window-shell.tsx` orchestrates the full main window: sidebar selection, PTY notification listener, `AppLayout` composition. It renders `AppLayout` with the correct sidebar and content.
- The root route (or a wrapper component) renders `MainWindowShell` instead of `AppLayout` directly.

Steps:
1. Read the full `app-layout.tsx` to understand all feature imports and logic it currently handles.
2. Create `main-window-shell.tsx` that moves all feature-specific logic out of `AppLayout`.
3. Update `AppLayout` to remove feature imports — it becomes a pure layout shell.
4. Update whatever currently renders `AppLayout` at the root level to render `MainWindowShell` instead.
5. Update route files that render `AppLayout` directly with children — they continue to do so; `MainWindowShell` wraps the root layout, chat/settings routes nest inside the `children` slot.

Note: routes like `chat.$sessionId.tsx` call `<AppLayout header={...} panel={...}>` — they should continue to do so. `MainWindowShell` is only the outer orchestrator that is rendered by the root route.

**P1-3: Promote settings to a real route**

Current flow: `useSidebarNav` holds `view: 'main' | 'settings'` and `settingsSection: string`. Clicking "Settings" in the sidebar calls `setView('settings')`. No URL change occurs.

Target flow: Clicking "Settings" navigates to `/settings`. The active section is tracked either as a path param or search param. `SettingsContent` reads from route params rather than from a Zustand store.

Implementation steps:
1. Create `src/renderer/src/routes/settings.tsx` as the settings route. This route renders a layout that mirrors the current settings view (sidebar + content area), using `SettingsSidebar` and `SettingsContent` from the settings feature.
2. Optionally add `src/renderer/src/routes/settings.$section.tsx` or use a search param `?section=` — use a search param to keep URLs simple and avoid the need for nested route files.
3. Update the sidebar navigation so "Settings" calls `navigate({ to: '/settings', search: { section: 'general' } })` instead of `setView('settings')`.
4. Update `SettingsContent` to read the active section from `useSearch({ from: '/settings' })` rather than `useSidebarNav`.
5. Delete or simplify `sidebar-nav.ts` once the `view` state is no longer needed (the router handles view switching now).
6. Update `MainWindowShell` (or root route): when on a `/settings` route, render `SettingsSidebar` in the aside; when on other routes, render `WorkspaceSidebar`.

**P1-4: Unified `useChatEvents` bridge**

Create `src/renderer/src/features/chat/use-chat-events.ts`. This hook:
- Subscribes to `window.electron.ipcRenderer.on('chat:response-event', handler)` once
- Provides a stable callback via an event emitter pattern or a ref-based approach
- Returns an `onResponseEvent(handler)` function that callers use

Update `ipc-chat-transport.ts`, `use-chat-session.ts`, and any other subscriber to use `useChatEvents` instead of direct `ipcRenderer.on`. Note: `app-layout.tsx` may also handle `chat:session-title` — unify those too if applicable.

### Phase 2 — Feature domain reorganization

**P2-1: Move `new-chat-home.tsx` to `new-chat/` feature**

1. Create `src/renderer/src/features/new-chat/` directory with `index.ts` and `new-chat-home.tsx`.
2. Move `src/renderer/src/features/workspace/new-chat-home.tsx` to `src/renderer/src/features/new-chat/new-chat-home.tsx`.
3. Update the import in the `/` route file (likely `src/renderer/src/routes/index.tsx`) to point to the new location.
4. Update `src/renderer/src/features/workspace/index.ts` to remove the `NewChatHome` export.
5. Add a `README.md` and header comments per AGENTS.md requirements.

**P2-2: Move ACP probe / session hooks to `agent-runtime/`**

Hooks to move from `workspace/`:
- `use-acp-agents.ts` (installed ACP agents)
- `use-acp-session-state.ts` (ACP session config/model)

Steps:
1. Create `src/renderer/src/features/agent-runtime/` directory.
2. Move the above files and update all import paths.
3. `ModelPicker` (from `chat/model-picker.tsx`) may also belong here — evaluate if it depends only on `agent-runtime` data and move accordingly.
4. Update all files that import from `workspace/use-acp-*` to import from `agent-runtime/`.

**P2-3: Promote `acp-settings.tsx` to `acp-management/` feature**

1. Create `src/renderer/src/features/acp-management/` with subdirectories as needed.
2. Move `src/renderer/src/features/settings/acp-settings.tsx` to `src/renderer/src/features/acp-management/acp-settings.tsx`.
3. Update the settings feature barrel to import from new location.
4. Add README and header comments.

**P2-4: Reorganize `ipc-devtool/` into `devtool/`**

The current `ipc-devtool/` feature contains both IPC inspection (devtool for main-process IPC calls) and ACP inspection (devtool for ACP agent events). These are two distinct sub-domains.

1. Create `src/renderer/src/features/devtool/`.
2. Create sub-directories `devtool/ipc/` and `devtool/acp/`.
3. Move files accordingly, keeping `index.ts` barrel exports at the `devtool/` level.
4. Update the devtool route imports.
5. Add README reflecting the two sub-domains.

### Phase 3 — Security / long-term

These are important but large. Document the intent here; implementation may be a separate ExecPlan.

**P3-1: Narrow preload to whitelist bridge**
Currently `src/preload/index.ts` exposes `window.electron` which gives renderer direct access to `ipcRenderer`. The goal is to expose only explicitly named methods, removing the raw `ipcRenderer` reference. This requires auditing all `window.electron.ipcRenderer.*` calls in renderer and replacing them with named bridge methods.

**P3-2: ACP host capability broker**
`requestPermission` in `acp-connection.ts` currently returns the first option unconditionally. A proper broker would: surface a permission dialog to the user (via IPC to renderer), check against a workspace-root allowlist for file operations, and log decisions.

**P3-3: Decompose `ChatEngine`**
Split `src/main/lib/chat-engine.ts` into: `session-coordinator.ts` (recovery/resume logic), `turn-repository.ts` (DB persistence), `stream-bridge.ts` (IPC broadcast), and keep `chat-engine.ts` as a thin façade. This is a major refactor and warrants its own ExecPlan.

## Concrete Steps

### Milestone 1: Phase 1 — Structural cleanup

This milestone makes the structural changes that reduce cognitive overhead for everyone working in the renderer. At the end:
- `router.tsx` is gone
- `AppLayout` is a pure slot-based shell
- `MainWindowShell` handles the window orchestration
- Settings is a real navigable route
- `chat:response-event` has a single subscription point

Acceptance: the app still builds and functions identically to before for (a) home route, (b) chat route, (c) settings navigation, and (d) PTY notifications in sidebar.

### Milestone 2: Phase 2 — Domain reorganization

This milestone moves files to better-named directories. No behavior changes. At the end:
- `new-chat/` feature owns new-chat home
- `agent-runtime/` owns ACP probe/session hooks
- `acp-management/` owns ACP settings
- `devtool/` owns the two devtool sub-domains

Acceptance: all imports resolve, TypeScript reports no errors, and the app functions as before.

### Milestone 3: Phase 3 — Security / long-term (deferred)

Create a separate ExecPlan when ready to tackle preload narrowing, ACP broker, and ChatEngine decomposition.

## Validation and Acceptance

For each milestone, validate by:
1. Running `pnpm typecheck` (or equivalent `tsc --noEmit`) — zero new errors.
2. Running `pnpm lint` — zero new errors.
3. Manually opening the app in dev mode and verifying: home route loads, chat session works, settings opens at `/settings`, PTY sidebar badge works.

## Idempotence and Recovery

All changes are file moves and import updates. If a step fails partway:
- Deleted files should be restored from git.
- New files should be removed from git.
- Import paths should be rolled back.

Use `git diff --stat` to review scope of changes before considering a step complete.

## Artifacts and Notes

- Architecture review source: `docs/architecture-review-2026-04-21.md`
- Route tree is auto-generated; do not edit `src/renderer/src/routeTree.gen.ts` manually. The vite plugin regenerates it on save.
- AGENTS.md requires every new file to have a 3-line header comment and every directory to have a `README.md`.

## Interfaces and Dependencies

- `AppLayout` public API remains unchanged: `{ header?, aside?, panel?, children }` props.
- `MainWindowShell` API: no props (reads router state and store internally).
- Settings route: `/settings?section=<sectionId>` — `section` search param.
- `useChatEvents`: `() => { onResponseEvent: (handler: (event: ChatResponseEvent) => void) => () => void }`.
