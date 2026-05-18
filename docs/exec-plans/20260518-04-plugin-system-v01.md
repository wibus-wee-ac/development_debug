# Plugin System v0.1 Implementation

This ExecPlan is a living document. Maintained per docs/exec-plans conventions.

## Purpose / Big Picture

After this change, Cradle has a working plugin system where `browser-use` runs as a self-contained plugin package instead of code scattered across `apps/desktop`, `apps/server`, and `apps/web`. Plugins are discovered from `plugins/*/package.json`, activated at startup across three processes (Electron main, server, web renderer), and can register MCP servers, skills, HTTP routes, UI panels, and hook into the chat lifecycle.

A user can verify by starting Cradle desktop and confirming that the browser panel still works, agent can still use browser tools, and the plugin appears in `GET /api/plugins`.

## Progress

- [x] (2026-05-18 05:00Z) browser-use V1 created (pre-plugin-system)
- [x] (2026-05-18 06:30Z) Design complete (Synthesis E + audits F/G)
- [ ] Track A: Plugin SDK types package
- [ ] Track B: Server plugin infrastructure
- [ ] Track C: Desktop plugin loader
- [ ] Track D: Web plugin host
- [ ] Track E: Migrate browser-use to plugin structure

## Surprises & Discoveries

(none yet)

## Decision Log

- Decision: Keep three entry points named `server`, `web`, `desktop` (not rename to renderer/main)
  Rationale: User uses web app standalone sometimes, so web-only deployment is real.
  Date: 2026-05-18

- Decision: Remove `@cradle/plugin-build` and `provides` from v0.1 scope
  Rationale: Over-engineering per Critique F. Inline vite config for single plugin.
  Date: 2026-05-18

- Decision: Add `hooks.onBeforeQuery`, `registerCommand`, `events.on` to v0.1
  Rationale: ~120 lines, transforms utility from "panel-only" to "AI-app-aware" per Critique F.
  Date: 2026-05-18

## Outcomes & Retrospective

(to be filled)

## Context and Orientation

Design documents:
- `docs/multi-work/plugin-system-design/20260518-final-SynthesisE.md` — full architecture
- `docs/multi-work/plugin-system-design/20260518-extension-audit-CritiqueF.md` — extension point audit
- `docs/multi-work/plugin-system-design/20260518-desktop-web-reality-CritiqueG.md` — desktop/web reality

Key architectural facts:
- Three processes: Electron main, forked server (Node), renderer (Chromium)
- Plugin manifest lives in `package.json#cradle`
- Discovery: `readdir plugins/ → filter by cradle field`
- Loading: `dynamic import()` at runtime
- Cross-process config: env vars at fork time
- Server routes composed before `app.listen()`
- Web plugins served as static assets by server, loaded via import map + dynamic import

## Plan of Work

### DAG Structure

```
Track A (SDK types) ─────────┐
                              ├── Track E (browser-use migration)
Track B (Server infra) ──────┤
                              │
Track C (Desktop loader) ────┤
                              │
Track D (Web host) ──────────┘
```

A has no deps. B, C, D depend on A. E depends on all.

### Track A: Plugin SDK (packages/plugin-sdk)

Create `packages/plugin-sdk/` with TypeScript interfaces only:
- `src/server.ts` — ServerPlugin, ServerPluginContext, McpServerConfig, SkillDefinition, PluginStorage, Logger, hooks, events
- `src/web.ts` — WebPlugin, WebPluginContext, PanelRegistration, CommandRegistration, Disposable
- `src/desktop.ts` — DesktopPlugin, DesktopPluginContext, onWebviewCreated, setSharedConfig
- `src/index.ts` — shared types (PluginManifest, Disposable, etc.)
- `package.json` — types-only, no runtime code

### Track B: Server Plugin Infrastructure (apps/server/src/plugins/)

- `validation.ts` — validatePluginModule + PluginLoadError
- `discovery.ts` — discoverPlugins(pluginsDir)
- `mcp-registry.ts` — registerMcpServer + getRegisteredMcpServers
- `skill-registry.ts` — registerPluginSkill + getPluginSkills
- `storage.ts` — PluginStorage impl (SQLite KV table)
- `event-bus.ts` — simple EventEmitter for host events
- `hooks.ts` — chat lifecycle hooks (onBeforeQuery, onAfterResponse)
- `context.ts` — createServerPluginContext factory
- `static-server.ts` — serve web plugin entries
- `loader.ts` — activateServerPlugins orchestrator
- Modify `app.ts` — make createServerApp async, call loader
- Modify Claude agent provider — use mcp-registry instead of hardcoded

### Track C: Desktop Plugin Loader (apps/desktop/src/main/)

- `plugin-discovery.ts` — discover plugins from plugins/ dir
- `plugin-loader.ts` — activate desktop plugins, collect shared config
- Modify `index.ts` — call activateDesktopPlugins before startServer
- Modify `server-process.ts` — pass getPluginEnvVars to fork

### Track D: Web Plugin Host (apps/web/src/lib/)

- `plugin-store.ts` — Zustand store for panel/command registrations
- `plugin-host.ts` — loadWebPlugins (fetch list, import, activate)
- `vite-plugin-import-map.ts` — generates import map for React
- Modify `vite.config.ts` — manualChunks + import map plugin
- Modify main.tsx — call loadWebPlugins before React render
- Add PluginPanel ErrorBoundary wrapper component

### Track E: Migrate browser-use

- Add `cradle` field to plugins/browser-use/package.json
- Create `src/server.ts` — registers MCP + skill via ctx
- Create `src/desktop.ts` — moved from apps/desktop browser-backend
- Create `src/web.tsx` — registers browser panel
- Update vite.config for multi-entry output
- Remove hardcoded browser-use from host apps

## Validation and Acceptance

1. `pnpm --filter @cradle/plugin-sdk typecheck` passes
2. `pnpm --filter @cradle/server typecheck` passes
3. `pnpm --filter @cradle/desktop typecheck` passes
4. Server boots and `GET /api/plugins` returns browser-use
5. Desktop boots, browser panel still works
6. Agent can still use browser_navigate, browser_click etc. via MCP

## Idempotence and Recovery

All changes are file additions or modifications in version control. Can revert any track independently. The only destructive step is Track E which removes hardcoded browser-use code — do this last after everything else works.
