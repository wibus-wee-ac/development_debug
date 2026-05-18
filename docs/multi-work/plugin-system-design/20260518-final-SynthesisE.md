# Plugin System Design — Final Synthesis E

**Author:** Final Synthesis Agent  
**Date:** 2026-05-18  
**Status:** Implementation-Ready  
**Inputs:** Synthesis C + Blocker Critique D + Source Code Analysis  
**Baseline:** All unchanged design details remain as specified in Synthesis C. This document only adds resolutions.

---

## 1. Executive Summary

This document resolves all 6 hard blockers, 4 design decisions, and 4 implementation notes from Critique D against the Synthesis C plugin system design. The key architectural insight is that Cradle runs as **three independent processes** (Electron main, forked server, browser renderer), and plugin loading must be designed as three independent discovery-activate cycles connected only by environment variables at fork time. `createServerApp()` becomes async to allow plugin route composition before `app.listen()`, import maps solve React resolution for web plugins, and a thin MCP registry bridges plugin registration to the agent provider.

---

## 2. Blocker Resolutions

### 🔴1 — Elysia Route Timing: Compose Before Listen

**Problem:** Routes added after `app.listen()` silently return 404.

**Resolution:** `createServerApp()` becomes async. Plugin discovery + activation happens inside it, before returning the app instance.

**Modified `apps/server/src/app.ts`:**

```typescript
export async function createServerApp() {
  const app = new Elysia({
    name: 'cradle.server.elysia',
    adapter: node(),
    normalize: 'typebox',
  })

  // ... existing .use() calls (cors, health, modules, etc.) ...
  app.use(observability)
  app.use(issueAgent)
  if (process.env.NODE_ENV === 'test') {
    app.use(testReset)
  }

  // === PLUGIN LOADING — BEFORE RETURN ===
  const { activateServerPlugins } = await import('./plugins/loader')
  await activateServerPlugins(app)

  app.onStop([() => shutdownInfra()])
  registerOpenApiAlias(app)

  return app
}
```

**Modified `apps/server/src/index.ts`:**

```typescript
async function bootstrap() {
  const config = loadServerConfig()
  const logger = getLogger()

  const app = await createServerApp()  // Now async

  app.listen({
    port: config.port,
    hostname: config.host,
  })

  warmupModelsDevCache()
  logger.info(`listening on http://${config.host}:${config.port}`)
}
```

**Plugin loader (`apps/server/src/plugins/loader.ts`):**

```typescript
import type { Elysia } from 'elysia'
import { discoverPlugins } from './discovery'
import { validatePluginModule } from './validation'
import { createServerPluginContext } from './context'
import { getLogger } from '../logging/logger'

const logger = getLogger()

export async function activateServerPlugins(app: Elysia) {
  const manifests = await discoverPlugins()
  const serverPlugins = manifests.filter(m => m.cradle.server)

  for (const manifest of serverPlugins) {
    const entryPath = resolve(manifest.packageDir, manifest.cradle.server)
    try {
      const mod = await import(entryPath)
      validatePluginModule(mod, manifest.name, 'server')

      const pluginApp = new Elysia({ prefix: `/api/plugins/${manifest.cradle.shortName ?? manifest.name.replace(/^@cradle\/plugin-/, '')}` })
        .onError(({ error }) => {
          logger.error(`[plugin:${manifest.name}] route error`, { error })
          return { error: 'Plugin error', plugin: manifest.name }
        })

      const ctx = createServerPluginContext(manifest, pluginApp)
      await mod.activate(ctx)
      app.use(pluginApp)

      logger.info(`plugin activated: ${manifest.name}`)
    } catch (err) {
      logger.error(`plugin ${manifest.name} failed to activate`, { err })
    }
  }
}
```

---

### 🔴2 — Cross-Process Shared Config: Env Vars at Fork Time

**Problem:** Desktop plugins write `sharedConfig` in Electron main process; server plugins read from a different process.

**Resolution:** Environment variables, matching the existing `BROWSER_BACKEND_SOCKET` pattern. Desktop plugins finish activation BEFORE `startServer()` forks the server process.

**How desktop host collects and passes config:**

```typescript
// apps/desktop/src/main/plugin-loader.ts

import { discoverPlugins } from './plugin-discovery'

/** Shared config accumulator — written by desktop plugins, read as env vars by server */
const pluginSharedConfig = new Map<string, string>()

export function getPluginEnvVars(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of pluginSharedConfig) {
    // Convention: CRADLE_PLUGIN_<UPPER_KEY>=value
    env[`CRADLE_PLUGIN_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] = value
  }
  return env
}

export async function activateDesktopPlugins(): Promise<void> {
  const manifests = await discoverPlugins(pluginsDir)
  const desktopPlugins = manifests.filter(m => m.cradle.desktop)

  for (const manifest of desktopPlugins) {
    const entryPath = resolve(manifest.packageDir, manifest.cradle.desktop)
    const mod = await import(entryPath)
    validatePluginModule(mod, manifest.name, 'desktop')

    const ctx = createDesktopPluginContext(manifest, {
      setSharedConfig(key: string, value: string) {
        pluginSharedConfig.set(`${manifest.name}/${key}`, value)
      },
    })
    await mod.activate(ctx)
  }
}
```

**Modified `apps/desktop/src/main/server-process.ts` `spawnServer()`:**

```typescript
import { getPluginEnvVars } from './plugin-loader'

// Inside spawnServer():
serverProcess = fork(serverEntry, [], {
  env: {
    ...process.env,
    CRADLE_HOST: host,
    CRADLE_PORT: String(port),
    CRADLE_DATA_DIR: dataDir,
    CRADLE_CREDENTIAL_SECRET: credentialSecret,
    BROWSER_BACKEND_SOCKET: getBrowserBackendSocketPath(),
    NODE_ENV: isDev ? 'development' : 'production',
    // NEW: Plugin shared config injected as env vars
    ...getPluginEnvVars(),
  },
  execPath,
  execArgv,
  stdio: 'pipe',
})
```

**Server-side reads:**

```typescript
// apps/server/src/plugins/context.ts
function buildSharedConfig(manifest: PluginManifest): ReadonlyMap<string, string> {
  const prefix = `CRADLE_PLUGIN_${manifest.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}/`
  const config = new Map<string, string>()
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CRADLE_PLUGIN_') && value !== undefined) {
      // Strip prefix, lowercase back
      const shortKey = key.replace('CRADLE_PLUGIN_', '').toLowerCase().replace(/_/g, '/')
      config.set(shortKey, value)
    }
  }
  return config
}
```

---

### 🔴3 — MCP Registry Integration

**Problem:** `registerMcpServer()` stores configs but no one reads them. The Claude agent provider hardcodes MCP servers.

**Resolution:** New registry module + one-line change in provider.

**Registry (`apps/server/src/plugins/mcp-registry.ts`):**

```typescript
export interface McpServerConfig {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
}

const registry = new Map<string, McpServerConfig>()

export function registerMcpServer(config: McpServerConfig): void {
  registry.set(config.name, config)
}

export function getRegisteredMcpServers(): Record<string, { command: string; args: string[]; env?: Record<string, string> }> {
  return Object.fromEntries(
    [...registry.entries()].map(([name, c]) => [name, { command: c.command, args: c.args, env: c.env }])
  )
}
```

**Provider change (one line):**

In the Claude agent provider's `query()` method, replace the hardcoded `mcpServers` construction:

```typescript
// Before:
if (process.env.BROWSER_BACKEND_SOCKET) {
  queryOptions.mcpServers = {
    'browser-use': { command: 'node', args: [...] }
  }
}

// After:
import { getRegisteredMcpServers } from '../../plugins/mcp-registry'
queryOptions.mcpServers = { ...queryOptions.mcpServers, ...getRegisteredMcpServers() }
```

This completely removes the browser-use hardcoding from the provider. Any plugin that calls `ctx.registerMcpServer()` is automatically available to agents.

---

### 🔴4 — React Import Resolution: Import Maps

**Problem:** Web plugin's `import { useState } from 'react'` fails as a bare specifier in the browser.

**Resolution:** Import maps + stable chunk names via Vite `manualChunks`.

**Vite config change (`apps/web/vite.config.ts`):**

```typescript
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react/jsx-runtime'],
        },
        // Stable chunk filenames (no hash) for import map targets
        chunkFileNames(chunkInfo) {
          if (chunkInfo.name === 'react-vendor') return 'assets/react-vendor.js'
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },
})
```

**HTML template change (`apps/web/index.html`):**

```html
<!DOCTYPE html>
<html>
<head>
  <script type="importmap">
  {
    "imports": {
      "react": "/assets/react-vendor.js",
      "react-dom": "/assets/react-vendor.js",
      "react/jsx-runtime": "/assets/react-vendor.js"
    }
  }
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

**Dev mode:** In development, Vite serves modules via ESM. The dev server already resolves bare specifiers. Import maps are only needed for production builds where plugins load via dynamic `import()` from `/api/plugins/*/web.mjs`.

For dev mode, the import map points to Vite's pre-bundled deps:

```html
<!-- Injected by plugin in dev mode via transformIndexHtml -->
<script type="importmap">
{
  "imports": {
    "react": "/node_modules/.vite/deps/react.js",
    "react-dom": "/node_modules/.vite/deps/react-dom.js",
    "react/jsx-runtime": "/node_modules/.vite/deps/react_jsx-runtime.js"
  }
}
</script>
```

A Vite plugin generates the import map automatically:

```typescript
// apps/web/vite-plugin-import-map.ts
import type { Plugin } from 'vite'

export function pluginImportMap(): Plugin {
  return {
    name: 'cradle-plugin-import-map',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const isDev = ctx.server !== undefined
        const imports = isDev
          ? {
              react: '/node_modules/.vite/deps/react.js',
              'react-dom': '/node_modules/.vite/deps/react-dom.js',
              'react/jsx-runtime': '/node_modules/.vite/deps/react_jsx-runtime.js',
            }
          : {
              react: '/assets/react-vendor.js',
              'react-dom': '/assets/react-vendor.js',
              'react/jsx-runtime': '/assets/react-vendor.js',
            }
        const tag = `<script type="importmap">\n${JSON.stringify({ imports }, null, 2)}\n</script>`
        return html.replace('<head>', `<head>\n${tag}`)
      },
    },
  }
}
```

**Packages that get stable chunk names:** `react`, `react-dom`, `react/jsx-runtime`. Nothing else — keep it minimal.

---

### 🔴5 — Dual-Process Discovery: Three Independent Phases

**Problem:** The design implies single-pass discovery. Reality is three processes.

**Resolution:** Explicit 3-phase boot diagram.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: Electron Main Process                                          │
│                                                                         │
│  app.whenReady()                                                        │
│    ├── discoverPlugins(pluginsDir)          ← reads plugins/*/pkg.json │
│    ├── activateDesktopPlugins()             ← imports desktop entries   │
│    │     └── each plugin calls setSharedConfig()                        │
│    ├── startBrowserBackend()                ← existing (will be plugin) │
│    ├── startServer()                        ← fork() with plugin envs  │
│    │         │                                                          │
│    │         ├── env: CRADLE_PLUGIN_*=...   ← shared config as envs    │
│    │         └── env: BROWSER_BACKEND_SOCKET=...                        │
│    └── createMainWindow(serverUrl)                                      │
└─────────────────────────────────────────────────────────────────────────┘
                         │  fork()
                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: Server Process (Forked)                                        │
│                                                                         │
│  bootstrap()                                                            │
│    └── createServerApp()  [async]                                       │
│          ├── existing modules: .use(health), .use(providers), etc.      │
│          ├── discoverPlugins(pluginsDir)    ← INDEPENDENT re-discovery │
│          ├── for each server plugin:                                    │
│          │     ├── import(entry)                                        │
│          │     ├── validatePluginModule(mod)                            │
│          │     ├── create scoped Elysia({ prefix })                    │
│          │     ├── ctx.sharedConfig ← reads CRADLE_PLUGIN_* env vars   │
│          │     ├── mod.activate(ctx)                                    │
│          │     └── app.use(pluginApp)                                   │
│          ├── serve web entries: GET /api/plugins/:name/web.mjs          │
│          └── return app                                                 │
│    └── app.listen()                                                     │
└─────────────────────────────────────────────────────────────────────────┘
                         │  HTTP
                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: Web Client (Browser)                                           │
│                                                                         │
│  App initialization (before React renders):                             │
│    ├── fetch('/api/plugins')               ← list of active plugins    │
│    ├── for each plugin with web entry:                                  │
│    │     ├── import(`/api/plugins/${name}/web.mjs`)                     │
│    │     ├── validate mod.activate exists                               │
│    │     └── mod.activate(webCtx)          ← registers panels/widgets  │
│    └── Registrations stored in Zustand → React tree subscribes         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key invariant:** Each process discovers plugins from the same `plugins/` directory (or in prod, from `resources/plugins/`). They share NO state except env vars passed at fork time.

**Modified `apps/desktop/src/main/index.ts`:**

```typescript
app.whenReady().then(async () => {
  // 1. Discover + activate desktop plugins (before anything else)
  await activateDesktopPlugins()

  // 2. Start browser backend (TODO: will become a plugin in v0.2)
  startBrowserBackend()

  // 3. Fork server — plugin env vars included automatically
  const serverUrl = await startServer()

  // 4. Window creation (same as before)
  windowManager = new WindowManager(serverUrl)
  createNativeServices(windowManager)
  mainWindow = await createMainWindow(serverUrl)
  windowManager.setMainWindow(mainWindow)
  // ... rest unchanged
})
```

---

### 🔴6 — Module Shape Validation

**Problem:** `await mod.activate(ctx)` crashes with unhelpful error if module doesn't export `activate`.

**Resolution:** Validation function between import and activate.

**`apps/server/src/plugins/validation.ts`:**

```typescript
export class PluginLoadError extends Error {
  constructor(
    public readonly pluginName: string,
    message: string,
  ) {
    super(`[plugin:${pluginName}] ${message}`)
    this.name = 'PluginLoadError'
  }
}

/**
 * Validates that a dynamically imported module has the expected plugin shape.
 * Runs BEFORE activate() is called.
 */
export function validatePluginModule(
  mod: unknown,
  pluginName: string,
  layer: 'server' | 'desktop' | 'web',
): asserts mod is { activate: Function; deactivate?: Function } {
  if (mod === null || typeof mod !== 'object') {
    throw new PluginLoadError(pluginName, `${layer} entry did not export a module object. Got: ${typeof mod}`)
  }

  const m = mod as Record<string, unknown>

  if (typeof m.activate !== 'function') {
    const exported = Object.keys(m).join(', ')
    throw new PluginLoadError(
      pluginName,
      `${layer} entry does not export 'activate' function. Got exports: [${exported}]`,
    )
  }

  if ('deactivate' in m && typeof m.deactivate !== 'function') {
    throw new PluginLoadError(
      pluginName,
      `${layer} entry exports 'deactivate' but it's not a function (got ${typeof m.deactivate})`,
    )
  }
}
```

Usage (already shown in loader above):

```typescript
const mod = await import(entryPath)
validatePluginModule(mod, manifest.name, 'server')  // throws PluginLoadError if invalid
await mod.activate(ctx)  // safe — we know activate is a function
```

---

## 3. Design Decision Resolutions

### 🟡7 — `when()` Predicate Evaluation

**Decision:** Evaluate once at registration time. If `when()` returns false, the MCP server is NOT added to the registry.

```typescript
// In ctx.registerMcpServer():
export function registerMcpServer(config: McpServerConfig): void {
  if (config.when && !config.when()) {
    logger.debug(`MCP server ${config.name} skipped — when() returned false`)
    return
  }
  registry.set(config.name, config)
}
```

No dynamic re-evaluation in v0.1. If a later version needs it, add `refreshMcpRegistry()` as an explicit API.

### 🟡8 — Web Plugin Panel Lifecycle

**Decision:** Web plugin activation runs ONCE at app initialization, outside the React tree. Registrations stored in a Zustand store.

```typescript
// apps/web/src/lib/plugin-store.ts
import { create } from 'zustand'
import type { PanelRegistration, SidebarWidgetRegistration } from '@cradle/plugin-sdk/web'

interface PluginStoreState {
  panels: PanelRegistration[]
  widgets: SidebarWidgetRegistration[]
  registerPanel(panel: PanelRegistration): () => void
  registerWidget(widget: SidebarWidgetRegistration): () => void
}

export const usePluginStore = create<PluginStoreState>((set, get) => ({
  panels: [],
  widgets: [],
  registerPanel(panel) {
    set(s => ({ panels: [...s.panels, panel] }))
    return () => set(s => ({ panels: s.panels.filter(p => p.id !== panel.id) }))
  },
  registerWidget(widget) {
    set(s => ({ widgets: [...s.widgets, widget] }))
    return () => set(s => ({ widgets: s.widgets.filter(w => w.id !== widget.id) }))
  },
}))
```

```typescript
// apps/web/src/main.tsx — activation happens before React renders
import { loadWebPlugins } from './lib/plugin-host'

async function init() {
  await loadWebPlugins()  // populates Zustand store
  ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
}
init()
```

React components subscribe: `const panels = usePluginStore(s => s.panels)`. No re-activation on route change.

### 🟡9 — Web Plugin CSS Contamination

**Decision:** For v0.1, plugins MUST use the host's Tailwind config. The SDK exports it:

```typescript
// @cradle/plugin-sdk/tailwind-config.ts
export { default as tailwindConfig } from '../../apps/web/tailwind.config'
```

Plugin authors reference it in their own `tailwind.config.ts`:

```typescript
import { tailwindConfig } from '@cradle/plugin-sdk/tailwind-config'
export default tailwindConfig
```

This ensures identical class semantics. For v0.2+, if third-party plugins need isolation, use CSS `@scope` or plugin-prefixed utility classes.

### 🟡10 — Skill Registration Path Resolution

**Decision:** The plugin loader adds plugin skill paths to the skills module's resolution list.

```typescript
// apps/server/src/plugins/skill-registry.ts
const pluginSkillPaths: { name: string; path: string; description: string }[] = []

export function registerPluginSkill(skill: { name: string; description: string; skillFile: string }) {
  pluginSkillPaths.push({ name: skill.name, path: skill.skillFile, description: skill.description })
}

export function getPluginSkills() {
  return pluginSkillPaths
}
```

The existing skills module's resolution function is extended to also check `getPluginSkills()` when building the skills index. No file copying — just path inclusion.

---

## 4. Implementation Notes (🟢 Items)

### 🟢11 — Migration Cutover Plan

**Not incremental.** Single PR:
1. Add plugin infrastructure (loader, registry, validation)
2. Move browser-use code into plugin structure
3. Remove hardcoded references from host apps
4. All in one atomic change — old paths stop existing, new paths start

### 🟢12 — `getMainWindow()` Returns Null During Activate

**Documented in SDK types:**

```typescript
interface DesktopPluginContext {
  /**
   * Get the main BrowserWindow.
   * Returns null during activate() — window hasn't been created yet.
   * Use onWindowReady() for window-dependent initialization.
   */
  getMainWindow(): BrowserWindow | null
  onWindowReady(handler: (win: BrowserWindow) => void): Disposable
}
```

### 🟢13 — Plugin Route Prefix Uses Short Name

Manifest adds optional `shortName` derived from npm package name:

```typescript
// In discovery:
const shortName = pkg.name.replace(/^@cradle\/plugin-/, '').replace(/^cradle-plugin-/, '')
manifest.cradle.shortName = shortName
// Route: /api/plugins/browser-use/...  (not /api/plugins/@cradle/plugin-browser-use/)
```

### 🟢14 — Plugin Storage Table Schema

Migration added with the plugin system:

```sql
CREATE TABLE IF NOT EXISTS plugin_storage (
  plugin_name TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (plugin_name, key)
);
```

---

## 5. Updated File Structure

```
apps/server/src/plugins/           ← NEW: Server-side plugin infrastructure
├── loader.ts                      # discoverPlugins + activateServerPlugins
├── discovery.ts                   # Reads plugins/*/package.json
├── validation.ts                  # validatePluginModule + PluginLoadError
├── context.ts                     # createServerPluginContext factory
├── mcp-registry.ts                # registerMcpServer + getRegisteredMcpServers
├── skill-registry.ts              # registerPluginSkill + getPluginSkills
├── storage.ts                     # PluginStorage SQLite implementation
└── static-server.ts               # Serves plugin web entries as static assets

apps/desktop/src/main/
├── plugin-loader.ts               ← NEW: Desktop plugin discovery + activation
├── plugin-discovery.ts            ← NEW: Shared discovery logic
└── index.ts                       # Modified: calls activateDesktopPlugins() before startServer()

apps/web/src/lib/
├── plugin-host.ts                 ← NEW: Web plugin loading + activation
├── plugin-store.ts                ← NEW: Zustand store for plugin registrations
└── vite-plugin-import-map.ts      ← NEW: Generates import map for React resolution

packages/plugin-sdk/               ← NEW: Types-only SDK package
├── package.json
├── src/
│   ├── server.ts
│   ├── web.ts
│   ├── desktop.ts
│   └── index.ts
└── tailwind-config.ts

packages/plugin-build/             ← NEW: Vite preset for plugin builds
├── package.json
└── src/vite-preset.ts
```

---

## 6. v0.1 Implementation Checklist (Ordered)

Tasks must be executed in this order (dependencies flow downward):

| # | Task | Output | Depends On |
|---|------|--------|------------|
| 1 | Create `packages/plugin-sdk` | Type definitions (server, web, desktop interfaces) | — |
| 2 | Create `packages/plugin-build` | Vite preset (`cradlePluginConfig()`) | — |
| 3 | Create `apps/server/src/plugins/validation.ts` | `validatePluginModule()` + `PluginLoadError` | — |
| 4 | Create `apps/server/src/plugins/discovery.ts` | `discoverPlugins()` function | — |
| 5 | Create `apps/server/src/plugins/mcp-registry.ts` | `registerMcpServer()` + `getRegisteredMcpServers()` | — |
| 6 | Create `apps/server/src/plugins/skill-registry.ts` | `registerPluginSkill()` + `getPluginSkills()` | — |
| 7 | Create `apps/server/src/plugins/storage.ts` | `PluginStorage` SQLite impl + migration | — |
| 8 | Create `apps/server/src/plugins/context.ts` | `createServerPluginContext()` factory | 5, 6, 7 |
| 9 | Create `apps/server/src/plugins/static-server.ts` | Static serving of web plugin entries | 4 |
| 10 | Create `apps/server/src/plugins/loader.ts` | `activateServerPlugins()` orchestrator | 3, 4, 8, 9 |
| 11 | Make `createServerApp()` async + integrate loader | Modified `app.ts` + `index.ts` | 10 |
| 12 | Modify Claude agent provider | Replace hardcoded MCP with registry lookup | 5 |
| 13 | Create `apps/web/src/lib/plugin-store.ts` | Zustand store for registrations | 1 |
| 14 | Create `apps/web/vite-plugin-import-map.ts` | Import map generation | — |
| 15 | Modify `apps/web/vite.config.ts` | Add `manualChunks` + import map plugin | 14 |
| 16 | Create `apps/web/src/lib/plugin-host.ts` | Web plugin loader | 3, 13 |
| 17 | Create `apps/desktop/src/main/plugin-discovery.ts` | Desktop-side discovery | — |
| 18 | Create `apps/desktop/src/main/plugin-loader.ts` | Desktop plugin activation + env collection | 3, 17 |
| 19 | Modify `apps/desktop/src/main/index.ts` | Call `activateDesktopPlugins()` before `startServer()` | 18 |
| 20 | Modify `apps/desktop/src/main/server-process.ts` | Pass `getPluginEnvVars()` to fork env | 18 |
| 21 | Restructure `plugins/browser-use/` | Add `package.json#cradle`, create server/desktop/web entries | 1, 2 |
| 22 | Move `browser-backend.ts` → `plugins/browser-use/src/desktop.ts` | Desktop plugin impl | 21 |
| 23 | Move browser panel → `plugins/browser-use/src/web.tsx` | Web plugin impl | 21 |
| 24 | Create `plugins/browser-use/src/server.ts` | Server plugin impl (MCP + skill registration) | 21 |
| 25 | Remove hardcoded browser-use from host apps | Clean cut — delete old imports/references | 22, 23, 24 |
| 26 | Add `GET /api/plugins` endpoint | Plugin list for web client | 10 |
| 27 | Add React `ErrorBoundary` wrapper for plugin panels | Crash isolation | 16 |
| 28 | Integration test: server boots with plugin routes active | Validates blocker 1 fix | 25, 26 |
| 29 | Integration test: web plugin loads + renders panel | Validates blockers 4, 6 | 25, 27 |

---

## 7. Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Import map not supported in test env (jsdom) | Skip web plugin import in unit tests; cover in E2E only |
| Plugin discovery adds startup latency | `readdir` + JSON parse is <5ms for <10 plugins. Measure, don't optimize. |
| Env var names collide between plugins | Prefix with full plugin name: `CRADLE_PLUGIN_BROWSER_USE_SOCKETPATH` |
| Dev mode: plugin not rebuilt | Plugin `vite build --watch` is plugin author's responsibility. Document in SDK README. |
