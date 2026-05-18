# Plugin System Design — Blocker Critique D

**Author:** Critique Agent  
**Date:** 2026-05-18  
**Input:** Synthesis C (Refined)  
**Status:** Review

---

## Summary Verdict

The Synthesis C design is significantly better than a typical first-pass plugin system — it's pragmatic about scope, honest about what v0.1 can deliver, and avoids the premature abstraction trap. However, **6 hard blockers and 4 design decisions** remain that will stop or derail implementation if not resolved before coding starts.

---

## 🔴 Hard Blockers

### 1. Elysia Does NOT Support Dynamic Route Addition After `app.listen()`

**Issue:** The design proposes that server plugins call `app.use(pluginApp)` during activation. But in the current codebase, `createServerApp()` builds the entire Elysia app, then `app.listen()` is called in `bootstrap()` (see `apps/server/src/index.ts` lines 14-16). Elysia compiles its route trie at listen time. Routes added after `.listen()` are **not registered** — they return 404.

The design says "Activate server plugins" but doesn't specify when relative to `app.listen()`. If plugin discovery + activation happens inside `createServerApp()` (before listen), it works. If it happens after listen (e.g., async discovery), it silently fails.

**Why it blocks:** A plugin that registers routes via `ctx.app = pluginApp; mainApp.use(pluginApp)` after the server is already listening will have dead routes. No errors thrown — just 404s. This is the kind of bug that takes hours to debug.

**Severity:** 🔴

**Suggested resolution:** Plugin discovery and server plugin activation MUST happen inside `createServerApp()`, before returning the app instance. The boot sequence becomes:

```typescript
export async function createServerApp() {  // Make async
  const app = new Elysia(...)
  // ... existing .use() calls ...
  
  // Plugin loading happens HERE, before return
  const plugins = await discoverPlugins(workspaceRoot)
  for (const manifest of plugins) {
    const pluginApp = new Elysia({ prefix: `/api/plugins/${manifest.name}` })
    await activateServerPlugin(manifest, { app: pluginApp, ... })
    app.use(pluginApp)
  }
  
  return app  // THEN caller does app.listen()
}
```

This requires making `createServerApp()` async, which requires updating `bootstrap()` in `index.ts`.

---

### 2. Server Runs as a Forked Child Process — `sharedConfig` Cannot Cross Process Boundary

**Issue:** The design states "Desktop plugins activate before server plugins" and desktop plugins write to `sharedConfig` which server plugins then read. But looking at `apps/desktop/src/main/server-process.ts`, the server runs as a **forked child process** (`fork(serverEntry, [])`). The desktop plugin's `ctx.setSharedConfig()` writes to memory in the Electron main process. The server plugin's `ctx.sharedConfig.get()` reads from... where? A different process.

The design never specifies the transport mechanism for the shared config bus across the process boundary.

**Why it blocks:** `setSharedConfig` in the desktop plugin has no way to reach the server plugin's memory without an explicit IPC mechanism. The design implicitly assumes they share a process — they don't.

**Severity:** 🔴

**Suggested resolution:** Two options:

**Option A (Simplest):** Environment variables. Desktop plugin computes values, the desktop host injects them as env vars when forking the server process. This is exactly what happens today with `BROWSER_BACKEND_SOCKET`:

```typescript
// server-process.ts already does this:
env: {
  BROWSER_BACKEND_SOCKET: getBrowserBackendSocketPath(),
}
```

Make `sharedConfig` a fancy wrapper over env vars set at fork time. This means desktop plugins must finish activation BEFORE the server process is forked.

**Option B:** File-based. Desktop plugin writes to `{userDataPath}/.plugin-config/{pluginName}.json`. Server reads at activation. Simple, no IPC needed.

Option A is the natural fit since it mirrors the existing pattern, but it constrains the activation order further: desktop plugins must fully activate before `startServer()` is called.

---

### 3. `registerMcpServer` Has No Path to the Claude Agent Provider

**Issue:** The design shows `ctx.registerMcpServer(config)` as a plugin API, but there's no actual mechanism to inject these registrations into the Claude agent provider. Looking at the current code (`provider.ts` lines 120-128), MCP servers are hardcoded per-request:

```typescript
if (process.env.BROWSER_BACKEND_SOCKET) {
  queryOptions.mcpServers = {
    'browser-use': { command: 'node', args: [...] }
  }
}
```

The `mcpServers` field is built fresh on each `query()` call from `Options`. There's no "registry" that gets consulted — it's a literal object constructed in the provider method.

`registerMcpServer()` presumably writes to some global registry. But who reads it? The provider constructs `queryOptions` independently. There's no hook point where the provider says "give me all registered MCP servers."

**Why it blocks:** You can implement `registerMcpServer()` to store configs in a Map. But unless the Claude agent provider is modified to read from that Map, the MCP server will never actually be wired into agent sessions.

**Severity:** 🔴

**Suggested resolution:** Define the actual integration point:

```typescript
// New: apps/server/src/plugins/mcp-registry.ts
const mcpRegistry = new Map<string, McpServerConfig>()

export function registerMcpServer(config: McpServerConfig) {
  mcpRegistry.set(config.name, config)
}

export function getRegisteredMcpServers(): Record<string, McpServerConfig> {
  return Object.fromEntries(
    [...mcpRegistry.entries()]
      .filter(([_, c]) => !c.when || c.when())
      .map(([name, c]) => [name, { command: c.command, args: c.args, env: c.env }])
  )
}
```

Then modify the Claude agent provider:

```typescript
// In provider.ts, replace hardcoded browser-use with:
import { getRegisteredMcpServers } from '../../plugins/mcp-registry'
queryOptions.mcpServers = { ...queryOptions.mcpServers, ...getRegisteredMcpServers() }
```

This is straightforward but the design doesn't mention it. Without this, `registerMcpServer` is a no-op.

---

### 4. Web Plugin React Instance Sharing — Unsolved

**Issue:** The design says web plugins have `react` as a `peerDependency` and it's marked `external` in the Vite build. This means the plugin's `dist/web.mjs` contains:

```javascript
import { useState } from 'react'
```

When the browser runtime-`import()`s this module from `/api/plugins/browser-use/web.mjs`, the browser's module loader tries to resolve `'react'`. This fails with:

```
Uncaught TypeError: Failed to resolve module specifier "react"
```

Bare specifiers (`react`, `react-dom`) don't work in browser native ES modules without an import map.

The host app's React is bundled by Vite into a hashed chunk (`react-BxG7s8.js`). The plugin's `import { useState } from 'react'` has no way to find it.

**Why it blocks:** The plugin's web entry will crash on load. This isn't a hypothetical — it's a guaranteed runtime error.

**Severity:** 🔴

**Suggested resolution:** Three options (pick one):

**Option A: Import Map (Recommended).** The host injects an import map into the HTML:

```html
<script type="importmap">
{
  "imports": {
    "react": "/assets/react-vendor.js",
    "react-dom": "/assets/react-dom-vendor.js",
    "react/jsx-runtime": "/assets/react-jsx-runtime.js"
  }
}
</script>
```

This requires the host's Vite config to produce stable, non-hashed chunks for React (via `manualChunks` or a separate vendor build). Import maps are supported in all modern browsers.

**Option B: Plugin bundles React.** Remove `react` from externals. Each plugin ships its own React. This works but duplicates React (bad for hooks — multiple React instances break hooks).

**Option C: Module Federation.** Overkill for this use case. Don't.

**Option A is the only viable path.** It requires changes to the host Vite config and the HTML template.

---

### 5. Desktop Plugin Activation Timing vs. Server Fork

**Issue:** The boot sequence in `apps/desktop/src/main/index.ts` is:

```typescript
app.whenReady().then(async () => {
  startBrowserBackend()        // 1. Start socket server
  const serverUrl = await startServer()  // 2. Fork server process
  // ... window creation
})
```

The design proposes:

```
1. Discover all plugins
2. Activate desktop plugins (parallel)
3. Collect shared config values
4. Activate server plugins (parallel, with sharedConfig populated)
```

But steps 3-4 happen in a different process. The desktop host must:
1. Discover plugins
2. Activate desktop plugins
3. Collect shared config
4. THEN fork the server (passing config via env)
5. Server discovers plugins again independently
6. Server activates server plugins

The design conflates "activate server plugins" with something the desktop process controls. It doesn't. The server has its own boot sequence. The desktop process can only influence it via env vars or IPC at fork time.

**Why it blocks:** Without clarifying that plugin discovery happens TWICE (once in Electron main, once in the server process), implementers will assume a single discovery pass and try to share state across the process boundary.

**Severity:** 🔴

**Suggested resolution:** Make explicit:

- Desktop host: discovers plugins → activates desktop entries → collects shared config → forks server with config as env vars
- Server host: discovers plugins independently → activates server entries (with env-based shared config) → serves web entries as static files
- Web host: fetches plugin manifest list from server API → imports web entries

Three independent discovery passes. The design's diagram is misleading in showing a single linear flow.

---

### 6. Type Safety of Dynamic `import()` — No Runtime Validation

**Issue:** The design shows:

```typescript
const mod = await import(resolve(manifest.packageDir, manifest.cradle.server))
await mod.activate(ctx)
```

`mod` is `any`. If the plugin's `dist/server.mjs` exports `{ init }` instead of `{ activate }`, this throws `mod.activate is not a function` at runtime with a confusing stack trace.

The design acknowledges "Types come from `@cradle/plugin-sdk` peer dependency — TypeScript checks happen at plugin build time" but this doesn't help when:
- Someone ships a broken build
- The module path is wrong and imports the wrong file
- The export name changed between SDK versions

**Why it blocks:** Without runtime validation, a single malformed plugin crashes the entire plugin loader loop. The error boundary only catches thrown errors inside `activate()`, not structural errors like "module doesn't export activate."

**Severity:** 🔴

**Suggested resolution:** Add a validation step between import and activate:

```typescript
const mod = await import(entryPath)
if (typeof mod.activate !== 'function') {
  throw new PluginLoadError(
    `${manifest.name}: server entry does not export 'activate' function. ` +
    `Got exports: [${Object.keys(mod).join(', ')}]`
  )
}
await mod.activate(ctx)
```

Simple, zero-cost, prevents the most common failure mode. The design's error handling section shows try/catch but doesn't validate module shape.

---

## 🟡 Needs Design Decision

### 7. `registerMcpServer` `when()` Predicate — Who Re-evaluates?

**Issue:** The `McpServerConfig` has `when?: () => boolean | Promise<boolean>`. The design doesn't specify when this predicate is evaluated. Options:
- Once at registration time (then `when` is pointless — just don't register)
- Every time the agent requests MCP servers (per-request evaluation)
- On some event (what event?)

For browser-use: `when: () => !!socketPath` — the socket path is known at activation time and never changes. So `when` is evaluated once and the answer is static.

But for a hypothetical plugin that registers an MCP server conditionally (e.g., "only when user has configured API key"), when is `when()` re-checked?

**Why it blocks:** Not a hard blocker for v0.1 (browser-use's `when` is static), but the API contract is ambiguous. If someone implements per-request evaluation, it has performance implications (evaluating N predicates per chat message).

**Severity:** 🟡

**Suggested resolution:** For v0.1, evaluate `when()` at registration time only. If it returns false, don't register. Document this clearly. If we need dynamic re-evaluation later, add `refreshMcpServers()` as an explicit trigger.

---

### 8. Web Plugin Panel Registration — Lifecycle After Route Navigation

**Issue:** `registerPanel()` returns a `Disposable`. The web plugin calls this in `activate()`. But when does `activate()` run relative to the React component tree?

If the user navigates away and back (TanStack Router), does the plugin re-activate? Does the panel registration persist across route changes? Is `activate()` called once per page load, or once per mount of the component that hosts plugin panels?

**Why it blocks:** If `activate()` runs in a React effect, it'll re-run on every mount/unmount. If it runs at app initialization (before React renders), the `registerPanel` call needs a store (Zustand?) to persist registrations that React components then read.

**Severity:** 🟡

**Suggested resolution:** Web plugin activation happens ONCE at app initialization, outside the React tree. Registrations are stored in a Zustand store. React components subscribe to the store. This is the only sane pattern:

```typescript
// apps/web/src/lib/plugin-host.ts — runs once at app startup
const pluginStore = create(() => ({ panels: [], widgets: [] }))

// React components subscribe:
const panels = usePluginStore(s => s.panels)
```

Make this explicit in the design.

---

### 9. Web Plugin CSS Contamination — Acknowledged but Unresolved

**Issue:** Section 15 Open Questions #1 acknowledges this: "Plugin panels share the host's CSS context." The design punts to "second plugin has CSS conflicts."

But even with ONE plugin (browser-use), the panel's CSS classes may conflict with the host's Tailwind classes. If the plugin author uses Tailwind with different config (different spacing scale, different colors), class collisions are guaranteed.

**Why it blocks:** Not a hard blocker for v0.1 IF browser-use is developed in-house and uses the same Tailwind config. But the moment someone else writes a plugin, this explodes.

**Severity:** 🟡

**Suggested resolution:** For v0.1: document that plugins MUST use the host's Tailwind config (provide it as part of the SDK). For v0.2: CSS Modules or `@scope` at-rule. Shadow DOM is overkill.

---

### 10. Skill Registration Path Resolution

**Issue:** `registerSkill` takes a `skillFile` path:

```typescript
ctx.registerSkill({
  skillFile: new URL('../SKILL.md', import.meta.url).pathname,
})
```

The current skills system (see `apps/server/src/modules/skills/`) reads skill files from specific directories. The `registerSkill` function needs to integrate with whatever indexing the skills module does. The design doesn't specify whether:
- The file is copied to the skills directory
- The skills index is updated to include the new path
- The agent runtime reads from a different source when plugins register skills

**Why it blocks:** If the skills module only reads from `~/.agents/skills/` or `resources/skills/`, a plugin-registered skill path pointing to `plugins/browser-use/SKILL.md` won't be discovered by the existing system.

**Severity:** 🟡

**Suggested resolution:** The plugin loader should register skills into the same index the skills module uses. Check how skills are currently resolved and add plugin skill paths to that resolution mechanism.

---

## 🟢 Implementation Details (Non-blocking but Notable)

### 11. Discovery Reads `plugins/*` — But `browser-use` Already Exists There

The current `plugins/browser-use/` only has `src/mcp-server.ts` and `src/protocol.ts`. No `package.json` with a `cradle` field. The migration adds this, but during the transition period, the old hardcoded browser-use code (in `apps/desktop/src/main/browser-backend.ts` and `apps/web/src/features/browser/`) coexists. Need a clean cutover plan — not incremental migration.

### 12. `DesktopPluginContext.getMainWindow()` — Window May Not Exist Yet

Desktop plugins activate before the window is created (current boot: `startBrowserBackend()` → `startServer()` → `createMainWindow()`). If a desktop plugin calls `ctx.getMainWindow()` in its `activate()`, it returns `null`. The plugin must defer window-dependent logic. This is fine but should be documented.

### 13. `pluginApp` Prefix Scoping

The design scopes plugin routes to `/api/plugins/${manifest.name}`. For browser-use, this means routes like `/api/plugins/@cradle/plugin-browser-use/...`. The `@` and `/` in scoped package names need URL encoding. Use the short name (`browser-use`) from manifest, not the full npm package name.

### 14. Server Plugin `storage` (SQLite KV) — Table Schema Not Specified

The `PluginStorage` interface is defined but the underlying SQLite table isn't. Need a migration for:

```sql
CREATE TABLE plugin_storage (
  plugin_name TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (plugin_name, key)
);
```

---

## Conclusion

The design is 80% there. The architecture is sound, the scope is honest, and the phased plan is realistic. But the 6 hard blockers are real:

1. **Elysia route timing** — must compose before listen
2. **Cross-process shared config** — env vars are the answer, make it explicit  
3. **MCP registry integration** — need the actual hook into the provider
4. **React import resolution** — import maps required
5. **Dual-process discovery** — clarify the mental model
6. **Module shape validation** — trivial fix, but critical

Fix these before writing code. The 🟡 items can be resolved during implementation with a quick decision, but the 🔴 items need architectural answers first.
