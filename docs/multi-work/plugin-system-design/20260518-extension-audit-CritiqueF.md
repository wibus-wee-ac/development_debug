# Extension Point Audit — Critique F

**Author:** Extension Point Audit Agent  
**Date:** 2026-05-18  
**Status:** Audit Complete  
**Inputs:** Final Synthesis E + Synthesis C  

---

## 1. Extension Point Coverage Matrix

### Server-side

| Capability | Status | Notes |
|---|---|---|
| Add HTTP routes | ✅ | Scoped Elysia instance under `/api/plugins/:name/` prefix |
| Register MCP tools for agent | ✅ | `registerMcpServer()` + registry consumed by provider |
| Register Skills (SKILL.md) | ✅ | `registerSkill()` + path-based inclusion in skills index |
| Add middleware (auth, logging, rate limiting) | ⚠️ | Plugin can add `.onBeforeHandle()` to its own scoped Elysia instance, but CANNOT inject middleware into the host's request pipeline (e.g., auth all routes). No host-level middleware hook exists. |
| Hook into chat lifecycle (before/after agent query, on message, on error) | ❌ | No chat lifecycle hooks defined. No event bus or hook system for agent query events. |
| Access/extend the database (custom tables, queries) | ⚠️ | `PluginStorage` is a KV store only. No mechanism for custom tables, migrations, or raw query access. |
| Schedule background jobs/tasks | ❌ | No scheduler, cron, or background task API. |
| Emit/listen to events (pub/sub between plugins or with host) | ❌ | Explicitly deferred ("Inter-plugin communication — For v0.1: no"). No EventEmitter, no pub/sub bus. |
| Register custom agent providers | ❌ | Only MCP server registration. Cannot register an entirely new provider (e.g., a local LLM provider, a custom agent loop). |
| Custom streaming/SSE endpoints | ⚠️ | Plugin's scoped Elysia instance CAN do streaming routes, but no explicit design guidance or SDK helper. Technically possible, not explicitly supported. |

### Web (Frontend)

| Capability | Status | Notes |
|---|---|---|
| Register panels (main, sidebar, bottom) | ✅ | `registerPanel()` with `location: 'main' | 'sidebar' | 'bottom'` |
| Register toolbar/header buttons or actions | ❌ | No toolbar/header action registration API. |
| Add context menu items | ❌ | No context menu extension point. |
| Register slash commands (/commands in chat input) | ❌ | No slash command registration. |
| Inject CSS/themes | ⚠️ | Plugins share host Tailwind config. No mechanism to inject custom CSS, override theme tokens, or add custom theme variants. |
| Register keyboard shortcuts | ❌ | No keyboard shortcut registration API. |
| Add settings pages (plugin configuration UI) | ❌ | Explicitly deferred to v0.2 ("Missing settings auto-render"). |
| Register notification types | ❌ | No notification system extension point. |
| Custom message renderers | ❌ | No mechanism to register custom renderers for specific message types in chat. |
| Tab types (register new kinds of tabs) | ❌ | No tab registration API. Panels exist but tabs are not extensible. |

### Desktop (Electron)

| Capability | Status | Notes |
|---|---|---|
| System tray integration | ❌ | Not exposed in `DesktopPluginContext`. |
| Global keyboard shortcuts | ❌ | Not exposed. Plugins could use Electron APIs directly via `electron` import, but no lifecycle management. |
| File system watchers | ⚠️ | Plugins can use Node `fs.watch()` directly. No managed abstraction, which is fine per "lifecycle only" principle. |
| Custom protocol handlers (cradle://) | ❌ | Not exposed. Would need `protocol.registerSchemesAsPrivileged()` which must happen before app ready. |
| Menu bar items | ❌ | Not exposed in context. |
| Webview/browser control | ✅ | `onWebviewCreated()` provides raw `WebContents` + debugger API. |
| Native notifications | ⚠️ | Not explicitly provided but plugins can use Electron's `Notification` API directly. |
| Auto-update hooks | ❌ | Not exposed. |

### Coverage Summary

| Layer | ✅ Supported | ⚠️ Partial | ❌ Missing |
|---|---|---|---|
| Server | 3 | 3 | 4 |
| Web | 1 | 1 | 8 |
| Desktop | 1 | 2 | 5 |
| **Total** | **5** | **6** | **17** |

---

## 2. Engineering Completeness Assessment

For each ✅ or ⚠️ extension point:

### ✅ HTTP Routes (Server)
- **Registration API:** ✅ Defined — scoped Elysia instance passed as `ctx.app`
- **Lifecycle:** ✅ Clear — routes composed before `app.listen()`
- **Error isolation:** ✅ `.onError()` on scoped instance + plugin prefix
- **Disposal:** ⚠️ No explicit route unregistration. Elysia doesn't support dynamic route removal. Restart required.
- **Ordering:** ✅ N/A — each plugin has its own prefix namespace

### ✅ MCP Tools Registration
- **Registration API:** ✅ `registerMcpServer(config: McpServerConfig)`
- **Lifecycle:** ⚠️ `when()` evaluated once at registration. No dynamic re-evaluation means a server that becomes available later won't be registered.
- **Error isolation:** ⚠️ If MCP process crashes, unclear how agent recovers. Not a plugin system concern per se but affects plugin quality.
- **Disposal:** ❌ No `unregisterMcpServer()`. Once registered, stays until process restart.
- **Ordering:** ✅ N/A — all registered servers are merged into agent options.

### ✅ Skill Registration
- **Registration API:** ✅ `registerSkill(skill: SkillDefinition)`
- **Lifecycle:** ✅ Registered at activation, available to agent immediately.
- **Error isolation:** ✅ Path-based — if SKILL.md is malformed, only that skill fails.
- **Disposal:** ❌ No `unregisterSkill()`.
- **Ordering:** ✅ N/A.

### ✅ Panel Registration (Web)
- **Registration API:** ✅ `registerPanel(panel: PanelRegistration): Disposable`
- **Lifecycle:** ✅ Registered in Zustand store before React renders. Clear.
- **Error isolation:** ✅ React ErrorBoundary wraps each panel.
- **Disposal:** ✅ Returns `Disposable` — removes from store.
- **Ordering:** ✅ `order` field for positioning.

### ✅ Webview Control (Desktop)
- **Registration API:** ✅ `onWebviewCreated(handler): Disposable`
- **Lifecycle:** ✅ Handler called on each new webview creation.
- **Error isolation:** ⚠️ No try/catch around handler invocation documented. One plugin's throw could break other handlers.
- **Disposal:** ✅ Returns `Disposable`.
- **Ordering:** ❌ Multiple plugins listening get no priority control.

### ⚠️ Plugin Storage
- **Registration API:** ✅ `PluginStorage` interface with get/set/delete.
- **Lifecycle:** ✅ Available immediately, persisted in SQLite.
- **Error isolation:** ✅ Scoped by `plugin_name` primary key.
- **Disposal:** ⚠️ No `clear()` or migration path for schema changes.
- **Ordering:** N/A.

### Overall Engineering Quality: **B+**

The designed extension points are reasonably well-engineered. The main weakness is the lack of `unregister` / dynamic lifecycle for server-side registrations, which won't matter in v0.1 but will bite in v0.2 when plugins can be disabled at runtime.

---

## 3. Top 5 Missing Extension Points

### 1. Chat Lifecycle Hooks — **CRITICAL (Month 1-2)**

**Why:** The #1 reason developers build plugins for AI apps is to customize the agent's behavior. Without hooks like `onBeforeQuery`, `onAfterResponse`, `onToolCall`, `onError`, plugins cannot:
- Add custom context injection (RAG, memory retrieval)
- Implement guardrails/content filtering
- Add cost tracking/usage metering per query
- Log interactions to external systems
- Modify system prompts dynamically

**Proposed API:**
```typescript
interface ServerPluginContext {
  hooks: {
    onBeforeQuery(handler: (query: QueryContext) => QueryContext | Promise<QueryContext>): Disposable
    onAfterResponse(handler: (response: ResponseContext) => void | Promise<void>): Disposable
    onToolCall(handler: (tool: ToolCallContext) => ToolCallContext | Promise<ToolCallContext>): Disposable
    onError(handler: (error: AgentError) => void): Disposable
  }
}
```

**Impact of absence:** Without this, every plugin that needs agent customization must fork the provider code. This is the single most important missing feature.

### 2. Slash Commands / Chat Input Extensions — **HIGH (Month 2-3)**

**Why:** Plugins need to add commands to the chat input (e.g., `/browse`, `/search`, `/draw`). This is how users invoke plugin-specific capabilities. Without this:
- Plugins have no direct user interaction model in the chat interface
- Users must know plugin-specific APIs or navigate to plugin panels
- The chat becomes a black box that plugins can't extend

**Proposed API:**
```typescript
interface WebPluginContext {
  registerSlashCommand(cmd: SlashCommandRegistration): Disposable
}
interface SlashCommandRegistration {
  name: string // without "/"
  description: string
  icon?: ComponentType | string
  execute(args: string, chatCtx: ChatInputContext): void | Promise<void>
}
```

### 3. Event Bus / Pub-Sub — **HIGH (Month 2-3)**

**Why:** Without inter-plugin and plugin-to-host communication:
- A "cost tracker" plugin can't react to agent usage events
- A "logging" plugin can't observe what other plugins do
- The system can't emit lifecycle events (thread created, message sent, model switched)
- No way to build composite features (plugin A triggers plugin B)

**Proposed API:**
```typescript
interface ServerPluginContext {
  events: {
    emit(event: string, data: unknown): void
    on(event: string, handler: (data: unknown) => void): Disposable
  }
}
```

Even in v0.1, the host should emit well-known events (`chat:message`, `chat:response`, `thread:created`) that plugins can subscribe to.

### 4. Settings / Configuration UI — **MEDIUM (Month 3-4)**

**Why:** Every non-trivial plugin needs user-configurable settings. The design explicitly defers this to v0.2, but plugins will ship with hardcoded configs until then. This is acceptable for v0.1 but will be the #1 developer pain point immediately after.

**Proposed API:** JSON Schema in manifest → auto-rendered settings form.

### 5. Custom Message Renderers — **MEDIUM (Month 3-6)**

**Why:** AI desktop apps render diverse content types: code blocks, images, charts, interactive widgets, approval buttons, tool output. Without custom renderers:
- Browser-use can't render visual screenshots inline in chat
- A "diagram" plugin can't render Mermaid in-message
- Tool results are always plain text

**Proposed API:**
```typescript
interface WebPluginContext {
  registerMessageRenderer(renderer: MessageRendererRegistration): Disposable
}
interface MessageRendererRegistration {
  /** Match condition: message type, tool name, or content pattern */
  match: (message: ChatMessage) => boolean
  component: ComponentType<{ message: ChatMessage }>
  priority?: number
}
```

---

## 4. Over-engineering Warnings

### 1. `deployments` Field — Premature Abstraction

The `deployments: ["desktop"]` field exists to handle web-only mode. But:
- Cradle is primarily a desktop app
- Web-only deployment is speculative
- The field adds validation logic for a scenario that may never ship

**Verdict:** Low cost to keep, but don't let it drive architectural decisions. If only one deployment mode exists for 6+ months, this is dead weight.

### 2. `@cradle/plugin-build` Package — Over-engineering for 1 Plugin

A dedicated Vite preset package makes sense for an ecosystem. With 1 plugin (browser-use), the Vite config is ~15 lines. Creating a whole package + maintaining it adds overhead.

**Recommendation:** Inline the Vite config in `plugins/browser-use/vite.config.ts`. Extract to a shared package when plugin #3 arrives.

### 3. `provides` Manifest Field — Indexing Without Activation

```json
"provides": {
  "mcpServers": ["browser-use"],
  "panels": ["browser"],
  "skills": ["browser-use"]
}
```

This exists for "zero-cost indexing of features without activating plugins." But v0.1 uses eager activation — everything activates. The index adds manifest schema complexity that's unused.

**Recommendation:** Remove for v0.1. Add when lazy activation lands in v1.0.

### 4. `sharedConfig` Bus via Environment Variables — Fragile at Scale

For 1 plugin this works. For 10+ plugins with complex state, env vars become:
- Hard to debug (no visibility into what's set)
- Limited to string values
- Consumed at fork time only (no updates)

This is fine for v0.1 but the team should plan to replace it. Don't add more users of this pattern.

### 5. Stable Chunk Filenames for Import Maps — Fragile

Removing content hashes from chunk filenames (`react-vendor.js` instead of `react-vendor-abc123.js`) breaks long-term caching and can cause stale module issues. This solves a real problem (bare specifier resolution) but the solution has maintenance traps.

**Recommendation:** Acceptable for v0.1. Monitor for cache-related bugs in production.

---

## 5. Prior Art Comparison

### VS Code

| Aspect | VS Code | Cradle | Difference Justified? |
|---|---|---|---|
| **Registration** | JSON contribution points + imperative API | Imperative only (TypeScript functions in `activate()`) | ✅ Yes — JSON contribution points add massive complexity. With <10 plugins, imperative is simpler and more flexible. |
| **Activation** | Event-based lazy loading (`onLanguage`, `onCommand`, etc.) | Eager (all at startup) | ✅ Yes for v0.1. Would need lazy loading at 20+ plugins. |
| **Isolation** | Extension Host (separate process) | Same process | ⚠️ Risky but acceptable for first-party plugins. Will need isolation for third-party. |
| **UI Extension** | `WebviewPanel`, contribution to views, tree data providers | `registerPanel()` only | ❌ VS Code has much richer UI extension. Cradle needs at minimum: commands, menus, keybindings. |
| **Lifecycle** | Full activate/deactivate with context subscriptions | activate/deactivate with Disposable | ✅ Comparable. Cradle's is simpler, which is fine. |
| **Type Safety** | `vscode.d.ts` declaration file | `@cradle/plugin-sdk` types package | ✅ Equivalent approach. |
| **Cross-extension** | Extension dependencies + API exposure | None | ⚠️ Will need in v0.2+ for composite plugins. |

### Obsidian

| Aspect | Obsidian | Cradle | Difference Justified? |
|---|---|---|---|
| **Events** | Rich event system (`workspace.on('file-open')`, `vault.on('create')`, etc.) | None | ❌ Obsidian's event system is what makes its plugins powerful. Cradle lacks this entirely. |
| **Views** | `registerView()` with custom view types | `registerPanel()` | ✅ Similar concept, adequate. |
| **Commands** | `addCommand()` with hotkey binding | Missing | ❌ Commands are table-stakes. Even v0.1 should have this. |
| **Settings** | `PluginSettingTab` | Deferred | Acceptable for v0.1. |
| **Ribbon/Status bar** | `addRibbonIcon()`, `addStatusBarItem()` | Missing | ⚠️ Nice-to-have, not critical. |

### Raycast

| Aspect | Raycast | Cradle | Difference Justified? |
|---|---|---|---|
| **Manifest** | Declarative JSON (commands, preferences, etc.) | Imperative TypeScript | ✅ Different paradigms. Raycast's manifest works because extensions are simpler. Cradle's imperative approach is appropriate for richer plugins. |
| **UI** | React components with Raycast UI kit | React components with host Tailwind | ✅ Similar. |
| **Data** | `LocalStorage` API | `PluginStorage` KV | ✅ Nearly identical. |
| **Commands** | First-class concept — every extension IS a command | Missing | ❌ In an AI app, plugins need command-level integration. |
| **Preferences** | Declared in manifest, auto-UI | Deferred | Acceptable. |

### Key Gaps vs. All Three

1. **Commands / Actions** — All three have a "command" concept that plugins can register. Cradle has none.
2. **Events** — Obsidian and VS Code both have rich event systems. Cradle has none.
3. **UI contribution beyond panels** — All three allow toolbar/menu/statusbar contributions. Cradle only has panels.

---

## 6. Verdict

### Can we start building? **Yes, with caveats.**

The design is **implementable as-is for the v0.1 scope** (migrating browser-use to a plugin). The architecture is sound:
- Three-process boot is correctly modeled
- Route timing blocker is solved
- React resolution via import maps works
- Error isolation is adequate for first-party plugins

### But it needs one more iteration before v0.2

The design has a **critical gap**: no chat lifecycle hooks and no event system. These are the foundational building blocks that make plugin systems useful for AI applications. Without them, the plugin system can only:
- Add panels
- Add routes
- Register MCP servers

It CANNOT:
- Customize agent behavior
- React to user actions
- Participate in the chat flow

### Recommendation

1. **Proceed with v0.1 implementation as designed.** The scope (browser-use migration) doesn't need the missing extension points.
2. **Before v0.2, design chat lifecycle hooks + event bus.** This is non-negotiable for any plugin beyond browser-use.
3. **Remove `provides` field and `@cradle/plugin-build` package from v0.1.** They're over-engineering that will evolve before they're useful.
4. **Add `registerCommand()` to WebPluginContext in v0.1.** It's trivial to implement (store in Zustand, expose to keyboard shortcut system) and every plugin will need it.

### Implementation Readiness Score

| Dimension | Score | Note |
|---|---|---|
| Architecture | 9/10 | Three-process model is correct and well-specified |
| Server extension points | 6/10 | Routes + MCP work, but no hooks = limited utility |
| Web extension points | 4/10 | Only panels. No commands, menus, message renderers |
| Desktop extension points | 7/10 | Minimal but appropriate for "lifecycle only" principle |
| Engineering rigor | 8/10 | Good error handling, validation, typed APIs |
| Scalability to 10+ plugins | 5/10 | No events, no ordering, no inter-plugin comms |
| **Overall** | **6.5/10** | Sufficient for v0.1 scope. Needs iteration for ecosystem. |

---

## Appendix: Recommended v0.1 Additions (Minimal Cost, High Value)

These 3 additions would raise the score to 8/10 with minimal implementation effort:

### A. `registerCommand()` in WebPluginContext

```typescript
registerCommand(cmd: { id: string; title: string; icon?: string; execute: () => void }): Disposable
```
Store in Zustand. Expose in command palette UI. ~50 lines of code.

### B. `hooks.onBeforeQuery` in ServerPluginContext

```typescript
hooks: {
  onBeforeQuery(handler: (ctx: { messages: Message[]; model: string }) => { messages: Message[]; model: string }): Disposable
}
```
Tapable-style hook in the agent provider. ~30 lines. Unlocks context injection, guardrails, logging.

### C. Host-emitted events (read-only)

```typescript
events: {
  on(event: 'chat:message' | 'chat:response' | 'thread:created' | 'plugin:activated', handler: (data: unknown) => void): Disposable
}
```
Simple EventEmitter with known events. ~40 lines. Unlocks observability plugins, analytics, cost tracking.

Total cost: ~120 lines of infrastructure code. Transforms the plugin system from "panel-only" to "AI-app-aware."
