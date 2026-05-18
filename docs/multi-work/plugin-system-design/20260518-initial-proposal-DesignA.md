# Plugin System Design — Initial Proposal (Design A)

**Author:** Design Agent  
**Date:** 2026-05-18  
**Status:** Draft / RFC  

---

## 1. Executive Summary

This proposal defines a plugin system for Cradle that supports three extension points (server, web, desktop), distributes via npm, and maintains web-only deployability. The design draws from VS Code extensions (manifest-driven activation), Obsidian (simple lifecycle), and the existing `browser-use` plugin as a concrete reference implementation.

Key decisions:
- **Single package, multi-entry** — one npm package declares all three extension points via `package.json` fields
- **Runtime registration** for server plugins (loaded dynamically at server startup)
- **Build-time bundling** for web plugins (tree-shaken into the frontend bundle)
- **Optional desktop entry** activated only in Electron environments
- **Unix Domain Socket / IPC bridge** pattern preserved for desktop↔server communication

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Cradle Desktop App                       │
│                                                             │
│  ┌─────────────────┐   ┌──────────────────────────────────┐ │
│  │  Electron Main  │   │         Renderer (Web)           │ │
│  │                 │   │                                  │ │
│  │  DesktopPlugin  │   │  WebPlugin: panels, views, etc. │ │
│  │  (native APIs)  │   │                                  │ │
│  └────────┬────────┘   └──────────────┬───────────────────┘ │
│           │  UDS/IPC                   │  HTTP/WS            │
│           ▼                            ▼                     │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                   Elysia Server                          │ │
│  │                                                         │ │
│  │  ServerPlugin: routes, MCP tools, event handlers        │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Plugin Manifest

Plugins declare themselves through `package.json` fields under a `"cradle"` key. No separate manifest file — keeps tooling simple and avoids sync issues.

```jsonc
{
  "name": "@cradle/plugin-browser-use",
  "version": "1.0.0",
  "cradle": {
    // Plugin metadata
    "displayName": "Browser Use",
    "description": "In-app browser control via MCP tools",
    "icon": "./assets/icon.svg",
    
    // Extension points — each is optional
    "server": {
      "entry": "./dist/server.mjs",
      "activationEvents": ["onServerStart"]
    },
    "web": {
      "entry": "./dist/web.mjs",
      "activationEvents": ["onPanelOpen:browser"]
    },
    "desktop": {
      "entry": "./dist/desktop.mjs",
      "activationEvents": ["onServerStart"]
    },
    
    // Capabilities required from host
    "requires": {
      "cradle": ">=0.5.0",
      "capabilities": ["mcp-registry", "webview"]
    },
    
    // Capabilities provided to host
    "provides": {
      "mcpServers": ["browser-use"],
      "panels": ["browser"],
      "skills": ["browser-use"]
    },
    
    // Permissions (security boundary)
    "permissions": [
      "network",
      "filesystem:read",
      "native:webview"
    ]
  },
  
  // Standard exports for type consumers
  "exports": {
    "./server": "./dist/server.mjs",
    "./web": "./dist/web.mjs",
    "./desktop": "./dist/desktop.mjs",
    "./types": "./src/types.ts"
  }
}
```

### Design Decisions

| Choice | Rationale |
|--------|-----------|
| `package.json` over separate manifest | Single source of truth; npm already parses it; no extra resolution logic |
| `activationEvents` array | Lazy loading — plugins activate only when relevant (borrowed from VS Code) |
| `requires.capabilities` | Explicit dependency on host features; allows graceful degradation |
| `provides` declaration | Host can index available features without activating plugins |
| `permissions` array | Security boundary — host can deny activation if permissions not granted |

---

## 4. Extension Point Interfaces

### 4.1 Server Plugin API

```typescript
// @cradle/plugin-sdk/server

import type { Elysia } from 'elysia'

/** Context injected into server plugins at activation */
export interface ServerPluginContext {
  /** The Elysia app instance — plugins compose via .use() */
  app: Elysia
  
  /** Register an MCP server that the agent runtime can discover */
  registerMcpServer(config: McpServerConfig): void
  
  /** Register a SKILL.md for agent discovery */
  registerSkill(skill: SkillDefinition): void
  
  /** Subscribe to server lifecycle events */
  on<E extends keyof ServerEvents>(event: E, handler: ServerEvents[E]): Disposable
  
  /** Plugin-scoped logger */
  logger: Logger
  
  /** Plugin-scoped KV storage (persisted across restarts) */
  storage: PluginStorage
  
  /** Read host configuration */
  config: PluginConfig
}

export interface McpServerConfig {
  /** Unique MCP server name (used in agent tool discovery) */
  name: string
  /** Command to spawn the MCP server process */
  command: string
  /** Arguments to pass */
  args: string[]
  /** Environment variables */
  env?: Record<string, string>
  /** Whether to auto-register with agent runtime */
  autoRegister?: boolean
  /** Condition: only register when this returns true */
  when?: () => boolean | Promise<boolean>
}

export interface SkillDefinition {
  name: string
  description: string
  /** Path to SKILL.md content (relative to plugin root) */
  skillFile: string
}

export interface ServerEvents {
  'chat:turn-start': (ctx: { sessionId: string; threadId: string }) => void
  'chat:turn-end': (ctx: { sessionId: string; threadId: string; usage: TokenUsage }) => void
  'server:shutdown': () => void | Promise<void>
}

export interface Disposable {
  dispose(): void
}

/** The function a server plugin must default-export */
export type ServerPluginActivate = (ctx: ServerPluginContext) => void | Promise<void>

/** Optional deactivation hook */
export type ServerPluginDeactivate = () => void | Promise<void>

export interface ServerPlugin {
  activate: ServerPluginActivate
  deactivate?: ServerPluginDeactivate
}
```

### 4.2 Web Plugin API

```typescript
// @cradle/plugin-sdk/web

import type { ComponentType } from 'react'

/** Context injected into web plugins at activation */
export interface WebPluginContext {
  /** Register a panel (tab) in the main workspace */
  registerPanel(panel: PanelRegistration): Disposable
  
  /** Register a sidebar widget */
  registerSidebarWidget(widget: SidebarWidgetRegistration): Disposable
  
  /** Register a toolbar action */
  registerToolbarAction(action: ToolbarActionRegistration): Disposable
  
  /** Register a status bar item */
  registerStatusBarItem(item: StatusBarItemRegistration): Disposable
  
  /** Subscribe to frontend events */
  on<E extends keyof WebEvents>(event: E, handler: WebEvents[E]): Disposable
  
  /** Plugin-scoped API client (pre-configured with auth) */
  api: PluginApiClient
  
  /** Plugin-scoped local storage */
  storage: WebPluginStorage
}

export interface PanelRegistration {
  /** Unique panel ID */
  id: string
  /** Display title */
  title: string
  /** Icon component or icon name from icon set */
  icon: ComponentType<{ className?: string }> | string
  /** The panel content component */
  component: ComponentType<PanelProps>
  /** Where to show: 'main' | 'sidebar' | 'bottom' */
  location?: 'main' | 'sidebar' | 'bottom'
  /** Sort order within location */
  order?: number
}

export interface PanelProps {
  /** Whether the panel is currently visible/active */
  isActive: boolean
  /** Plugin-scoped storage */
  storage: WebPluginStorage
}

export interface WebEvents {
  'panel:activated': (panelId: string) => void
  'panel:deactivated': (panelId: string) => void
  'theme:changed': (theme: 'light' | 'dark') => void
}

/** The function a web plugin must default-export */
export type WebPluginActivate = (ctx: WebPluginContext) => void | Promise<void>

export interface WebPlugin {
  activate: WebPluginActivate
  deactivate?: () => void
}
```

### 4.3 Desktop Plugin API

```typescript
// @cradle/plugin-sdk/desktop

import type { BrowserWindow, WebContents } from 'electron'

/** Context injected into desktop plugins at activation */
export interface DesktopPluginContext {
  /** Electron app user data path */
  userDataPath: string
  
  /** Access the main BrowserWindow */
  getMainWindow(): BrowserWindow | null
  
  /** Listen for webview creation (for browser-like plugins) */
  onWebviewCreated(handler: (wc: WebContents, tabId: string) => void): Disposable
  
  /** Start an IPC socket server (for communication with MCP servers) */
  createSocketServer(options: SocketServerOptions): SocketServerHandle
  
  /** Register an IPC handler accessible from renderer */
  registerIpcHandler(channel: string, handler: IpcHandler): Disposable
  
  /** Plugin-scoped logger */
  logger: Logger
  
  /** Subscribe to desktop lifecycle events */
  on<E extends keyof DesktopEvents>(event: E, handler: DesktopEvents[E]): Disposable
}

export interface SocketServerOptions {
  /** Socket filename (placed in userDataPath) */
  socketName: string
  /** Handler for incoming commands */
  onCommand: (cmd: unknown) => Promise<unknown>
}

export interface SocketServerHandle {
  /** Full path to the active socket */
  socketPath: string
  /** Stop the server and clean up */
  stop(): Promise<void>
}

export interface DesktopEvents {
  'window:created': (win: BrowserWindow) => void
  'window:closed': (win: BrowserWindow) => void
  'app:before-quit': () => void | Promise<void>
}

export type IpcHandler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>

/** The function a desktop plugin must default-export */
export type DesktopPluginActivate = (ctx: DesktopPluginContext) => void | Promise<void>

export interface DesktopPlugin {
  activate: DesktopPluginActivate
  deactivate?: () => void | Promise<void>
}
```

---

## 5. Plugin Discovery & Loading

### 5.1 Discovery

Plugins are discovered from two sources:

1. **Workspace plugins** — listed in `pnpm-workspace.yaml` under `plugins/*` (current approach)
2. **Installed plugins** — npm packages matching `@cradle/plugin-*` or `cradle-plugin-*` in `node_modules`

Discovery happens at build time (for web plugins) and at runtime (for server/desktop plugins):

```typescript
// Plugin registry (server-side)
interface PluginRegistry {
  /** Scan node_modules and workspace for cradle plugins */
  discover(): Promise<PluginManifest[]>
  
  /** Activate a plugin's server entry */
  activateServer(manifest: PluginManifest, ctx: ServerPluginContext): Promise<void>
  
  /** Get all registered MCP servers */
  getMcpServers(): McpServerConfig[]
  
  /** Get all registered skills */
  getSkills(): SkillDefinition[]
}
```

### 5.2 Server Plugin Loading (Runtime)

```typescript
// In apps/server/src/plugin-loader.ts (new file)

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export async function loadServerPlugins(app: Elysia): Promise<void> {
  const manifests = await discoverPlugins()
  
  for (const manifest of manifests) {
    if (!manifest.cradle.server) continue
    
    const entryPath = resolve(manifest.packageDir, manifest.cradle.server.entry)
    const plugin = await import(entryPath) as ServerPlugin
    
    const ctx = createServerPluginContext(app, manifest)
    await plugin.activate(ctx)
    
    // Store deactivation hook for graceful shutdown
    if (plugin.deactivate) {
      registerShutdownHook(manifest.name, plugin.deactivate)
    }
  }
}
```

### 5.3 Web Plugin Loading (Build-time)

Web plugins are more complex because they involve React components that must be bundled.

**Approach: Virtual module + dynamic import**

At build time, a Vite plugin scans for web plugin manifests and generates a virtual module:

```typescript
// vite-plugin-cradle-plugins.ts
export function cradlePlugins(): Plugin {
  return {
    name: 'cradle-plugins',
    resolveId(id) {
      if (id === 'virtual:cradle-plugins') return '\0virtual:cradle-plugins'
    },
    load(id) {
      if (id === '\0virtual:cradle-plugins') {
        const manifests = discoverPluginsSync()
        const webPlugins = manifests.filter(m => m.cradle.web)
        
        // Generate dynamic imports for code splitting
        const imports = webPlugins.map((m, i) => 
          `const p${i} = () => import('${m.cradle.web!.entry}')`
        )
        
        return `
          ${imports.join('\n')}
          export const plugins = [
            ${webPlugins.map((m, i) => `{ id: '${m.name}', load: p${i}, manifest: ${JSON.stringify(m.cradle)} }`).join(',\n')}
          ]
        `
      }
    }
  }
}
```

In the web app, a `PluginHost` component loads and activates web plugins:

```typescript
// apps/web/src/lib/plugin-host.tsx
import { plugins } from 'virtual:cradle-plugins'

export function usePluginRegistry() {
  const [panels, setPanels] = useState<PanelRegistration[]>([])
  
  useEffect(() => {
    for (const plugin of plugins) {
      plugin.load().then(mod => {
        const ctx = createWebPluginContext(plugin.id, { setPanels })
        mod.activate(ctx)
      })
    }
  }, [])
  
  return { panels }
}
```

### 5.4 Desktop Plugin Loading (Runtime)

```typescript
// In apps/desktop/src/main/plugin-loader.ts (new file)

export async function loadDesktopPlugins(mainWindow: BrowserWindow): Promise<void> {
  const manifests = await discoverPlugins()
  
  for (const manifest of manifests) {
    if (!manifest.cradle.desktop) continue
    
    const entryPath = resolve(manifest.packageDir, manifest.cradle.desktop.entry)
    const plugin = await import(entryPath) as DesktopPlugin
    
    const ctx = createDesktopPluginContext(manifest, mainWindow)
    await plugin.activate(ctx)
  }
}
```

---

## 6. Communication Between Plugin Parts

Plugins often have components in multiple layers that need to communicate. The pattern follows what `browser-use` already does:

### Server ↔ Desktop

**Unix Domain Socket** — desktop plugin creates a socket server, server plugin spawns an MCP process that connects to it.

```
Desktop Plugin                    Server Plugin (via MCP server process)
     │                                     │
     │ createSocketServer()                │
     │ ──────────────────────►             │
     │                                     │
     │         ◄── connect() ──────────────│
     │                                     │
     │         ◄── command ────────────────│
     │ ────── response ───────────────────►│
```

The `DesktopPluginContext.createSocketServer()` abstracts the boilerplate that `browser-backend.ts` currently implements manually.

### Server ↔ Web

**HTTP + WebSocket** — the standard path. Server plugins register routes via `app.use()`. Web plugins call those routes via the typed API client.

```typescript
// Server plugin: adds a route
ctx.app.get('/api/plugins/browser-use/tabs', () => { ... })

// Web plugin: calls it
const tabs = await ctx.api.get('/api/plugins/browser-use/tabs')
```

For real-time updates, plugins can use the existing WebSocket infrastructure or SSE.

### Web ↔ Desktop

**IPC (Electron only)** — desktop plugins register IPC handlers, web plugins can invoke them through a `window.electronAPI` bridge (already in Cradle's preload).

For web-only deployments, desktop IPC calls should gracefully no-op or fall back to server-side alternatives.

---

## 7. Lifecycle

```
┌──────────┐     ┌────────────┐     ┌──────────┐     ┌─────────────┐
│ Discover │ ──► │ Validate   │ ──► │ Activate │ ──► │ Deactivate  │
│          │     │ (perms,    │     │ (lazy or │     │ (on server  │
│          │     │  compat)   │     │  eager)  │     │  shutdown)  │
└──────────┘     └────────────┘     └──────────┘     └─────────────┘
```

### Activation Events

| Event | Trigger |
|-------|---------|
| `onServerStart` | Server is starting — activate immediately |
| `onPanelOpen:{id}` | User opens a specific panel |
| `onCommand:{id}` | User/agent invokes a specific command |
| `onChatStart` | A new chat session begins |
| `*` | Always activate (eager) |

### Deactivation

Plugins are deactivated:
1. On server/app shutdown (graceful)
2. When the user disables a plugin (runtime toggle)
3. On error (with retry backoff for transient failures)

---

## 8. Security Model

### Permissions

Permissions are declared in the manifest and checked at activation:

| Permission | Grants |
|-----------|--------|
| `network` | Make outbound HTTP requests |
| `filesystem:read` | Read files on disk |
| `filesystem:write` | Write files on disk |
| `native:webview` | Access Electron webview APIs |
| `native:shell` | Execute shell commands |
| `mcp-registry` | Register MCP servers with agent |
| `storage` | Access plugin-scoped persistent storage |

### Sandboxing Strategy

**Phase 1 (MVP):** Trust-based — plugins run in the same process. Permissions are declarative (for user awareness) but not enforced at runtime.

**Phase 2:** Server plugins run in isolated worker threads with controlled `require()`. Web plugins are naturally sandboxed by the browser. Desktop plugins remain trusted (same as VS Code model).

**Phase 3:** Optional V8 isolate sandboxing for server plugins (similar to Cloudflare Workers).

### Rationale for phased approach

Full sandboxing adds significant complexity (IPC overhead, async boundaries, limited API surface). Since Cradle plugins are currently all first-party or trusted, the permission declaration serves primarily as documentation and future enforcement hook. This matches VS Code's model: extensions declare permissions but run in a trusted process.

---

## 9. Versioning & Compatibility

### Host Compatibility

```jsonc
{
  "cradle": {
    "requires": {
      "cradle": ">=0.5.0"  // semver range
    }
  }
}
```

The plugin loader rejects plugins whose `requires.cradle` range doesn't match the running Cradle version.

### Plugin SDK Versioning

The `@cradle/plugin-sdk` package is versioned independently. Breaking changes to the plugin API result in a major version bump. Plugins declare their SDK dependency:

```jsonc
{
  "peerDependencies": {
    "@cradle/plugin-sdk": "^1.0.0"
  }
}
```

### API Stability Tiers

| Tier | Guarantee |
|------|-----------|
| **Stable** | No breaking changes in minor versions |
| **Beta** | May change in minor versions; opt-in via capability flag |
| **Internal** | No stability guarantee; only for first-party plugins |

---

## 10. Browser-Use Under the New System

Here's how the existing `browser-use` plugin would look refactored to the new plugin system:

### Package Structure

```
plugins/browser-use/
├── package.json          # manifest with "cradle" field
├── SKILL.md             # agent skill documentation
├── src/
│   ├── server.ts        # ServerPlugin: registers MCP server + skill
│   ├── desktop.ts       # DesktopPlugin: socket server + CDP handling
│   ├── web.tsx          # WebPlugin: browser panel UI
│   ├── protocol.ts      # Shared types (unchanged)
│   └── mcp-server.ts   # MCP stdio process (unchanged)
└── dist/
    ├── server.mjs
    ├── desktop.mjs
    ├── web.mjs
    └── mcp-server.mjs
```

### `server.ts`

```typescript
import type { ServerPlugin, ServerPluginContext } from '@cradle/plugin-sdk/server'

export const activate: ServerPlugin['activate'] = async (ctx: ServerPluginContext) => {
  // Register the MCP server with the agent runtime
  ctx.registerMcpServer({
    name: 'browser-use',
    command: 'node',
    args: [new URL('./mcp-server.mjs', import.meta.url).pathname],
    env: { BROWSER_BACKEND_SOCKET: ctx.config.get('socketPath') ?? '' },
    // Only register if the desktop socket is available
    when: () => !!ctx.config.get('socketPath'),
  })
  
  // Register the skill for agent discovery
  ctx.registerSkill({
    name: 'browser-use',
    description: 'Control Cradle in-app browser via MCP tools',
    skillFile: './SKILL.md',
  })
  
  ctx.logger.info('browser-use server plugin activated')
}

export const deactivate: ServerPlugin['deactivate'] = () => {
  // MCP server process cleanup is handled by the runtime
}
```

### `desktop.ts`

```typescript
import type { DesktopPlugin, DesktopPluginContext } from '@cradle/plugin-sdk/desktop'
import { handleBrowserCommand } from './browser-commands'

export const activate: DesktopPlugin['activate'] = async (ctx: DesktopPluginContext) => {
  // Create the socket server (replaces manual createServer() boilerplate)
  const server = ctx.createSocketServer({
    socketName: 'browser-backend.sock',
    onCommand: async (cmd) => handleBrowserCommand(cmd, ctx),
  })
  
  // Notify server plugin of socket path via shared config
  // (The host propagates this as BROWSER_BACKEND_SOCKET env var)
  
  // Track webview creation for CDP access
  ctx.onWebviewCreated((wc, tabId) => {
    registerWebviewForBrowsing(wc, tabId)
  })
  
  ctx.logger.info(`browser-use desktop plugin activated, socket: ${server.socketPath}`)
}
```

### `web.tsx`

```typescript
import type { WebPlugin, WebPluginContext } from '@cradle/plugin-sdk/web'
import { BrowserPanel } from './components/BrowserPanel'
import { GlobeIcon } from './components/icons'

export const activate: WebPlugin['activate'] = (ctx: WebPluginContext) => {
  ctx.registerPanel({
    id: 'browser',
    title: 'Browser',
    icon: GlobeIcon,
    component: BrowserPanel,
    location: 'main',
    order: 100,
  })
}
```

### What Changes vs. Current

| Aspect | Current | New System |
|--------|---------|------------|
| MCP registration | Hardcoded in `claude-agent/provider.ts` | Declarative via `ctx.registerMcpServer()` |
| Socket server | Manual in `browser-backend.ts` | `ctx.createSocketServer()` |
| Webview tracking | Manual in `browser-backend.ts` | `ctx.onWebviewCreated()` |
| Skill registration | File discovery by convention | `ctx.registerSkill()` |
| Web UI | Hardcoded in `features/browser/` | `ctx.registerPanel()` |
| Activation | Always loaded | Lazy via `activationEvents` |

---

## 11. Distribution

### Development (Workspace Plugins)

```yaml
# pnpm-workspace.yaml
packages:
  - plugins/*  # workspace plugins discovered here
```

### Publishing

```bash
# Publish to npm
cd plugins/browser-use
pnpm publish --access public
```

### Installing Third-Party Plugins

```bash
# User installs a plugin
pnpm add @cradle/plugin-weather -w

# Or via Cradle UI/CLI
cradle plugin install @cradle/plugin-weather
```

The `cradle plugin install` command:
1. Runs `pnpm add` in the workspace root
2. Validates the manifest
3. Checks permissions (prompts user if new permissions needed)
4. Triggers plugin discovery on next server start

### Plugin Resolution Order

1. `plugins/*` workspace packages (highest priority — local development)
2. `node_modules/@cradle/plugin-*`
3. `node_modules/cradle-plugin-*`

---

## 12. SDK Package Structure

```
packages/plugin-sdk/
├── package.json
├── src/
│   ├── server.ts     # ServerPlugin types + context
│   ├── web.ts        # WebPlugin types + context
│   ├── desktop.ts    # DesktopPlugin types + context
│   ├── shared.ts     # Shared types (Disposable, Logger, etc.)
│   └── index.ts      # Re-exports
└── dist/
```

The SDK package is **types-only** for server/desktop (runtime context is injected by the host). For web plugins, it may include React hooks and utilities.

---

## 13. Open Questions & Tradeoffs

### Open Questions

1. **Plugin settings UI** — Should plugins declare their own settings schema (JSON Schema) that the host renders automatically? Or do plugins register their own settings panel?

2. **Inter-plugin dependencies** — Can plugins depend on other plugins? (e.g., a "browser-automation" plugin building on "browser-use") If so, what's the dependency resolution order?

3. **Hot reload in dev** — Should plugin activation support HMR during development? The server plugin loader could watch for file changes and re-activate, but state management across reloads is complex.

4. **Plugin marketplace** — Is a curated registry needed, or is npm sufficient? npm has discoverability challenges for domain-specific plugins.

5. **State persistence across plugin updates** — When a plugin updates, how is its stored data migrated? Should the SDK provide a migration hook?

### Tradeoffs Made

| Tradeoff | Choice | Alternative Considered | Why |
|----------|--------|----------------------|-----|
| Discovery mechanism | npm packages + workspace glob | Custom registry / plugin store | npm is battle-tested; avoids building infrastructure |
| Web plugin loading | Build-time bundling via Vite plugin | Runtime `<script>` injection | Type safety, tree-shaking, better DX; tradeoff is plugins can't be added without rebuild |
| Server plugin loading | Dynamic `import()` at runtime | Build-time bundling | Plugins can be added without rebuilding server; tradeoff is slightly slower startup |
| Sandboxing | Phased (trust → workers → isolates) | Full sandboxing from day one | Pragmatic; full sandboxing blocks shipping for months |
| Desktop as optional | Graceful degradation | Required desktop component | Must work in web-only deployment |
| Communication pattern | Socket (desktop↔server), HTTP (server↔web) | All-IPC or all-HTTP | Matches existing architecture; sockets for low-latency native access |

### Known Limitations

- **Web plugins require a rebuild** to be picked up. This is acceptable for shipped plugins but limits dynamic plugin installation in production. Future work could add a runtime module federation approach.
- **No plugin isolation** in Phase 1 — a buggy plugin can crash the server. Mitigation: good error boundaries + plugin health monitoring.
- **Desktop plugins are Node.js only** — they run in Electron main process. This is inherent to the architecture.

---

## 14. Implementation Roadmap (Suggested)

| Phase | Scope | Effort |
|-------|-------|--------|
| **Phase 0** | `@cradle/plugin-sdk` package with types only | Small |
| **Phase 1** | Server plugin loader + refactor browser-use | Medium |
| **Phase 2** | Desktop plugin loader + extract browser-backend | Medium |
| **Phase 3** | Web plugin loader (Vite plugin + PluginHost) | Medium |
| **Phase 4** | Plugin settings, storage, marketplace | Large |
| **Phase 5** | Sandboxing, permission enforcement | Large |

Phase 0-2 can be done incrementally without breaking existing functionality — the current hardcoded integrations continue to work while the plugin system is built alongside them.

---

## 15. Prior Art Comparison

| System | Strengths We Borrow | Differences |
|--------|---------------------|-------------|
| **VS Code Extensions** | Manifest-driven activation events, contribution points model, extension host isolation | We don't need a separate extension host process (yet); simpler lifecycle |
| **Obsidian Plugins** | Simple activate/deactivate lifecycle, single entry point | We need three entry points; they're web-only |
| **Raycast Extensions** | npm distribution, React-based UI contributions | They're fully sandboxed; we start trusted |
| **Figma Plugins** | iframe sandboxing for UI, main thread for logic | We use process-level separation (Electron main vs renderer) |
| **Tauri Plugins** | Rust host + JS guest model, permission system | Similar architecture but different tech stack |

---

## 16. Summary

This design provides:
- **Clear ownership** — each plugin owns its manifest, lifecycle, and namespace
- **Progressive complexity** — start with server plugins (simplest), add web/desktop later
- **Backwards compatible** — can be introduced without breaking current code
- **Type-safe** — full TypeScript contracts for all extension points
- **Distributable** — standard npm packages, no custom infrastructure
- **Web-safe** — desktop entry is always optional; web deployments work without it

The existing `browser-use` plugin validates the architecture: it naturally decomposes into three concerns (MCP tools → server, CDP control → desktop, browser panel → web) that map cleanly to the three extension points.
