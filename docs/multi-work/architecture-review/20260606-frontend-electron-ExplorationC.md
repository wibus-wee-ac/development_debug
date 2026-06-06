# Frontend/Electron Architecture Review - Exploration C

Date: 2026-06-06
Role: Architecture Review Agent C - frontend/Electron architecture
Scope: desktop app/frontend architecture only

## Scope Inspected

- Repository instructions: `AGENTS.md`.
- Desktop app shell: `apps/desktop/package.json`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/src/main/README.md`, `apps/desktop/src/preload/README.md`, `apps/desktop/src/main/main-app.ts`, `apps/desktop/src/main/window-manager.ts`, `apps/desktop/src/main/native-services.ts`, `apps/desktop/src/main/browser-ipc.ts`, `apps/desktop/src/main/browser-manager.ts`, `apps/desktop/src/main/plugin-loader.ts`, `apps/desktop/src/main/plugin-discovery.ts`, `apps/desktop/src/preload/index.ts`.
- Renderer app: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/src/main.tsx`, `apps/web/src/app.tsx`, `apps/web/src/app-providers.tsx`, `apps/web/src/lib/electron.ts`, `apps/web/src/env.d.ts`, `apps/web/src/styles.css`.
- Renderer organization and state: `apps/web/src/components/**`, `apps/web/src/features/**/README.md`, `apps/web/src/store/README.md`, `apps/web/src/tabs/**`.
- Shared packages: `packages/ipc/src/*`, `packages/tabs-next/src/*`, `packages/tabs-next/README.md`, `packages/design-system/src/tokens.css`, `packages/design-system/README.md`.
- Relevant architecture docs: `docs/exec-plans/20260428-02-tab-workspace-architecture.md`, `docs/codebase-audit-2026-05-30.md`, `docs/exec-plans/20260518-05-frontend-architecture-review.md`.

Browser tests were not run.

## Architecture Summary

The current desktop app is an Electron shell that builds its renderer from `apps/web`; `apps/desktop/electron.vite.config.ts` points the renderer root at `../web` and builds main/preload separately. Electron main owns native lifecycle: server process, windows, desktop update flow, native BrowserPanel `WebContentsView`, tray, app badge, chat stream broker, Mac bridge, and plugin activation. The main/preload README files are unusually explicit about ownership and mostly follow the repository namespace principle.

The renderer is no longer TanStack Router based. `apps/web/package.json` has TanStack Query and Table, but not `@tanstack/react-router`; navigation is owned by `@cradle/tabs-next` plus hash URL sync. `apps/web/src/app.tsx` installs `TabsProvider`, `TabRenderer`, and `createUrlSync`, and `apps/web/src/tabs/registry.ts` defines the app route/tab registry.

Data access is mostly layered through generated OpenAPI clients and TanStack Query under `apps/web/src/api-gen`. Feature code also has explicit command modules for stream/SSE and plugin routes where generated query helpers are a poor fit, especially chat streaming. Zustand stores are used for renderer UI/runtime state, with README docs separating layout, browser-panel, chat, theme, session layout, and settings overlay ownership.

Component organization mostly follows `AGENTS.md`: `components/ui` contains low-business design-system primitives, `components/common` has app-specific shared UI, `components/layout` owns the shell, and business features live under `features/{domain}`. The main architectural exceptions are documentation drift and a few shared modules that have become domain-bearing enough to deserve explicit ownership notes.

## Findings

### High - Web plugins can reach the generic Electron IPC escape hatch

`apps/desktop/src/preload/index.ts:31-40` exposes `window.cradle.ipc.invoke(channel, ...args)` and `window.cradle.ipc.on(channel, handler)` as arbitrary channel-string APIs. `apps/web/src/env.d.ts:19-23` makes that broad surface part of the renderer global type. `apps/web/src/main.tsx:58-63` loads web plugins after app startup, and `apps/web/src/lib/plugin-host.ts:269-283` dynamically imports plugin web bundles into the same renderer global. Because those plugins execute in the same window, any active web plugin can call `window.cradle.ipc.invoke(...)` directly instead of going through the bounded `WebPluginContext` returned by `createWebPluginContext`.

This undercuts the otherwise strong Electron boundary. The BrowserWindow settings are good (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in `apps/desktop/src/main/main-app.ts:93-99`, `apps/desktop/src/main/window-manager.ts:75-80`, and `apps/desktop/src/main/window-manager.ts:213-218`), but the preload API still grants a broad main-process command plane to all renderer code. The issue is more significant because the plugin loader explicitly treats external local and Marketplace plugin directories as trusted sources without sandbox isolation (`apps/desktop/src/main/plugin-loader.ts:262-278`), while the web plugin context itself only exposes scoped routes, notifications, subscriptions, panels, and commands (`apps/web/src/lib/plugin-host.ts:150-180` and surrounding code).

Recommendation: remove the generic `window.cradle.ipc` surface from plugin-reachable renderer global code, or gate it behind an app-internal capability that web plugin bundles cannot access. Keep typed preload facades for app code (`window.cradle.window`, `desktopUpdate`, `desktopTray`, `browser`, `chatStream`, etc.) and add explicit plugin-host mediated capabilities for plugin needs. If generic IPC is still needed for the IPC devtool or typed proxy implementation, hide it behind a closure/module-local adapter rather than exposing it on `window`.

### Medium - TanStack Router stack documentation is stale and conflicts with actual routing ownership

`AGENTS.md` lists TanStack Router in the stack, and newer docs still describe `apps/web` as using TanStack Router (`docs/codebase-audit-2026-05-30.md:30-32`, `docs/exec-plans/20260518-05-frontend-architecture-review.md:55-58`). The code says otherwise: `apps/web/package.json` has no `@tanstack/react-router`, `apps/web/src/app.tsx:1-16` imports `@cradle/tabs-next`, and `apps/web/src/tabs/registry.ts:17-28` is the central route registry. The migration plan explicitly states TanStack Router was fully removed (`docs/exec-plans/20260428-02-tab-workspace-architecture.md:22-24`).

This is not a runtime bug, but it is architectural drift: new contributors will look for route files, loaders, and `RouterProvider` patterns that no longer exist. It also affects the user goal directly because the requested architecture stack includes TanStack Router even though the implementation uses a custom desktop tab runtime.

Recommendation: update `AGENTS.md`, `docs/codebase-audit-2026-05-30.md`, and the frontend architecture review plan language to name `@cradle/tabs-next` as the navigation owner. If TanStack Router is intentionally retired, remove it from current stack docs rather than describing it as an active dependency.

### Medium - Design-system package exists, but `apps/web` owns a divergent in-app token implementation

`packages/design-system/README.md` says consumers should import `@cradle/design-system/tokens.css`, and `packages/design-system/src/tokens.css:1-38` defines the package token source. `apps/web/src/styles.css` does not import that package. Instead, it defines a separate large `@theme inline` block and root/dark token set in `apps/web/src/styles.css:74-390`. The renderer also imports `shadcn/tailwind.css` directly (`apps/web/src/styles.css:1-3`) and maps many semantic tokens locally.

This may be intentional if the web app is the product-specific implementation of the design system, but the current package boundary says otherwise. The result is unclear ownership: design tokens can evolve in `packages/design-system`, while the actual app appearance evolves in `apps/web/src/styles.css`. That weakens `AGENTS.md` rule 0 ("Follow Design System Conventions") because the app is not consuming the design-system package as the source of truth.

Recommendation: choose one owner. Prefer importing `@cradle/design-system/tokens.css` into the app and layering only app-specific semantic aliases in `apps/web/src/styles.css`. If `apps/web/src/styles.css` is now the real product token source, move or generate it from `packages/design-system` so there is one canonical token lifecycle.

### Medium - Feature inventory documentation is stale for current domain ownership

Top-level feature organization is mostly good, and all but two feature directories have local READMEs. However, `apps/web/src/features/README.md:7-17` lists only a subset and includes stale names such as `profile/` and `ipc-devtool/` that do not match the current tree. The current tree has 28 first-level feature directories, including `context` and `pack-codebase`, while local README files exist for 26 feature directories. The missing README coverage is `apps/web/src/features/context` and `apps/web/src/features/pack-codebase`.

This matters architecturally because the repo's core rule is ownership and namespace clarity. The codebase is doing the right thing in many places with domain READMEs, but the index no longer helps contributors decide where new frontend ownership belongs.

Recommendation: refresh `apps/web/src/features/README.md` to match the current feature set, and add short ownership READMEs for `context` and `pack-codebase` or merge them into owning features if they are not independent domains.

### Medium - Some renderer API boundaries bypass generated OpenAPI helpers without a clear global rule

The dominant pattern is generated `api-gen` + TanStack Query, configured through `apps/web/src/lib/client.config.ts:1-14` and used broadly in feature hooks. There are also direct `fetch` boundaries in feature-owned modules, such as chat streaming and commands (`apps/web/src/features/chat/chat-response-command.ts:164-368`), plugin loading (`apps/web/src/lib/plugin-host.ts:269-283`), workspace file events (`apps/web/src/features/workspace/file-tree.ts`), Chronicle download/EventSource routes, automation API client, and devtool panels.

Several direct-fetch cases are justified by streaming, EventSource, plugin route scoping, or feature-owned command semantics. The architecture risk is that there is no concise rule that says when generated OpenAPI is mandatory and when a feature command boundary may bypass it. Over time this can create duplicate request typing and validation policy differences.

Recommendation: document the rule in `apps/web/src/lib/README.md` or `apps/web/src/api-gen/README.md`: generated query/mutation helpers are default for CRUD/API data; direct fetch is allowed only for streaming/EventSource/WebSocket, plugin-scoped routes, binary/raw file transfers, and feature-owned command modules with explicit parse/error policy.

### Low - AGENTS.md component organization is mostly followed, with shared editor as the main ownership caveat

`AGENTS.md:90-113` requires reusable primitives in `components/ui`, app-specific shared UI in `components/common`, and domain-specific components in `features/{domain}`. The current renderer largely follows this:

- `apps/web/src/components/ui/README.md` defines primitive boundaries and warns against business semantics.
- `apps/web/src/components/common/README.md` defines app-specific shared UI.
- `apps/web/src/components/layout/README.md` explicitly keeps layout shell concerns separate from domain content.
- Most business screens live under `apps/web/src/features/{domain}` with local READMEs.

The main caveat is `apps/web/src/components/editor`. Its README says it was extracted from workspace-detail and is reused by Kanban issue descriptions and other features. That reuse is reasonable, but editor features such as Smart Mention encode app resource kinds (`issue`, `session`, `workspace`, `agent`, `milestone`, `file`) in `apps/web/src/components/editor/smart-mention-utils.ts`. This is no longer a universal UI primitive; it is an app-specific shared editor subsystem. Its placement under `components/editor` is acceptable if treated like `components/common`, but it should not drift toward `components/ui`.

Recommendation: keep `components/editor` documented as app-specific shared infrastructure, not design-system primitive UI. If Smart Mention logic grows, consider moving app-resource mention projection into feature-owned adapters while keeping only the Tiptap shell shared.

### Low - No broad dynamic Tailwind class construction found, but one local violation exists

`AGENTS.md:35-65` forbids dynamic Tailwind class construction and requires static classes composed through `cn()`. A broad architectural scan did not find dynamic color/size class construction such as `text-${...}` or `bg-${...}`. Most components import and use `cn()` from `~/lib/cn` or `~/lib/utils`.

One local violation exists at `apps/web/src/features/model-registry/mapping-dialog.tsx:359`: `className={\`h-8 text-[12px] ${f.mono ? 'font-mono' : ''}\`}`. This is not a dynamically generated Tailwind token, but it is still template-based class composition instead of `cn()`.

Recommendation: fix that local case opportunistically with `cn('h-8 text-[12px]', f.mono && 'font-mono')`. Architecturally, the static Tailwind rule is mostly respected.

### Low - Type-only DB imports in the renderer couple API view types to storage schema names

`apps/web/package.json:26` depends on `@cradle/db`, and `apps/web/src/lib/types.ts:1-23` re-exports many DB entity types into renderer code with a comment saying they are type-only and erased by the bundler. This is not a bundle/runtime leak, but it is an ownership smell: the renderer view model names and server API payloads become coupled to storage schema names.

Recommendation: keep renderer-facing types generated from OpenAPI where possible. If shared DB types are needed during migration, isolate them in one compatibility file and avoid spreading DB entity names into feature components.

## Explicit AGENTS.md Checks

- Component organization: mostly compliant. `components/ui`, `components/common`, `components/layout`, `features/{domain}`, and `tabs` have clear boundaries. Feature index documentation is stale, and `components/editor` should remain app-specific shared infrastructure rather than a universal primitive layer.
- No dynamic Tailwind classes: mostly compliant at architecture level. No broad dynamic Tailwind token construction was found. One template-string class composition was found in `apps/web/src/features/model-registry/mapping-dialog.tsx:359` and should be converted to `cn()`.
- Design-system conventions: partially compliant. UI primitives exist and use token-oriented Tailwind classes, but the design-system package token source is not imported by `apps/web`, creating ownership ambiguity.

## Uncertainty

- I did not inspect every feature component in full; conclusions about API and component organization are based on directory structure, READMEs, package manifests, representative route/tab/store/API files, and repo-wide searches.
- I did not run browser tests or visual checks, per instruction.
- The generic IPC/plugin finding assumes web plugin bundles should be treated as less privileged than first-party renderer code. The current desktop plugin loader labels local and Marketplace plugin sources trusted, so if the product intentionally grants web plugins full renderer/preload authority, the issue becomes a product policy decision rather than a boundary bug. The current `WebPluginContext` design suggests a narrower intended capability model.

## Recommendations Summary

1. Close or hide the generic `window.cradle.ipc` escape hatch from plugin-reachable renderer globals; expose only typed, capability-scoped preload APIs.
2. Update current architecture docs to state that `@cradle/tabs-next`, not TanStack Router, owns renderer navigation.
3. Make `packages/design-system` and `apps/web/src/styles.css` converge on one token source of truth.
4. Refresh `apps/web/src/features/README.md` and add/merge ownership docs for `context` and `pack-codebase`.
5. Document when direct `fetch` is allowed versus generated OpenAPI/TanStack Query helpers.
6. Keep `components/editor` explicitly app-specific shared infrastructure and avoid promoting domain-bearing editor logic into `components/ui`.
7. Fix the one `cn()` composition violation in `model-registry/mapping-dialog.tsx`.
