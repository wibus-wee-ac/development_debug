# Critique of Plugin System Design A

**Reviewer:** Critique Agent B  
**Date:** 2026-05-18  
**Target:** `20260518-initial-proposal-DesignA.md`  
**Verdict:** Promising skeleton, but several structural gaps and one potential blocker (web plugin loading model)

---

## Priority Legend

- 🔴 **Blocker** — Must resolve before implementation
- 🟡 **Significant** — Will cause pain if ignored, but not a showstopper
- 🟢 **Nice-to-have** — Improvements that can wait

---

## 1. 🔴 Web Plugin Loading Is a Build-Time Trap

### What the proposal says

> "Build-time bundling for web plugins (tree-shaken into the frontend bundle)"
> "Web plugins require a rebuild to be picked up."

The Vite virtual module approach generates code at build time:

```typescript
// vite-plugin-cradle-plugins.ts — scans manifests, generates dynamic imports
const imports = webPlugins.map((m, i) => 
  `const p${i} = () => import('${m.cradle.web!.entry}')`
)
```

### Why this is a problem

1. **npm distribution is meaningless for web plugins.** If a user runs `cradle plugin install @cradle/plugin-weather`, the web portion does nothing until the entire frontend is rebuilt. This isn't "npm distribution" — it's "npm-as-source-vendoring." Users will expect `install → restart → working`, not `install → rebuild → deploy → working`.

2. **The proposal acknowledges this** ("limits dynamic plugin installation in production") but hand-waves it to "future work could add runtime module federation." Module federation is not a footnote — it's a fundamental architectural decision that changes the plugin contract (async boundaries, shared dependency negotiation, CSS isolation).

3. **Code splitting ≠ dynamic loading.** The virtual module creates code-split chunks, but the set of plugins is frozen at build time. This is fine for first-party plugins shipped with Cradle, but it contradicts the npm distribution promise.

### Alternatives to consider

- **Runtime script injection** (like Obsidian): Load plugin bundles at runtime via `<script>` tags or `import()` against a known URL. Loses tree-shaking but gains actual dynamic loading.
- **Module Federation / Import Maps**: Browser-native import maps or Webpack Module Federation allow runtime composition with shared dependencies.
- **Accept the constraint explicitly**: If web plugins are always first-party and bundled, say so. Don't promise npm distribution for web plugins. Server plugins via npm, web plugins via workspace only.

---

## 2. 🔴 Cross-Layer Plugin Communication Is Under-Specified

### What the proposal says

The communication section lists three patterns:
- Server ↔ Desktop: Unix Domain Socket
- Server ↔ Web: HTTP/WS
- Web ↔ Desktop: Electron IPC

### What's missing

**How does the desktop plugin tell the server plugin its socket path?**

The proposal says:

> "Notify server plugin of socket path via shared config (The host propagates this as BROWSER_BACKEND_SOCKET env var)"

But the `ServerPluginContext` has `config: PluginConfig` which appears to be read-only. There's no mechanism shown for:
- Desktop plugin writing a value that the server plugin reads
- Cross-layer plugin config negotiation
- Ordering guarantees (desktop plugin must start before server plugin reads config)

In the current `browser-use` implementation, this is solved by convention: the socket path is deterministic (`~/.cradle/browser-backend.sock`). But the proposal abstracts this into `ctx.createSocketServer({ socketName: 'browser-backend.sock' })` without explaining how the server-side `ctx.config.get('socketPath')` gets populated.

### Why this matters

Every multi-layer plugin will face this bootstrapping problem. Without a clear answer, each plugin will reinvent its own convention, defeating the purpose of a system.

### Alternatives

- **Explicit shared config bus**: The host maintains a `pluginConfig` store. Desktop plugins write, server plugins read (with ordering).
- **Environment variable injection**: Host collects desktop plugin outputs and injects them as env vars before server plugin activation.
- **Deterministic conventions**: Socket paths are always `{userDataPath}/{pluginName}.sock`. No config needed.

---

## 3. 🟡 Over-Engineering: The Permission System Is Theater (And The Proposal Admits It)

### What the proposal says

> "Phase 1 (MVP): Trust-based — plugins run in the same process. Permissions are declarative (for user awareness) but not enforced at runtime."

The manifest includes:
```jsonc
"permissions": ["network", "filesystem:read", "native:webview"]
```

### The problem

Declaring permissions you don't enforce is worse than having no permission system:

1. **False sense of security** — Users see "this plugin requests filesystem:read" and think they're protected. They aren't.
2. **Maintenance burden** — You must maintain a permission taxonomy, validate declarations, show UI for grants… all for permissions that do nothing.
3. **VS Code's lesson** — VS Code extensions also run trusted. But VS Code never shows a "permissions" dialog — it uses marketplace trust signals (verified publisher, install count) instead. The permission model came later with Workspace Trust and Extension Sandboxing proposal (still not shipped after years).

### Recommendation

Drop the permission field in Phase 1. Replace with:
- `"trusted": true/false` — Is this a first-party or audited plugin?
- A `README.md`-based disclosure of what the plugin does

Add a real permission system only when you have enforcement (Phase 2/3). Don't ship a lie.

---

## 4. 🟡 activationEvents Without a Deactivation Story

### What the proposal says

```jsonc
"activationEvents": ["onPanelOpen:browser"]
```

Plugins activate lazily. Deactivation happens on "server shutdown, user disable, or error."

### What's missing

1. **No `onPanelClose` deactivation.** If a plugin activates `onPanelOpen:browser`, does it stay active forever once the panel opens once? Memory leak for the entire session.

2. **No activation/deactivation pairing.** VS Code extensions activate and stay active until VS Code closes. Obsidian plugins activate on load and deactivate on unload. The proposal mixes both models without committing:
   - Server plugins: always active (like Obsidian)
   - Web plugins: lazy (like VS Code)
   - But neither has a "scope" — how long does activation last?

3. **What happens if `activationEvents` never fires?** Is the plugin silently dead? Is there a timeout? How does the user know their plugin isn't working because the activation event hasn't occurred?

### Recommendation

Simplify: All plugins activate at load time (like Obsidian). If you need lazy loading, use code-splitting (dynamic `import()` inside the plugin itself). Don't put lazy-loading logic in the host — it adds complexity to the loader and every plugin author has to understand activation events.

Lazy activation is a premature optimization when you have <10 plugins.

---

## 5. 🟡 The "Single Package, Multi-Entry" Model Creates Build Complexity

### What the proposal says

One npm package has three entry points:
```jsonc
"exports": {
  "./server": "./dist/server.mjs",
  "./web": "./dist/web.mjs",
  "./desktop": "./dist/desktop.mjs"
}
```

### The problem

1. **Dependency contamination.** A package that exports both a React web component AND an Electron main-process module will have `react`, `electron`, and `@modelcontextprotocol/sdk` as dependencies. Users installing this in a web-only deployment pull in `electron` types/stubs. Tree-shaking helps, but the dependency graph is polluted.

2. **Build configuration hell.** The plugin author must configure their build to output:
   - `server.mjs` — Node.js target, no React, no Electron
   - `web.mjs` — Browser target, React, no Node APIs
   - `desktop.mjs` — Node.js target, Electron APIs, no React
   
   This requires a multi-output Vite/Rollup config. The proposal doesn't mention a plugin starter template or build helper.

3. **Testing across environments.** How do you test a single package that targets three different runtimes? You need three different test configurations.

### Current reality check

The existing `browser-use` plugin has none of these problems because it's server-only (MCP process). Adding web and desktop entries to the same package introduces the complexity described above.

### Alternative

Consider **separate packages per entry point** with a shared types package:
```
@cradle/plugin-browser-use-server
@cradle/plugin-browser-use-web
@cradle/plugin-browser-use-desktop
@cradle/plugin-browser-use-types  (shared protocol)
```

Or accept mono-package but provide `@cradle/plugin-build-tools` that handles the multi-target config.

---

## 6. 🟡 Migration Path From Current browser-use Is Not Smooth

### What the proposal implies

The "What Changes" table shows a clean mapping:
- `browser-backend.ts` → `desktop.ts` using `ctx.createSocketServer()`
- Hardcoded panel → `ctx.registerPanel()`

### Reality check

Looking at the current code:

**`browser-backend.ts`** (30+ lines visible) imports directly from `@cradle/browser-use/protocol` and handles 15+ CDP command types (`ClickResult`, `DomSnapshotResult`, `EvalResult`, etc.). It lives in `apps/desktop/src/main/` — it's deeply integrated into the Electron main process.

**`mcp-server.ts`** connects to the socket and exposes MCP tools. It's a standalone process.

The migration requires:
1. Moving `browser-backend.ts` OUT of `apps/desktop/` INTO `plugins/browser-use/src/desktop.ts`
2. Replacing direct Electron imports with the `DesktopPluginContext` abstraction
3. The `DesktopPluginContext.onWebviewCreated()` hook must expose enough `WebContents` API to implement all 15+ CDP operations currently in `browser-backend.ts`

**Problem:** The `DesktopPluginContext` interface is too thin. It exposes `getMainWindow()` and `onWebviewCreated(wc, tabId)` — but `browser-backend.ts` needs:
- Direct `webContents.debugger.sendCommand()` (CDP protocol)
- `webContents.executeJavaScript()`
- Tab management (create/close/navigate webviews)
- Screenshot capture

The plugin context would need to be almost a complete proxy of Electron's `WebContents` API. At that point, why abstract it?

### Recommendation

The desktop plugin context should be thinner: provide the raw `WebContents` reference and let plugins do what they need. Don't try to abstract Electron away — desktop plugins are inherently coupled to Electron. The abstraction should handle lifecycle (discovery, activation, shutdown) not the underlying platform APIs.

---

## 7. 🟡 No Error Boundary or Health Monitoring Design

### What the proposal says

> "No plugin isolation in Phase 1 — a buggy plugin can crash the server. Mitigation: good error boundaries + plugin health monitoring."

### What's missing

No design for:
- What "error boundary" means for a server plugin (try/catch around `activate()`? Around every event handler? Around route handlers registered via `app.use()`?)
- Health monitoring: heartbeats? Memory usage tracking? Error rate thresholds?
- What happens when a plugin throws during `deactivate()`?
- What happens when a plugin's registered route throws — does Elysia's error handler attribute it to the plugin?

This is fine to leave for later, but calling it a "mitigation" implies it exists. It doesn't.

---

## 8. 🟢 Missing: Plugin DevEx (Templates, Debugging, Testing)

### What's absent from the proposal

1. **No `create-cradle-plugin` scaffolding** — How does a developer start building a plugin? They need a template with the multi-target build config, correct TypeScript settings, and example code.

2. **No debugging story** — How do you attach a debugger to a server plugin loaded via `import()`? Does source maps work? Can you set breakpoints?

3. **No testing utilities** — The SDK should provide mock contexts (`createMockServerContext()`) for unit testing plugins without running the full Cradle server.

4. **No dev-mode hot reload** — The open questions mention this but don't design it. For server plugins, `nodemon`-style restart works. For web plugins bundled at build time, Vite HMR should propagate. For desktop plugins, you'd need to re-activate without restarting Electron.

---

## 9. 🟢 npm Distribution vs. Private Registry Reality

### The implicit assumption

The proposal assumes plugins are published to the public npm registry or used as workspace packages. But:

1. **Enterprise deployments** may need private registries. The `cradle plugin install` command should support `--registry` or read `.npmrc`.

2. **Version pinning** — When a plugin is installed, is it pinned in `package.json`? If so, updates require `cradle plugin update`. If not, `pnpm install` might pull breaking changes.

3. **Lockfile conflicts** — Adding plugins to the workspace root means `pnpm-lock.yaml` changes on every plugin install. In a team setting, this creates merge conflicts.

### Minor but worth noting

The naming convention `@cradle/plugin-*` or `cradle-plugin-*` — having two patterns makes discovery harder. Pick one. `@cradle/plugin-*` is cleaner (scoped).

---

## 10. 🟢 Web-Only Deployment: What Actually Degrades?

### What the proposal says

> "Desktop as optional — graceful degradation"
> "For web-only deployments, desktop IPC calls should gracefully no-op or fall back to server-side alternatives."

### What's unspecified

For `browser-use` specifically:
- **Without Electron, there are no webviews.** The entire browser-use plugin is non-functional in web-only mode. This isn't "degradation" — it's complete absence.
- The proposal doesn't distinguish between "plugin partially works" and "plugin is entirely unavailable."

### Recommendation

The manifest should declare minimum deployment targets:
```jsonc
"cradle": {
  "deployments": ["desktop"],  // or ["desktop", "web"] for both
}
```

The host can hide/disable plugins that don't support the current deployment, rather than letting them activate and silently fail.

---

## 11. 🟢 Prior Art Gap: Obsidian's Settings Tab Pattern

### What's missing

Obsidian's most successful pattern isn't lifecycle or activation — it's the **settings tab**. Every plugin gets a settings UI automatically rendered from a simple schema. Users expect to configure plugins without reading docs.

The proposal's "Open Questions" mentions this but doesn't commit. In practice, this is table-stakes for user-facing plugins. Without it, every plugin author builds their own settings UI (inconsistent) or hardcodes config (inflexible).

### Recommendation

Include a `"settings"` field in the manifest (JSON Schema) that the host auto-renders. This is low-cost, high-value, and should be in Phase 1 not Phase 4.

---

## Summary Table

| # | Issue | Priority | Category |
|---|-------|----------|----------|
| 1 | Web plugins can't be dynamically loaded despite npm distribution promise | 🔴 Blocker | Architecture |
| 2 | Cross-layer config propagation (desktop→server) is undefined | 🔴 Blocker | Communication |
| 3 | Permission system is unenforceable theater | 🟡 Significant | Security |
| 4 | Activation events without deactivation scope | 🟡 Significant | Lifecycle |
| 5 | Single package, multi-entry creates build hell | 🟡 Significant | DX |
| 6 | DesktopPluginContext is too thin for real migration | 🟡 Significant | Migration |
| 7 | Error boundaries mentioned but not designed | 🟡 Significant | Reliability |
| 8 | No plugin DevEx story (templates, testing, debugging) | 🟢 Nice-to-have | DX |
| 9 | npm distribution edge cases (private registries, lockfiles) | 🟢 Nice-to-have | Distribution |
| 10 | Web-only degradation is undefined per-plugin | 🟢 Nice-to-have | Deployment |
| 11 | Missing auto-rendered settings from schema | 🟢 Nice-to-have | UX |

---

## Closing Thought

The proposal's strongest quality is its **grounding in the existing `browser-use` plugin** — it's not abstract framework design; it maps to a real use case. The weakest quality is the **gap between the npm distribution promise and the build-time web plugin reality**. Resolve issue #1 first — it determines whether this is a "plugin system" or a "module organization pattern." Both are valid, but they're different things with different marketing.
