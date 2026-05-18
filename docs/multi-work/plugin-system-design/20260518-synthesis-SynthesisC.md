# Plugin System Design — Synthesis C (Refined)

**Author:** Synthesis Agent  
**Date:** 2026-05-18  
**Status:** Implementation-Ready Draft  
**Inputs:** Design A (initial proposal) + Critique B (review)

---

## 0. Critique Resolution Summary

| # | Critique | Resolution |
|---|----------|-----------|
| 1 | 🔴 Web plugin loading is build-time trap | **Accepted.** Redesigned: runtime `import()` via known URL path for all deployment modes. Build-time bundling only as optional optimization. |
| 2 | 🔴 Cross-layer config propagation undefined | **Accepted.** Introduced deterministic convention + explicit shared config bus. |
| 3 | 🟡 Permission system is theater | **Accepted.** Removed permissions field from v0.1. Replaced with `trusted` flag + deployment target declaration. |
| 4 | 🟡 activationEvents without deactivation | **Accepted.** Simplified to eager activation for v0.1. <10 plugins makes lazy loading premature optimization. |
| 5 | 🟡 Single package multi-entry creates build hell | **Partially rejected.** Mono-package is correct for ownership cohesion, BUT we provide `@cradle/plugin-build` to eliminate config burden. Separate packages fragment ownership. |
| 6 | 🟡 DesktopPluginContext too thin | **Accepted.** Desktop plugins get raw `WebContents` reference. Don't abstract Electron — abstract lifecycle only. |
| 7 | 🟡 Error boundaries not designed | **Accepted.** Added concrete error handling spec for v0.1. |
| 8 | 🟢 No DevEx story | **Deferred to v0.2.** Acknowledged; template + mock context planned. |
| 9 | 🟢 npm distribution edge cases | **Deferred.** Use workspace-local plugins for v0.1. npm distribution in v0.2. |
| 10 | 🟢 Web-only degradation undefined | **Accepted.** Added `deployments` field to manifest. |
| 11 | 🟢 Missing settings auto-render | **Deferred to v0.2.** Good idea, not blocking. |

---

## 1. Core Principles

1. **Lifecycle only** — The plugin system owns discovery, activation, and shutdown. It does NOT abstract platform APIs (Electron, Elysia, React).
2. **Deterministic conventions** — Cross-layer communication uses path conventions, not config negotiation.
3. **Single owner** — One npm package owns all layers of a plugin. Build complexity is handled by shared tooling.
4. **Runtime loading everywhere** — All plugin layers load at runtime via dynamic `import()`. Build-time bundling is an optional perf optimization, not a requirement.
5. **Honest guarantees** — Don't declare security features that aren't enforced. Don't promise capabilities that don't work.

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                     Cradle Desktop App                          │
│                                                                │
│  ┌──────────────────┐    ┌──────────────────────────────────┐  │
│  │  Electron Main   │    │         Renderer (Web)           │  │
│  │                  │    │                                  │  │
│  │  DesktopPlugin:  │    │  WebPlugin:                      │  │
│  │  raw Electron    │    │  React components registered     │  │
│  │  APIs, IPC,      │    │  into host shell via context     │  │
│  │  sockets         │    │                                  │  │
│  └────────┬─────────┘    └──────────────┬───────────────────┘  │
│           │                              │                      │
│           │  UDS (deterministic path)    │  HTTP/WS             │
│           ▼                              ▼                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Elysia Server                          │  │
│  │                                                          │  │
│  │  ServerPlugin: routes via app.use(), MCP registration    │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. Plugin Manifest

All metadata lives in `package.json` under the `"cradle"` key. No separate manifest file.

```jsonc
{
  "name": "@cradle/plugin-browser-use",
  "version": "0.1.0",
  "type": "module",
  "cradle": {
    "displayName": "Browser Use",
    "description": "In-app browser control via MCP tools over CDP",

    // Which deployment modes this plugin supports
    "deployments": ["desktop"],

    // Extension point entries (all optional)
    "server": "./dist/server.mjs",
    "web": "./dist/web.mjs",
    "desktop": "./dist/desktop.mjs",

    // What the plugin provides (for indexing without activation)
    "provides": {
      "mcpServers": ["browser-use"],
      "panels": ["browser"],
      "skills": ["browser-use"]
    }
  },

  "exports": {
    "./server": "./dist/server.mjs",
    "./web": "./dist/web.mjs",
    "./desktop": "./dist/desktop.mjs",
    "./protocol": "./src/protocol.ts"
  },

  "peerDependencies": {
    "@cradle/plugin-sdk": "^0.1.0"
  }
}
```

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Entry points are flat strings, not objects | Simplest possible; no `activationEvents` in v0.1 — everything is eager |
| `deployments` field | Host hides plugins incompatible with current mode instead of letting them silently fail (addresses Critique #10) |
| No `permissions` field | Permissions without enforcement is worse than none (Critique #3). Add when we have sandboxing. |
| No `requires.capabilities` | Premature. With 1 plugin, capability negotiation is over-engineering. |
| `provides` kept | Zero-cost indexing of features without activating plugins. Agent can discover available MCP servers/skills at startup. |

---

## 4. Extension Point Interfaces

### 4.1 Server Plugin

```typescript
// @cradle/plugin-sdk/server

import type { Elysia } from 'elysia'

export interface ServerPluginContext {
  /** Elysia app — plugins compose via .use() */
  app: Elysia

  /** Register an MCP server with the agent runtime */
  registerMcpServer(config: McpServerConfig): void

  /** Register a skill for agent discovery */
  registerSkill(skill: SkillDefinition): void

  /** Plugin-scoped logger */
  logger: Logger

  /** Plugin-scoped KV storage (persisted via SQLite) */
  storage: PluginStorage

  /** Shared config bus — read values set by other layers of this plugin */
  sharedConfig: ReadonlyMap<string, string>

  /** Plugin metadata from package.json */
  manifest: PluginManifest
}

export interface McpServerConfig {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  /** Only register when this returns true */
  when?: () => boolean | Promise<boolean>
}

export interface SkillDefinition {
  name: string
  description: string
  /** Absolute or relative (to plugin root) path to SKILL.md */
  skillFile: string
}

export interface PluginStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export interface Logger {
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
}

export interface PluginManifest {
  name: string
  version: string
  packageDir: string
  cradle: Record<string, unknown>
}

/** Server plugins export activate + optional deactivate */
export interface ServerPlugin {
  activate(ctx: ServerPluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
```

### 4.2 Web Plugin

```typescript
// @cradle/plugin-sdk/web

import type { ComponentType } from 'react'

export interface WebPluginContext {
  /** Register a panel in the workspace */
  registerPanel(panel: PanelRegistration): Disposable

  /** Register a sidebar widget */
  registerSidebarWidget(widget: SidebarWidgetRegistration): Disposable

  /** Plugin-scoped HTTP client (base URL pre-configured) */
  api: PluginApiClient

  /** Plugin-scoped localStorage wrapper */
  storage: WebPluginStorage
}

export interface PanelRegistration {
  id: string
  title: string
  icon: ComponentType<{ className?: string }> | string
  component: ComponentType<PanelProps>
  location?: 'main' | 'sidebar' | 'bottom'
  order?: number
}

export interface PanelProps {
  isActive: boolean
  storage: WebPluginStorage
}

export interface SidebarWidgetRegistration {
  id: string
  title: string
  component: ComponentType
  order?: number
}

export interface PluginApiClient {
  get<T = unknown>(path: string): Promise<T>
  post<T = unknown>(path: string, body?: unknown): Promise<T>
}

export interface WebPluginStorage {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

export interface Disposable {
  dispose(): void
}

export interface WebPlugin {
  activate(ctx: WebPluginContext): void | Promise<void>
  deactivate?(): void
}
```

### 4.3 Desktop Plugin

```typescript
// @cradle/plugin-sdk/desktop

import type { BrowserWindow, WebContents } from 'electron'

export interface DesktopPluginContext {
  /** Electron userData path */
  userDataPath: string

  /** Get the main BrowserWindow */
  getMainWindow(): BrowserWindow | null

  /**
   * Listen for webview creation.
   * Provides RAW WebContents — plugins use Electron APIs directly.
   * The system does NOT abstract CDP, debugger, or webview APIs.
   */
  onWebviewCreated(handler: (wc: WebContents, tabId: string) => void): Disposable

  /** Register IPC handler (accessible from renderer via preload bridge) */
  registerIpcHandler(channel: string, handler: IpcHandler): Disposable

  /**
   * Write to shared config bus. Server plugin can read these values.
   * Written values are propagated to server plugin's sharedConfig.
   */
  setSharedConfig(key: string, value: string): void

  /** Plugin-scoped logger */
  logger: Logger
}

export type IpcHandler = (
  event: Electron.IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown | Promise<unknown>

export interface Disposable {
  dispose(): void
}

export interface DesktopPlugin {
  activate(ctx: DesktopPluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
```

**Key difference from Design A:** The `DesktopPluginContext` does NOT include `createSocketServer()`. Plugins that need sockets use Node's `net` module directly — the context provides `userDataPath` for deterministic socket paths but doesn't wrap socket creation. This addresses Critique #6: don't try to abstract what plugins actually need raw access to.

---

## 5. Cross-Layer Communication (Resolves Critique #2)

### The Problem

How does the server-side of `browser-use` know the socket path that the desktop-side created?

### Solution: Deterministic Convention + Shared Config Bus

**Primary mechanism:** Deterministic paths. The socket path is always `{userDataPath}/{pluginName}.sock`. Both sides compute it identically.

**Fallback mechanism:** Shared config bus for non-deterministic values.

```typescript
// Desktop plugin writes:
ctx.setSharedConfig('socketPath', socketPath)

// Server plugin reads (available after desktop plugin activates):
const socketPath = ctx.sharedConfig.get('socketPath')
```

### Activation Ordering

The host guarantees: **Desktop plugins activate before server plugins.**

This is the natural ordering — Electron main process starts before spawning the server. The host formalizes this:

```
1. Discover all plugins
2. Activate desktop plugins (parallel)
3. Collect shared config values
4. Activate server plugins (parallel, with sharedConfig populated)
5. Activate web plugins (parallel, on first renderer load)
```

### For browser-use specifically

The socket path is deterministic: `{userDataPath}/browser-use.sock`. No config bus needed. Both sides compute it:

```typescript
// Desktop side:
const socketPath = join(ctx.userDataPath, 'browser-use.sock')

// Server side — reads from env (injected by host):
const socketPath = join(process.env.CRADLE_USER_DATA!, 'browser-use.sock')
```

---

## 6. Plugin Loading (Resolves Critique #1)

### Design Decision: Runtime Loading for All Layers

The critique correctly identifies that build-time bundling contradicts npm distribution. The synthesis adopts **runtime loading** as the universal model:

| Layer | Loading Mechanism | Why |
|-------|------------------|-----|
| Server | `import(entryPath)` at server startup | Node can import anything at runtime |
| Desktop | `import(entryPath)` in Electron main | Same as server |
| Web | `import(pluginUrl)` at app initialization | Served as static asset by Elysia |

### Web Plugin Runtime Loading

The server exposes each web plugin's built entry as a static route:

```typescript
// Host: apps/server/src/plugins/plugin-static-server.ts

// Serves plugin web entries as static assets
// GET /api/plugins/:name/web.mjs → returns the plugin's web entry
app.get('/api/plugins/:name/web.mjs', ({ params }) => {
  const manifest = pluginRegistry.get(params.name)
  if (!manifest?.cradle.web) return new Response('Not found', { status: 404 })
  const filePath = resolve(manifest.packageDir, manifest.cradle.web)
  return Bun.file(filePath)
})
```

The web shell loads plugins at runtime:

```typescript
// Host: apps/web/src/lib/plugin-host.ts

export async function loadWebPlugins(
  registry: PluginManifest[]
): Promise<WebPlugin[]> {
  const webPlugins = registry.filter(m => m.cradle.web)

  const loaded = await Promise.allSettled(
    webPlugins.map(async (m) => {
      const mod = await import(`/api/plugins/${m.name}/web.mjs`)
      return { manifest: m, plugin: mod as WebPlugin }
    })
  )

  // Log failures, return successes
  return loaded
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map(r => r.value)
}
```

### Why This Works for Both Desktop and Web Deployments

- **Desktop:** Server runs on localhost. Web shell loads plugin modules from `http://localhost:PORT/api/plugins/*/web.mjs`.
- **Web-only:** Same mechanism. Server serves the assets.
- **No rebuild required.** Install a plugin → restart server → plugin discovered → web entry served → frontend imports it at next page load.

### Trade-offs Accepted

| Lost | Gained |
|------|--------|
| Tree-shaking of plugin code | True dynamic loading without rebuild |
| Type-checked imports at build time | npm distribution actually works |
| Vite HMR for plugin code | Simpler mental model |

### Mitigation for Trade-offs

- Plugin bundles are pre-built (`dist/web.mjs` is already bundled by the plugin's own build). No tree-shaking needed — the plugin author controls their bundle.
- Types come from `@cradle/plugin-sdk` peer dependency — TypeScript checks happen at plugin build time, not host build time.
- Dev-mode HMR: plugin authors use `vite build --watch` on their plugin. The host reloads the module on import (with cache-busting in dev mode).

---

## 7. Error Handling (Resolves Critique #7)

### Server Plugin Errors

```typescript
// Host: plugin loader wraps activation in try/catch
async function activateServerPlugin(manifest: PluginManifest, ctx: ServerPluginContext) {
  try {
    const mod = await import(resolve(manifest.packageDir, manifest.cradle.server))
    await mod.activate(ctx)
  } catch (err) {
    logger.error(`Plugin ${manifest.name} failed to activate:`, err)
    // Plugin is marked as failed — not retried automatically
    pluginStatus.set(manifest.name, { state: 'error', error: err })
  }
}
```

### Route Error Attribution

Server plugins register routes via `app.use()`. Elysia's error handler is extended to attribute errors:

```typescript
// Plugin routes are grouped under a prefix
const pluginApp = new Elysia({ prefix: `/api/plugins/${manifest.name}` })
  .onError(({ error }) => {
    logger.error(`[plugin:${manifest.name}] Route error:`, error)
    return { error: 'Plugin error', plugin: manifest.name }
  })

// Plugin gets the scoped instance
ctx.app = pluginApp
// Host composes: mainApp.use(pluginApp)
```

### Deactivation Errors

```typescript
async function deactivatePlugin(name: string) {
  try {
    await plugins.get(name)?.deactivate?.()
  } catch (err) {
    // Log but don't throw — shutdown must continue
    logger.error(`Plugin ${name} deactivation error:`, err)
  }
}
```

### Web Plugin Errors

React error boundary wraps each plugin panel:

```tsx
// Host: wraps plugin components
<ErrorBoundary fallback={<PluginErrorFallback pluginName={name} />}>
  <PluginPanel component={registration.component} />
</ErrorBoundary>
```

---

## 8. Lifecycle (Simplified — Resolves Critique #4)

### v0.1: Eager Activation Only

All plugins activate at load time. No `activationEvents`. No lazy loading.

**Rationale** (quoting critique): "Lazy activation is a premature optimization when you have <10 plugins."

```
┌──────────┐     ┌───────────┐     ┌──────────┐     ┌─────────────┐
│ Discover │ ──► │ Validate  │ ──► │ Activate │ ──► │ Deactivate  │
│          │     │ (version, │     │ (eager,  │     │ (shutdown/  │
│          │     │  deploy)  │     │  all)    │     │  disable)   │
└──────────┘     └───────────┘     └──────────┘     └─────────────┘
```

**Validation checks:**
1. `cradle` field exists in package.json
2. Declared entry files exist on disk
3. `deployments` array includes current mode (skip if not)
4. `peerDependencies["@cradle/plugin-sdk"]` is compatible

**Deactivation triggers:**
1. Server/app shutdown (graceful)
2. User disables plugin (runtime, if UI exists)

### v0.2+: Optional Lazy Activation

If needed later, plugins can opt into lazy loading by exporting a `shouldActivate` predicate:

```typescript
// Optional — if not exported, plugin activates eagerly
export function shouldActivate(env: { deployment: 'desktop' | 'web' }): boolean {
  return env.deployment === 'desktop'
}
```

---

## 9. Plugin Discovery

### v0.1: Workspace-Only

Plugins live in `plugins/*` (workspace packages). No npm install flow yet.

```typescript
// Host: plugin discovery
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function discoverPlugins(workspaceRoot: string): Promise<PluginManifest[]> {
  const pluginsDir = resolve(workspaceRoot, 'plugins')
  const entries = await readdir(pluginsDir, { withFileTypes: true })
  
  const manifests: PluginManifest[] = []
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const pkgPath = resolve(pluginsDir, entry.name, 'package.json')
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
      if (!pkg.cradle) continue
      manifests.push({
        name: pkg.name,
        version: pkg.version,
        packageDir: resolve(pluginsDir, entry.name),
        cradle: pkg.cradle,
      })
    } catch {
      // Skip invalid packages
    }
  }
  
  return manifests
}
```

### v0.2: npm Distribution

Add `node_modules` scanning:

```typescript
// Phase 2 addition — scan node_modules for @cradle/plugin-* and cradle-plugin-*
const patterns = ['@cradle/plugin-*', 'cradle-plugin-*']
```

**Naming convention:** `@cradle/plugin-*` only. Don't support two patterns (Critique #9). Scoped packages are clearer.

---

## 10. `browser-use` Migration

### Current State

```
plugins/browser-use/          → MCP server only (server-side process)
  src/mcp-server.ts           → MCP stdio tool definitions
  src/protocol.ts             → Shared types + frame encoding

apps/desktop/src/main/
  browser-backend.ts          → Socket server + CDP handling (400+ lines)
                                Lives in desktop app, tightly coupled

apps/web/src/features/browser/ → Panel UI (React components)
                                Lives in web app, hardcoded
```

### Target State

```
plugins/browser-use/
├── package.json              # With "cradle" manifest field
├── SKILL.md                  # Agent skill documentation (unchanged)
├── vite.config.ts            # Multi-output build (provided by @cradle/plugin-build)
├── src/
│   ├── server.ts             # Registers MCP server + skill with host
│   ├── desktop.ts            # Moved from apps/desktop: socket server + CDP
│   ├── web.tsx               # Moved from apps/web: browser panel
│   ├── protocol.ts           # Shared types (unchanged)
│   └── mcp-server.ts         # MCP stdio process (unchanged)
└── dist/
    ├── server.mjs
    ├── desktop.mjs
    ├── web.mjs
    └── mcp-server.mjs
```

### Migration Steps

**Step 1:** Move `apps/desktop/src/main/browser-backend.ts` → `plugins/browser-use/src/desktop.ts`

The desktop plugin gets raw `WebContents` via `ctx.onWebviewCreated()`. It uses Electron APIs directly — no abstraction needed:

```typescript
// plugins/browser-use/src/desktop.ts
import type { DesktopPlugin, DesktopPluginContext } from '@cradle/plugin-sdk/desktop'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { existsSync, unlinkSync } from 'node:fs'
import type { BrowserCommand, BrowserResponse } from './protocol'
import { encodeFrame, FrameDecoder } from './protocol'

const webviewRegistry = new Map<string, { wc: Electron.WebContents; attached: boolean }>()

export const activate: DesktopPlugin['activate'] = async (ctx) => {
  const socketPath = join(ctx.userDataPath, 'browser-use.sock')

  // Clean up stale socket
  if (existsSync(socketPath)) unlinkSync(socketPath)

  // Create UDS server (raw Node, no wrapper needed)
  const server = createServer((conn) => {
    const decoder = new FrameDecoder()
    conn.on('data', (buf) => decoder.feed(buf))
    decoder.onFrame = async (frame) => {
      const cmd = JSON.parse(frame) as BrowserCommand
      const response = await handleCommand(cmd)
      conn.write(encodeFrame(JSON.stringify(response)))
    }
  })
  server.listen(socketPath)

  // Publish socket path for server plugin
  ctx.setSharedConfig('socketPath', socketPath)

  // Track webviews — use raw WebContents + debugger API
  ctx.onWebviewCreated((wc, tabId) => {
    wc.debugger.attach('1.3')
    webviewRegistry.set(tabId, { wc, attached: true })
    wc.on('destroyed', () => webviewRegistry.delete(tabId))
  })

  ctx.logger.info(`browser-use socket: ${socketPath}`)
}

// handleCommand is the same 300+ line function currently in browser-backend.ts
// It uses wc.debugger.sendCommand() directly — no abstraction
async function handleCommand(cmd: BrowserCommand): Promise<BrowserResponse> {
  // ... (existing implementation moves here unchanged)
}
```

**Step 2:** Create `plugins/browser-use/src/server.ts`

```typescript
// plugins/browser-use/src/server.ts
import type { ServerPlugin, ServerPluginContext } from '@cradle/plugin-sdk/server'
import { join } from 'node:path'

export const activate: ServerPlugin['activate'] = async (ctx) => {
  const socketPath = ctx.sharedConfig.get('socketPath')
    ?? join(process.env.CRADLE_USER_DATA ?? '', 'browser-use.sock')

  ctx.registerMcpServer({
    name: 'browser-use',
    command: 'node',
    args: [new URL('./mcp-server.mjs', import.meta.url).pathname],
    env: { BROWSER_BACKEND_SOCKET: socketPath },
    when: () => !!socketPath,
  })

  ctx.registerSkill({
    name: 'browser-use',
    description: 'Control Cradle in-app browser via MCP tools',
    skillFile: new URL('../SKILL.md', import.meta.url).pathname,
  })

  ctx.logger.info('browser-use server plugin activated')
}
```

**Step 3:** Move browser panel from `apps/web/src/features/browser/` → `plugins/browser-use/src/web.tsx`

```typescript
// plugins/browser-use/src/web.tsx
import type { WebPlugin, WebPluginContext } from '@cradle/plugin-sdk/web'
import { BrowserPanel } from './components/BrowserPanel'

export const activate: WebPlugin['activate'] = (ctx) => {
  ctx.registerPanel({
    id: 'browser',
    title: 'Browser',
    icon: 'globe', // icon name from host's icon set
    component: BrowserPanel,
    location: 'main',
    order: 100,
  })
}
```

**Step 4:** Remove hardcoded references from host apps:
- `apps/desktop/src/main/index.ts` — remove `import { startBrowserBackend }` → replaced by plugin loader
- `apps/server/` — remove hardcoded MCP registration for browser-use → replaced by `ctx.registerMcpServer()`
- `apps/web/` — remove hardcoded browser panel → discovered via plugin registry

---

## 11. Build Configuration (Resolves Critique #5)

### Problem

A single package targeting 3 runtimes (Node server, Electron main, Browser) needs multi-output builds.

### Solution: Shared Build Preset

Rather than splitting into separate packages (which fragments ownership), provide a build helper:

```typescript
// @cradle/plugin-build/vite-preset.ts
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export function cradlePluginConfig(options: {
  server?: string   // e.g. 'src/server.ts'
  web?: string      // e.g. 'src/web.tsx'
  desktop?: string  // e.g. 'src/desktop.ts'
}) {
  const entries: Record<string, string> = {}
  if (options.server) entries.server = resolve(process.cwd(), options.server)
  if (options.web) entries.web = resolve(process.cwd(), options.web)
  if (options.desktop) entries.desktop = resolve(process.cwd(), options.desktop)

  return defineConfig({
    build: {
      lib: {
        entry: entries,
        formats: ['es'],
      },
      rollupOptions: {
        external: [
          // Never bundle these — provided by host
          'electron',
          'react',
          'react-dom',
          '@cradle/plugin-sdk',
          /^node:/,
        ],
      },
      outDir: 'dist',
    },
  })
}
```

Plugin author's `vite.config.ts`:

```typescript
// plugins/browser-use/vite.config.ts
import { cradlePluginConfig } from '@cradle/plugin-build/vite-preset'

export default cradlePluginConfig({
  server: 'src/server.ts',
  web: 'src/web.tsx',
  desktop: 'src/desktop.ts',
})
```

**One command builds all entries:** `vite build` produces `dist/server.mjs`, `dist/web.mjs`, `dist/desktop.mjs`.

### Dependency Management

- `react`, `electron`, `elysia` — **peerDependencies**, never bundled
- `@modelcontextprotocol/sdk` — **dependency**, bundled into `mcp-server.mjs` (it's a standalone process)
- `@cradle/plugin-sdk` — **peerDependency**, types only

---

## 12. Web-Only Deployment (Resolves Critique #10)

When Cradle runs without Electron (web-only mode):

1. Host reads `cradle.deployments` from manifest
2. If current deployment is `"web"` and plugin declares `["desktop"]` only → **plugin is not loaded at all**
3. If plugin declares `["desktop", "web"]` → server + web entries activate; desktop entry skipped

For `browser-use`: it declares `"deployments": ["desktop"]`. In web-only mode, the entire plugin is invisible. No silent failures.

### Plugin Visibility API

```typescript
// Web shell can query which plugins are available
const availablePlugins = await api.get<PluginInfo[]>('/api/plugins')
// Returns only plugins compatible with current deployment mode
```

---

## 13. SDK Package Structure

```
packages/plugin-sdk/
├── package.json
├── src/
│   ├── server.ts      # ServerPlugin, ServerPluginContext types
│   ├── web.ts         # WebPlugin, WebPluginContext types  
│   ├── desktop.ts     # DesktopPlugin, DesktopPluginContext types
│   └── index.ts       # Re-exports shared types (Disposable, Logger, etc.)
└── dist/              # Compiled declarations only — no runtime code
```

The SDK is **types-only**. Runtime context objects are constructed and injected by the host. This means:
- Zero bundle size impact
- No version conflicts at runtime
- Plugin authors get full autocomplete + type checking

---

## 14. Phased Implementation Plan

### v0.1 — Ship Next Week (Current Sprint)

**Goal:** `browser-use` works as a plugin. No other plugins exist yet. Prove the architecture.

| Task | Output |
|------|--------|
| Create `packages/plugin-sdk` | TypeScript interfaces only |
| Create `@cradle/plugin-build` | Vite preset for multi-entry |
| Implement server-side plugin loader | `apps/server/src/plugins/loader.ts` |
| Implement desktop-side plugin loader | `apps/desktop/src/main/plugin-loader.ts` |
| Implement web plugin serving + loading | Static route + runtime `import()` |
| Migrate `browser-use` to plugin structure | Move code, update imports |
| Remove hardcoded browser-use from host apps | Clean separation |
| Add plugin list API | `GET /api/plugins` |
| Add React error boundary for plugin panels | Crash isolation |

**NOT in v0.1:**
- npm distribution
- Plugin install/uninstall CLI
- Settings UI
- Multiple plugins
- Lazy activation
- Sandboxing

### v0.2 — Plugin Ecosystem Foundation

| Task | Output |
|------|--------|
| npm discovery (scan `node_modules`) | Support `@cradle/plugin-*` packages |
| `cradle plugin install <name>` CLI | Wraps `pnpm add -w` + validation |
| Plugin settings schema + auto-render | JSON Schema → React form |
| `create-cradle-plugin` template | Scaffolding for new plugins |
| Mock contexts for testing | `createMockServerContext()` etc. |
| Dev-mode cache-busting for web plugins | HMR-like experience |
| Plugin status dashboard in UI | See which plugins are active/errored |

### v1.0 — Production Ready

| Task | Output |
|------|--------|
| Lazy activation (optional, per-plugin) | `shouldActivate()` predicate |
| Worker thread isolation for server plugins | Crash isolation |
| Plugin marketplace / registry | Discovery beyond npm |
| Inter-plugin dependencies | Ordered activation, capability sharing |
| Migration hooks for storage schema changes | `onUpdate(oldVersion, newVersion)` |

---

## 15. Open Questions (Acknowledged, Not Blocking v0.1)

1. **Web plugin CSS isolation** — Plugin panels share the host's CSS context. Do we need Shadow DOM or CSS Modules scoping? Punt until second plugin has CSS conflicts.

2. **Hot reload in development** — Server plugins: restart server (nodemon handles). Desktop plugins: restart Electron. Web plugins: page refresh. Full HMR is a v0.2 concern.

3. **Inter-plugin communication** — Can plugin A call plugin B's API? For v0.1: no. Plugins communicate through the host (shared routes, shared config). Design later if needed.

4. **Plugin marketplace** — npm is sufficient for now. If discovery becomes a problem, consider a curated `awesome-cradle-plugins` list before building infrastructure.

---

## 16. What This Design Is NOT

To set clear expectations:

- **NOT a sandbox.** Plugins run in the same process as the host. A buggy plugin can crash the server. This is acceptable at <10 first-party plugins.
- **NOT a package manager.** We use pnpm. The plugin system discovers and activates, it doesn't manage deps.
- **NOT a UI framework.** Web plugins bring their own React components. The host provides mounting points, not a component library (though plugins can import from the host's design system).
- **NOT VS Code extensions.** No contribution points JSON, no activation events FSM, no extension host process. Simpler.

---

## Appendix: File Tree After v0.1

```
packages/
  plugin-sdk/             # Types-only SDK
    package.json
    src/
      server.ts
      web.ts
      desktop.ts
      index.ts

  plugin-build/           # Vite preset for plugin authors
    package.json
    src/
      vite-preset.ts

plugins/
  browser-use/            # The reference plugin
    package.json          # Has "cradle" field
    SKILL.md
    vite.config.ts        # Uses @cradle/plugin-build preset
    src/
      server.ts           # NEW: registers MCP + skill
      desktop.ts          # MOVED from apps/desktop: socket + CDP
      web.tsx             # MOVED from apps/web: panel component
      protocol.ts         # UNCHANGED
      mcp-server.ts       # UNCHANGED
      components/
        BrowserPanel.tsx  # MOVED from apps/web/features/browser
    dist/
      server.mjs
      desktop.mjs
      web.mjs
      mcp-server.mjs

apps/
  server/src/
    plugins/
      loader.ts           # NEW: discovers + activates server plugins
      static-server.ts    # NEW: serves web plugin bundles
      registry.ts         # NEW: plugin state management

  desktop/src/main/
    plugin-loader.ts      # NEW: discovers + activates desktop plugins
    index.ts              # MODIFIED: calls plugin loader instead of browser-backend directly

  web/src/
    lib/
      plugin-host.ts      # NEW: loads + activates web plugins at runtime
    components/
      PluginPanel.tsx     # NEW: error boundary wrapper for plugin components
```
