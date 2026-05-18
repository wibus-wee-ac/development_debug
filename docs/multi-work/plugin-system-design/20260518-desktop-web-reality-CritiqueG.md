# Desktop-Web Reality Audit — Critique G

**Author:** Follow-up Audit Agent  
**Date:** 2026-05-18  
**Status:** Architecture Reassessment  
**Inputs:** Final Synthesis E + Critique F + Actual app structure + User correction  
**Trigger:** User clarified: Cradle is ALWAYS desktop+web together. The Electron renderer IS `apps/web`. There is no "web-only" deployment.

---

## 0. The Reality

From `electron.vite.config.ts`:

```typescript
const webRoot = resolve(__dirname, '../web')

renderer: {
  root: webRoot,  // ← apps/web IS the Electron renderer
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    rollupOptions: {
      input: resolve(webRoot, 'index.html'),
    },
  },
}
```

From `apps/desktop/src/main/index.ts`:

```typescript
if (process.env.ELECTRON_RENDERER_URL) {
  await win.loadURL(process.env.ELECTRON_RENDERER_URL)  // dev: vite dev server
} else {
  await win.loadFile(join(__dirname, '../renderer/index.html'))  // prod: bundled
}
```

**Conclusion:** `apps/web` has no independent production deployment. It either:
- Runs as the Electron renderer (production)
- Runs as a standalone Vite dev server on port 5174 (development convenience only)

The `apps/web/vite.config.ts` is a **dev-time convenience** — not a production deployment target.

---

## 1. Does the "web plugin" layer make sense?

**Yes, but rename it to "renderer plugin."**

The mental model should be:
- **Server entry** — runs in the forked Node.js server process
- **Desktop entry** — runs in Electron main process
- **Renderer entry** — runs in the Electron renderer (which happens to be a web app)

The "web plugin" concept is architecturally correct — it's code that runs in the browser context (renderer process). It registers React components, interacts with DOM APIs, talks to the server via HTTP. The fact that this browser context lives inside Electron doesn't change what the code does.

**What changes:** Remove any design logic that accounts for "what if there's no Electron." The renderer CAN assume:
- `window.electronAPI` (preload bridge) is always available
- IPC to main process is always available
- The server is always local (no CORS, no auth needed for plugin routes)

**Concrete change to manifest:**

```diff
- "deployments": ["desktop"],
+ // Remove entirely. There's only one deployment mode.
```

**Concrete change to renderer plugin context:**

```typescript
interface RendererPluginContext {
  // ... existing panel/widget registration ...
  
  // NEW: Direct access to Electron preload bridge
  // Always available — no need for "isElectron" checks
  ipc: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>
    on(channel: string, handler: (...args: unknown[]) => void): Disposable
  }
}
```

---

## 2. Import maps still needed?

**It depends on when plugins are loaded.**

### Scenario A: Plugins bundled at build time (by electron-vite)

If renderer plugins are discovered and bundled during the `electron-vite build` step:
- No import maps needed — Vite resolves `react`, `react-dom` at build time
- No dynamic `import()` at runtime
- Simpler, faster, no cache issues with stable chunk filenames

**Trade-off:** Plugins must be present at build time. Can't install a plugin and use it without rebuilding the renderer.

### Scenario B: Plugins loaded at runtime via dynamic `import()` (current design)

Even inside Electron, the renderer is still a browser environment. Bare specifiers (`import { useState } from 'react'`) don't resolve without either:
- An import map, OR
- The plugin pre-bundled with React externalized and mapped to the host's React instance

**Trade-off:** Supports hot-install (add plugin → restart → works), but needs the import map machinery.

### Verdict: Keep runtime loading + import maps. Here's why.

The value prop of plugins is "drop a folder into `plugins/`, restart, it works." If plugins require a renderer rebuild, the DX is:
1. Install plugin
2. Run `electron-vite build`  
3. Restart app

vs. with runtime loading:
1. Install plugin
2. Restart app

For first-party plugins (like browser-use), build-time bundling is fine. But the architecture should support runtime loading to not paint itself into a corner. The import map cost is ~20 lines of config.

**Simplification possible:** Since the renderer is always served locally (either Vite dev server or Electron's `file://` protocol), the import map can use **relative paths** instead of absolute URLs. No CORS, no CDN concerns.

```html
<script type="importmap">
{
  "imports": {
    "react": "./assets/react-vendor.js",
    "react-dom": "./assets/react-vendor.js", 
    "react/jsx-runtime": "./assets/react-vendor.js"
  }
}
</script>
```

---

## 3. Three-entry-point architecture still valid?

**Yes. The three entry points map to three OS-level processes.**

```
┌─────────────────────────────────────────────────┐
│ Process 1: Electron Main (Node.js)              │
│   → desktop entry: system APIs, IPC, lifecycle  │
├─────────────────────────────────────────────────┤
│ Process 2: Forked Server (Node.js)              │
│   → server entry: routes, MCP, hooks            │
├─────────────────────────────────────────────────┤
│ Process 3: Renderer (Chromium)                  │
│   → renderer entry: React UI, panels            │
└─────────────────────────────────────────────────┘
```

This is not "web vs desktop" — it's "three process boundary = three plugin entry points." Each entry runs in a different execution context with different available APIs. This remains correct regardless of whether Electron is always present.

**Rename for clarity:**

| Old Name | New Name | Process |
|----------|----------|---------|
| `cradle.server` | `cradle.server` | Server (forked Node) |
| `cradle.desktop` | `cradle.main` | Electron main |
| `cradle.web` | `cradle.renderer` | Electron renderer |

The rename removes the false implication that "web" might run independently. "Renderer" is precise.

**Manifest change:**

```diff
  "cradle": {
    "server": "./dist/server.mjs",
-   "web": "./dist/web.mjs",
-   "desktop": "./dist/desktop.mjs",
+   "renderer": "./dist/renderer.mjs",
+   "main": "./dist/main.mjs",
  }
```

---

## 4. Static serving of web plugins — still needed?

**Yes, but the serving path is simpler.**

The current design: Server serves plugin web bundles at `GET /api/plugins/:name/web.mjs`. The renderer fetches and dynamically imports them.

In the always-Electron context, we have two options:

### Option A: Server serves plugin bundles (current design)
```
Renderer → HTTP GET /api/plugins/browser-use/renderer.mjs → dynamic import()
```
- Works in both dev (Vite dev server proxies to API) and prod
- Plugin bundles are self-contained `.mjs` files
- Server already exists, already serves files

### Option B: Electron main serves plugin bundles via custom protocol
```
Renderer → import('cradle-plugin://browser-use/renderer.mjs')
```
- Bypasses HTTP entirely
- Direct file:// loading from plugin directory
- Requires `protocol.registerSchemesAsPrivileged()` before app ready

### Option C: electron-vite bundles plugins at build time
```
Renderer → import('./plugins/browser-use/renderer.mjs')  // static import in bundle
```
- Fastest: no runtime discovery, no network, fully tree-shaken
- Breaks hot-install

### Verdict: Keep Option A (server serves bundles).

Reasoning:
- It already works for both dev and prod
- The server process needs to know about plugins anyway (for routes/MCP)
- No custom protocol complexity
- HTTP serving is ~3 lines of Elysia code
- Dev mode: Vite proxy handles it transparently

**Minor simplification:** Since the server is always `localhost`, no auth/CORS headers needed on plugin asset serving. The `static-server.ts` can be dead simple:

```typescript
app.get('/api/plugins/:name/renderer.mjs', async ({ params }) => {
  const pluginDir = resolve(pluginsDir, params.name)
  return Bun.file(resolve(pluginDir, 'dist/renderer.mjs'))
})
```

---

## 5. `onWebviewCreated` coordination across IPC

**Current situation:**
- `onWebviewCreated` is in the Desktop (main process) plugin context
- Browser panel UI is a React component registered by the Renderer plugin entry

**Question:** Does the plugin need IPC coordination between these two?

**Answer: Yes, but it's already designed correctly.**

The browser-use plugin:
- **Main entry:** Receives `webContents` from `did-attach-webview`, starts CDP socket server, sets `BROWSER_BACKEND_SOCKET` env
- **Server entry:** Connects to the CDP socket, registers MCP server for agent use
- **Renderer entry:** Renders the `<webview>` tag and browser panel UI

The coordination flow is:
1. Renderer creates `<webview>` tag (renderer entry)
2. Electron emits `did-attach-webview` (handled by main entry)
3. Main entry starts CDP control over that webview
4. Server entry (in a different process) connects via Unix socket

**What changes with the "always Electron" insight:**

The renderer plugin can DIRECTLY use `window.electronAPI` to coordinate with main, instead of going through the server:

```typescript
// In renderer plugin activate():
export function activate(ctx: RendererPluginContext) {
  ctx.registerPanel({
    id: 'browser',
    component: BrowserPanel,
    location: 'main',
  })

  // Direct IPC to main process — no server round-trip needed
  ctx.ipc.invoke('browser-use:get-status').then(status => {
    // Update panel state
  })
}
```

This is simpler than the alternative (renderer → HTTP → server → ???) for main-process state. The server is only involved for agent-facing APIs (MCP tools, routes).

---

## 6. Simplifications now that Electron is always present

### 6.1 Remove `deployments` field — CONFIRMED

Dead weight. One deployment mode. Remove from manifest schema and all validation logic.

### 6.2 Renderer plugins can use preload bridge directly

No need for a "fallback mode" where plugins work without `window.electronAPI`. The SDK types can include IPC helpers:

```typescript
interface RendererPluginContext {
  /** IPC bridge to Electron main process. Always available. */
  ipc: ElectronIPC
  
  /** App metadata from main process */
  app: { version: string; dataDir: string; isDev: boolean }
}
```

### 6.3 Plugin discovery can share results across processes

Currently the design has each process independently calling `discoverPlugins()` on the same directory. Since Electron main forks the server:

```
Main: discoverPlugins() → manifests[]
        ↓ (pass via fork env or arg)
Server: parse manifests from env/arg → skip redundant fs scan
```

**Actually, don't do this.** The current "independent discovery" design is simpler and correct. Each process reads the same `plugins/` directory. The scan is <5ms for <10 plugins. Sharing would add complexity for negligible perf gain. Leave as-is.

### 6.4 No CORS or auth on plugin asset routes

Server plugin assets (`/api/plugins/:name/renderer.mjs`) are always served to `localhost` from the same machine. No need for:
- CORS headers (same-origin in Electron, or localhost in dev)
- Authentication tokens
- Cache-control headers (local file serving)

### 6.5 `sharedConfig` via env vars is fine — simpler than alternatives

With always-Electron, we could imagine using IPC for config sharing. But env vars at fork time are simpler, debuggable (`printenv | grep CRADLE_PLUGIN`), and require no protocol design. The Critique F concern about "fragile at scale" is valid at 10+ plugins, but:
- We're at 1 plugin
- Env vars work for browser-use's needs (socket path string)
- When it breaks, replace with a file-based config or IPC — not now

### 6.6 Rename throughout for clarity

| Before | After | Rationale |
|--------|-------|-----------|
| "web plugin" | "renderer plugin" | It's the renderer process, not a standalone web app |
| `cradle.web` | `cradle.renderer` | Manifest key |
| `cradle.desktop` | `cradle.main` | Aligns with Electron terminology |
| `WebPluginContext` | `RendererPluginContext` | Type name in SDK |
| `DesktopPluginContext` | `MainPluginContext` | Type name in SDK |
| `web.mjs` | `renderer.mjs` | Entry file convention |
| `desktop.mjs` | `main.mjs` | Entry file convention |
| `loadWebPlugins()` | `loadRendererPlugins()` | Function name |
| `activateDesktopPlugins()` | `activateMainPlugins()` | Function name |

---

## 7. Final Verdict

### Architecture is sound. Naming was misleading.

The three-entry-point model is correct — it maps to three OS processes with different APIs. The design just needs to stop pretending "web" is a standalone deployment target.

### Summary of Changes

| Change | Impact | Effort |
|--------|--------|--------|
| Remove `deployments` field | Simplifies manifest, removes dead validation | Trivial |
| Rename `web` → `renderer`, `desktop` → `main` | Clarity, no behavioral change | Find-and-replace |
| Add IPC bridge to RendererPluginContext | Renderer plugins can talk to main directly | ~30 lines |
| Remove "what if no Electron" fallback paths | Less code, fewer branches | Deletion |
| Keep import maps | Still needed for runtime bare specifier resolution | No change |
| Keep server-served plugin assets | Simplest serving mechanism | No change |
| Keep independent discovery per process | Simpler than sharing | No change |

### What stays exactly the same

- Three entry points (server, main, renderer) — just renamed
- Server routes composed before `listen()`
- Import maps for React resolution in renderer plugins
- Runtime `import()` for plugin loading
- Plugin storage in SQLite
- MCP registry bridging to agent provider
- Env var config passing at fork time
- `discoverPlugins()` reads `plugins/*/package.json`

### The design was 95% correct. The 5% was naming and phantom flexibility.
