# Plugin Activation Switches

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained: a contributor who has only this repository and this file should be able to implement Cradle-owned plugin activation switches without relying on prior chat history.

## Purpose / Big Picture

Cradle can discover and activate plugins, but users cannot currently turn a plugin off from the Cradle UI in a way that truly removes the plugin from the runtime surface. This matters because plugins can register HTTP routes, MCP servers, skills, chat hooks, provider sources, issue sources, and web panels. A user-facing switch is only honest if turning a plugin off prevents those capabilities from being used.

After this change, Cradle will own a persistent activation policy for each plugin. A disabled plugin will still appear in plugin management surfaces so the user can re-enable it, but its server code will not remain active, its registered runtime capabilities will be disposed, and its web bundle and plugin routes will not be served. This is separate from plugin-owned settings such as Nowledge Mem's internal `enabled` field; a plugin may keep its own feature toggles, but Cradle owns whether the plugin package is active at all.

The user-visible outcome is concrete. In a plugin management screen, a user can turn off `@cradle/nowledge-mem` or `@cradle/browser-use`; after that, `/api/plugins/{routeSegment}/...` returns a disabled response or 404, plugin mention search no longer treats the plugin as active, MCP registry entries from that plugin disappear from Codex and Claude runtime configs, and plugin web panels cannot be opened. Turning the plugin back on reactivates it without a full server restart.

This implementation pass is backend-only. It will add the persistent policy, server lifecycle operations, plugin route dispatcher, and host-owned HTTP API. It will not build the frontend management screen. The backend acceptance path is still observable through HTTP requests, server tests, descriptors, and runtime registry state.

## Progress

- [x] (2026-06-20 10:02Z) Read the ExecPlan skill and PLANS.md. Non-negotiables: the plan must be self-contained, novice-friendly, observable, and maintained as a living document with Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective.
- [x] (2026-06-20 10:02Z) Confirmed the next plan filename for the day is `docs/exec-plans/20260620-04-plugin-activation-switches.md`.
- [x] (2026-06-20 10:02Z) Inspected the current plugin loader, plugin context, static server, runtime registry, plugin storage schema, and plugin module API to identify the ownership boundary and the hot-disable blocker.
- [x] (2026-06-20 11:06Z) Revised scope before implementation: this pass excludes frontend UI, keeps plugin-private APIs out of the stable host OpenAPI contract, and treats existing already-started runtime sessions as out of scope for live MCP config mutation.
- [x] (2026-06-20 11:15Z) Implemented dynamic plugin route dispatch in `apps/server/src/plugins/route-registry.ts`, removed per-plugin Elysia sub-app mounting from `loader.ts`, and updated context/loader tests. Focused command `pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/loader.test.ts` passed with 23 tests.
- [x] (2026-06-20 11:17Z) Added Drizzle schema and generated migration `packages/db/drizzle/0007_early_spacker_dave.sql` for `plugin_activation_policies`; added `apps/server/src/plugins/activation-policy.ts` and `activation-policy.test.ts`. Focused command `pnpm --filter @cradle/server exec vitest run src/plugins/activation-policy.test.ts` passed with 2 tests.
- [x] (2026-06-20 11:22Z) Refactored plugin loader to project activation state into descriptors, skip disabled plugin server/web layers on startup, and export `disablePlugin`/`enablePlugin` hot lifecycle functions. Loader tests now cover startup-disabled and hot disable/re-enable behavior. Focused command `pnpm --filter @cradle/server exec vitest run src/plugins/loader.test.ts src/plugins/runtime-registry.test.ts` passed with 25 tests.
- [x] (2026-06-20 11:27Z) Added backend plugin management API routes under `apps/server/src/modules/plugins`: `GET /plugins`, `GET /plugins/:routeSegment`, and `PATCH /plugins/:routeSegment/enabled`; added descriptor response projection and disabled-plugin mention filtering. Focused command `pnpm --filter @cradle/server exec vitest run tests/plugins.test.ts` passed with 1 test.
- [x] (2026-06-20 11:29Z) Generated Drizzle migration `packages/db/drizzle/0007_early_spacker_dave.sql` and CLI commands for `plugin list`, `plugin get`, and `plugin set-enabled`.
- [x] (2026-06-20 11:32Z) Ran focused plugin/server validation, server typecheck, generated CLI validation, and focused ESLint. Focused server tests passed with 37 tests; `pnpm --filter @cradle/server exec tsc --noEmit`, `pnpm --filter @cradle/cli typecheck`, and `pnpm --filter @cradle/cli cradle --help` passed.
- [x] (2026-06-20 11:36Z) Updated backend and SDK documentation to explain host activation policy, plugin-owned settings, dispatcher-owned plugin routes, and the new Cradle-owned plugin management API.
- [x] (2026-06-20 11:39Z) Re-ran final focused validation after documentation updates: plugin/server tests, server typecheck, focused ESLint, CLI typecheck, CLI help, and `git diff --check` all passed.

## Surprises & Discoveries

- Observation: plugin routes are currently registered directly on an Elysia sub-app and then mounted into the server with `app.use(pluginApp)`.
  Evidence: `apps/server/src/plugins/context.ts` accepts `pluginApp`, calls `routeApp.get/post/put/patch/delete(...)` inside `registerRoute`, and `apps/server/src/plugins/loader.ts` creates `const pluginApp = new Elysia({ prefix: ... })` followed by `app.use(pluginApp)`.

- Observation: current disposal can remove capability records and registry entries, but it cannot reliably unmount an Elysia route that was already attached to the main server.
  Evidence: `createServerPluginContext(...).registerRoute(...)` sets a local `disposed` flag and unregisters the capability, but the Elysia route handler remains mounted. If invoked after disposal, it returns `410` only because the handler checks `disposed`.

- Observation: web bundle serving is already indirectly controlled by descriptor layer status.
  Evidence: `apps/server/src/plugins/static-server.ts` returns `null` when `descriptor.layers.web.status` is `invalid` or `disabled`.

- Observation: plugin-local storage already has a Cradle-owned database namespace, but it is for plugin-owned key/value data and should not store host activation policy.
  Evidence: `packages/db/src/schema/plugin.ts` defines `pluginStorageEntries` with `pluginName`, `key`, and `value`. A host switch belongs next to this schema file because it is plugin infrastructure, but it should be a separate table, not another plugin storage key.

- Observation: the public plugin descriptor type currently has layer status and runtime capabilities but no explicit activation policy state.
  Evidence: `packages/plugin-sdk/src/index.ts` defines `PluginDescriptor` with `layers`, `capabilities`, `declaredCapabilities`, and related metadata, but no `activation` field.

- Observation: Elysia 1.4.28 supports a plugin dispatcher route shaped as `/api/plugins/:routeSegment/*`; the remaining path is available as `params["*"]`.
  Evidence: an in-memory `Elysia().all('/api/plugins/:routeSegment/*', ...)` probe returned `{"routeSegment":"nowledge-mem","*":"threads/abc/append"}` for `/api/plugins/nowledge-mem/threads/abc/append`.

- Observation: the current OpenAPI generation starts the server with runtime HTTP plugins, so first-party plugin-private routes appear in generated web API clients today.
  Evidence: `apps/server/scripts/export-openapi.ts` calls `createServerApp({ startBackgroundTasks: false })`, and `apps/web/src/api-gen/sdk.gen.ts` contains functions such as `getApiPluginsNowledgeMemConfig`.

## Decision Log

- Decision: The activation switch is Cradle host-owned lifecycle policy, not plugin-owned configuration.
  Rationale: Host-owned policy answers "should this plugin package be active at all?" Plugin-owned configuration answers "what should this plugin do after activation?" Mixing these concepts would let a plugin decide whether it is disabled, which breaks ownership and makes runtime guarantees impossible.
  Date/Author: 2026-06-20 / Codex

- Decision: Implement plugin-level activation first, not capability-level activation.
  Rationale: Capability-level switches require a second policy layer for routes, MCP servers, skills, hooks, and panels. The immediate problem is that a plugin package cannot be turned off honestly. Package-level lifecycle is the foundation that later capability switches can build on.
  Date/Author: 2026-06-20 / Codex

- Decision: Do not ship a UI-only toggle or a "restart required" switch as the main design.
  Rationale: A UI-only flag would leave plugin routes and runtime registrations alive. A restart-only flag would be simpler but would not solve the active-session problem that motivated this work. The correct first-class behavior is hot disable and hot enable.
  Date/Author: 2026-06-20 / Codex

- Decision: Replace direct route mounting with a Cradle-owned route dispatcher before implementing hot disable.
  Rationale: Once a route is registered into Elysia, the current code cannot unmount it from the main server. A dispatcher lets Cradle check activation state on every plugin route request and remove handlers from an owned registry during disable.
  Date/Author: 2026-06-20 / Codex

- Decision: Store activation policy in the Cradle database with Drizzle, not in plugin storage or environment variables.
  Rationale: AGENTS.md requires Drizzle for database interactions and emphasizes namespace ownership. Plugin activation is Cradle-owned persistent product state, while plugin storage is owned by each plugin and environment variables are unsuitable for a GUI application.
  Date/Author: 2026-06-20 / Codex

- Decision: Keep plugin-private runtime routes out of the stable host OpenAPI surface after introducing the dispatcher.
  Rationale: A single dynamic dispatcher cannot truthfully generate typed host client functions for plugin-owned route schemas. Plugin web code already uses `ctx.routes.fetch(...)`, and the stable host API should describe Cradle-owned plugin management routes such as list/get/toggle.
  Date/Author: 2026-06-20 / Codex

- Decision: This backend implementation does not promise to mutate MCP configuration inside already-started agent runtime sessions.
  Rationale: Disabling a plugin will remove the plugin MCP server from Cradle's registry and therefore from future Codex, Claude, and ACP runtime config projections. Existing provider processes or already-started sessions may have copied config at session start; hot mutation of those sessions would require a separate runtime-session lifecycle design.
  Date/Author: 2026-06-20 / Codex

- Decision: Defer the frontend management UI for this implementation pass.
  Rationale: The user explicitly requested the full implementation except frontend. Backend API, descriptors, tests, and CLI metadata are enough to prove activation behavior now, while the frontend can be added in a follow-up without changing lifecycle semantics.
  Date/Author: 2026-06-20 / Codex

## Outcomes & Retrospective

Backend implementation is complete for this pass. Cradle now stores host-owned plugin activation policy, projects activation into descriptors, exposes host management APIs and generated CLI commands, dispatches plugin-private routes through a removable registry, and hot disables or re-enables server-layer runtime registrations. Disabled plugins remain visible through management descriptors, but their server routes, MCP registrations, skills, hooks, provider/issue source registrations, and web bundle serving are removed from the active runtime surface.

The frontend management screen remains intentionally deferred because the implementation request excluded frontend work. The backend contract is ready for that follow-up: app-owned UI can call `GET /plugins`, `GET /plugins/:routeSegment`, and `PATCH /plugins/:routeSegment/enabled`, or operators can use the generated CLI commands.

## Context and Orientation

A Cradle plugin is a package under `plugins/*` with Cradle metadata in its `package.json`. A plugin may have a server entry, a web entry, and a desktop entry. In this plan, an "entry" means a JavaScript file that Cradle imports or serves so the plugin can register behavior. Server entries receive a `ServerPluginContext` from `packages/plugin-sdk/src/server.ts`. Web entries are served to the renderer and activated by the web plugin host.

The plugin loader lives in `apps/server/src/plugins/loader.ts`. On startup it discovers plugin packages, creates descriptors in `apps/server/src/plugins/runtime-registry.ts`, checks permission policy, imports each enabled server entry, creates a plugin context with `apps/server/src/plugins/context.ts`, and then mounts plugin routes. A plugin descriptor is the server's public record of a plugin's identity, route segment, activation state, layers, capabilities, and errors. It is typed in `packages/plugin-sdk/src/index.ts`.

The important current limitation is route lifecycle. In `apps/server/src/plugins/context.ts`, `ctx.routes.register(...)` immediately calls methods on an Elysia app. Elysia is the HTTP framework used by Cradle server. A plugin route handler can be marked disposed, but the route itself remains mounted. This is acceptable for full shutdown, but it is not enough for a user switch that should make a route disappear immediately.

Runtime capabilities are already disposable. A "capability" is a registered behavior such as an MCP server, skill, server route, or chat hook. `ctx.subscriptions` stores disposables. When `deactivateAllPlugins()` in `apps/server/src/plugins/loader.ts` runs, it calls plugin `deactivate` if present and then disposes subscriptions in reverse order. MCP registrations live in `apps/server/src/plugins/mcp-registry.ts`; skills live in `apps/server/src/plugins/skill-registry.ts`; hooks live in `apps/server/src/plugins/hooks.ts`; runtime capability metadata lives in `apps/server/src/plugins/runtime-registry.ts`.

Persistent server plugin storage is defined in `packages/db/src/schema/plugin.ts` and implemented in `apps/server/src/plugins/storage.ts`. That storage is plugin-scoped key/value data. The activation switch should not use this key/value store because a disabled plugin should not own or modify the policy that decides whether it can activate. Instead, add a separate Cradle-owned activation policy table in the same schema file.

The public server module for plugin-related HTTP routes is `apps/server/src/modules/plugins`. It currently exposes plugin mention candidates and plugin icons at host-owned routes such as `/plugins/mentions` and `/plugins/{routeSegment}/icon`. The static `/api/plugins` routes that list descriptors and serve plugin web bundles are currently created in `apps/server/src/plugins/static-server.ts` and mounted from `loader.ts`. This plan should coordinate those surfaces so plugin management APIs live in the `modules/plugins` namespace while plugin-owned runtime routes and web bundles remain under `/api/plugins/{routeSegment}` for web plugin compatibility.

The web app loads plugins in `apps/web/src/main.tsx` through `apps/web/src/lib/plugin-host`. Plugin panels are surfaced through `apps/web/src/routes/plugins/$routeSegment/$localId.tsx` and `apps/web/src/features/plugins`. The plugin management UI should be an app-owned feature, not a plugin panel, because users must be able to enable a disabled plugin whose panel cannot be loaded.

## Plan of Work

Milestone 1 changes plugin HTTP route ownership without changing user behavior. Add a server-side plugin route registry, for example `apps/server/src/plugins/route-registry.ts`. It should store route records keyed by plugin owner, route segment, HTTP method, and normalized path. It should expose functions such as `registerPluginRoute(owner, routeSegment, route)`, `unregisterPluginRoute(owner, routeId)`, `resetPluginRouteRegistry()`, and `handlePluginRouteRequest(routeSegment, method, path, context)`. A "normalized path" means a path that always starts with `/`, never has duplicate leading slashes, and uses the same `:paramName` syntax that plugin authors already use.

Modify `apps/server/src/plugins/context.ts` so `createServerPluginContext` no longer requires an Elysia sub-app for route registration. Instead, it should receive or derive the plugin route segment and call `registerPluginRoute(...)` from `ctx.routes.register(...)`. The returned disposable should remove the route record and unregister the runtime capability. Preserve existing route capability metadata: method, path, label, and plugin local route id. Existing plugin route handlers receive a `ServerPluginRouteContext`; the dispatcher must keep the same `body`, `params`, `query`, `headers`, and `set` behavior.

Modify `apps/server/src/plugins/loader.ts` so the main server mounts one dispatcher route for plugin-owned APIs, rather than mounting each plugin's own Elysia sub-app. The dispatcher route should be under `/api/plugins/:routeSegment/*`, plus a companion route for `/api/plugins/:routeSegment` if root plugin routes are supported. In Elysia 1.4.28, the wildcard remainder is available as `params["*"]`. It must not intercept `/api/plugins/` or `/api/plugins/:routeSegment/web.mjs`; those remain host-owned plugin list and asset routes. The host mention API lives at `/plugins/mentions`, not `/api/plugins/mentions`.

Acceptance for Milestone 1 is no user-visible behavior change. Existing first-party plugin routes such as `/api/plugins/nowledge-mem/config` still work. A new route registry test proves that disposing a plugin route removes it from dispatch rather than leaving a live Elysia handler. Existing `apps/server/src/plugins/context.test.ts` and `apps/server/src/plugins/loader.test.ts` should be updated to use the route registry instead of a test Elysia sub-app where appropriate.

Milestone 2 adds persistent activation policy. In `packages/db/src/schema/plugin.ts`, add a Drizzle table named `pluginActivationPolicies`. Use an explicit plugin identity column such as `pluginName` or `pluginIdentity`; choose one name and use it consistently. A recommended shape is `id`, `pluginName`, `enabled`, `reason`, plus timestamps. Use `int('enabled', { mode: 'boolean' }).notNull().default(true)` for the boolean, following existing schema patterns. Add a unique index on `pluginName`. Export select and insert types. Generate a Drizzle migration with the repository's normal migration command after implementation; do not hand-write raw SQL unless the project migration workflow requires generated SQL output.

Create a host service for activation policy. The natural place is `apps/server/src/plugins/activation-policy.ts` because the loader needs it before HTTP modules are initialized. The service should expose `readPluginActivationPolicy(pluginName)`, `listPluginActivationPolicies()`, `setPluginActivationPolicy(pluginName, input)`, and `isPluginEnabled(pluginName)`. `isPluginEnabled` must default to `true` when no row exists, so existing installations keep all plugins enabled until a user disables one.

Extend `packages/plugin-sdk/src/index.ts` with a descriptor activation field. Add:

    export interface PluginActivationState {
      enabled: boolean
      source: 'default' | 'user'
      reason?: string
      updatedAt?: number
    }

Then add `activation: PluginActivationState` to `PluginDescriptor`. Update `apps/server/src/plugins/runtime-registry.ts` so `createPluginDescriptor(...)` initializes activation to `{ enabled: true, source: 'default' }`. Add a function like `setPluginActivationState(owner, activation)` and use it during discovery and policy changes. This field lets the UI distinguish "disabled by user" from "failed to activate".

Milestone 3 teaches the loader to honor and change activation policy. During `activateServerPlugins(app)`, after descriptors are registered and before web/server activation, read activation policies and write them into descriptors. If a plugin is disabled, mark its server, web, and desktop layers that have entries as `disabled` with a clear reason, and do not import the server module or serve the web bundle. It is important that disabled plugins still have descriptors so users can see and re-enable them.

Refactor active plugin state in `apps/server/src/plugins/loader.ts`. Today `activePlugins` stores only `deactivate` and subscriptions. It should store enough information to deactivate one plugin by identity and then activate it again later: manifest, source descriptor if needed, route segment, imported module reference if reuse is appropriate, subscriptions, and whether it is active. Add exported functions such as `enablePlugin(pluginName)`, `disablePlugin(pluginName, reason)`, and `reloadPlugin(pluginName)` only if needed. These functions are host lifecycle operations and should be used by the HTTP module.

The disable path must do all of the following in order: write policy `enabled = false`, call plugin `deactivate` if present, dispose subscriptions, clear plugin route records, remove runtime capability records, mark layers as `disabled`, and leave the descriptor in the registry. The enable path must write policy `enabled = true`, mark layers as activating as appropriate, import and activate the server entry, allow web serving again, and mark layers active or failed. If activation fails, policy remains enabled but the layer becomes `failed` with the error. This distinction matters because "enabled but failed" tells the user that Cradle tried to start it.

Milestone 4 adds server APIs in `apps/server/src/modules/plugins`. Add TypeBox schemas in `model.ts` for full plugin descriptors, activation state, and update body. Add routes in `index.ts`: `GET /plugins`, `GET /plugins/:pluginName`, and `PATCH /plugins/:pluginName/enabled`. If route parameter encoding of scoped package names such as `@cradle/nowledge-mem` is awkward, accept either `pluginName` in the request body or use route segment in the path and resolve with `getPluginDescriptorByRouteSegment`. Be explicit in tests. The update body should be:

    {
      enabled: boolean,
      reason?: string
    }

Return the updated descriptor after changes. Add `x-cradle-cli` metadata only if the route is useful as a stable agent-facing CLI command; a toggle command is useful, so add metadata unless the project has a reason not to expose it. If CLI metadata is added, run the CLI generation steps in validation.

Update `apps/server/src/modules/plugins/service.ts` to project plugin descriptors into a stable response model. Do not expose secrets. Include identity, routeSegment, displayName, description, iconUrl, source kind, activation, layers, declared capabilities, runtime capabilities, warnings, and an `active` boolean. Make mention search exclude disabled plugins from active mention candidates unless the design intentionally shows disabled mentions with disabled badges. The recommended behavior is to exclude disabled plugins from composer mentions because selecting them cannot work.

Milestone 5 is deferred in this backend-only pass. A future frontend pass should add an app-owned plugin management surface under an existing settings or plugin feature namespace, for example `apps/web/src/features/plugins/plugin-management-panel.tsx` and a route or settings tab that can host it. The UI should call the backend API added by Milestone 4. Do not put the management UI inside a plugin panel, because disabled plugins cannot provide their own web UI.

Milestone 6 updates backend generated artifacts, docs, and tests. Generate the Drizzle migration with `pnpm --filter @cradle/db generate`. If adding `x-cradle-cli` metadata, run `pnpm gen:cli` and `pnpm --filter @cradle/cli typecheck`. Do not regenerate web API clients in this pass unless a later frontend implementation consumes the new plugin management API. Update `apps/server/src/plugins/README.md`, `apps/server/src/modules/plugins/README.md`, `packages/plugin-sdk/DEVELOPERS.md` if present, and any plugin management docs to explain the distinction between host activation and plugin-owned settings. Specifically call out that Nowledge Mem's plugin config `enabled` is not the same as Cradle's plugin activation policy.

## Concrete Steps

Work from the repository root:

    cd /Users/wibus/dev/Cradle

Before editing, inspect the current plugin lifecycle:

    rg -n "createServerPluginContext|activePlugins|ctx.routes|app.use\\(pluginApp\\)|createPluginStaticServer" apps/server/src/plugins packages/plugin-sdk/src apps/server/src/modules/plugins

Expected current evidence: `loader.ts` creates an Elysia `pluginApp`, passes it to `createServerPluginContext`, and mounts it with `app.use(pluginApp)`. `context.ts` registers plugin routes by calling Elysia methods directly.

Implement Milestone 1 first. Create `apps/server/src/plugins/route-registry.ts`. Keep it independent from activation policy so tests can prove route dispatch works before persistence exists. Use existing `ServerPluginRouteRegistration` and `ServerPluginRouteContext` types from `@cradle/plugin-sdk/server`. If matching `:paramName` paths is easier with an existing router utility already in the repo, use that; otherwise implement a small segment matcher limited to plugin route patterns already used by first-party plugins. Do not use a heuristic matcher that accepts ambiguous routes silently. If two route records for the same plugin have the same method and normalized path, throw an error.

Update `apps/server/src/plugins/context.ts`. Change `createServerPluginContext(manifest, pluginApp)` to `createServerPluginContext(manifest)` or `createServerPluginContext(manifest, { routeSegment })`. Update every call site and test. `ctx.routes.register(...)` should register the route in the new registry and return a disposable that unregisters it. Keep registering the `server-route` capability in `runtime-registry.ts`.

Update `apps/server/src/plugins/loader.ts`. Remove the per-plugin `new Elysia({ prefix: ... })` for route mounting. Add one plugin dispatcher to the main app. A request to `/api/plugins/nowledge-mem/config` should call the Nowledge plugin's `GET /config` handler with the same route context as before. After this milestone, run:

    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/loader.test.ts

Expected result after Milestone 1: the tests pass, and any new test named like "removes plugin routes from dispatcher on dispose" passes. Before the change, that new test should fail because there is no dispatcher-owned route table to remove from.

Implement Milestone 2. Edit `packages/db/src/schema/plugin.ts` and add the activation policy table. Export the new table from `packages/db/src/schema/index.ts` if it is not automatically picked up. Generate a Drizzle migration using the repository's existing migration command. If unsure of the exact command, inspect `package.json` scripts and existing `packages/db/drizzle` files, then use the command already used by this repo. Do not hand-edit unrelated migration files.

Create `apps/server/src/plugins/activation-policy.ts` and focused tests such as `apps/server/src/plugins/activation-policy.test.ts`. Tests should use the existing test database setup pattern from nearby server tests. Prove default enabled behavior and explicit disabled behavior:

    expect(await isPluginEnabled('@cradle/example')).toBe(true)
    await setPluginActivationPolicy('@cradle/example', { enabled: false, reason: 'test' })
    expect(await isPluginEnabled('@cradle/example')).toBe(false)

Implement Milestone 3. Update `packages/plugin-sdk/src/index.ts` and `apps/server/src/plugins/runtime-registry.ts` for descriptor activation state. Update `apps/server/src/plugins/loader.ts` with `disablePlugin` and `enablePlugin`. Add loader tests for startup disabled and hot disable:

    disabled plugin is discovered but server activate() is not called
    disabling an active plugin removes its MCP server, skill, route, and active layer status
    enabling a disabled plugin activates it and restores its route
    activation failure after enabling leaves activation.enabled true and layer.status failed

Run:

    pnpm --filter @cradle/server exec vitest run src/plugins/loader.test.ts src/plugins/context.test.ts src/plugins/runtime-registry.test.ts

Implement Milestone 4. Update `apps/server/src/modules/plugins/model.ts`, `apps/server/src/modules/plugins/service.ts`, and `apps/server/src/modules/plugins/index.ts`. Add tests in an existing server test file or a new focused `apps/server/tests/plugins.test.ts`. Include tests for listing descriptors, toggling by route segment or identity, and excluding disabled plugins from mention candidates.

If adding `x-cradle-cli` metadata, run:

    pnpm gen:cli
    pnpm --filter @cradle/cli typecheck
    pnpm --filter @cradle/cli cradle --help

Skip Milestone 5 in this backend-only implementation pass. Do not add frontend components, routes, or web API client usage now.

Run final server checks:

    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/loader.test.ts src/plugins/runtime-registry.test.ts src/plugins/activation-policy.test.ts

If the server plugin API generated client changes, also run whichever API generation validation command the repository uses, and include the generated files in the final change.

## Validation and Acceptance

The feature is accepted when host activation policy controls actual runtime behavior, not only UI state. Because this pass is backend-only, the primary manual scenario uses HTTP or the generated CLI rather than a management screen:

1. Start Cradle server in normal development mode.
2. Request `GET /plugins` or run `cradle plugin list` and confirm `@cradle/nowledge-mem` appears with `activation.enabled: true` if its package is present.
3. Request `/api/plugins/nowledge-mem/config` and observe a normal plugin response.
4. Disable it with `PATCH /plugins/nowledge-mem/enabled` and body `{ "enabled": false, "reason": "manual check" }`, or run `cradle plugin set-enabled nowledge-mem --enabled false --reason "manual check"`.
5. Request `/api/plugins/nowledge-mem/config` again and observe 404 or a disabled response, not a live Nowledge config response.
6. Start a new Codex or Claude runtime session and confirm the Nowledge MCP server is absent from projected MCP config. Existing already-started runtime sessions are outside this plan's live-mutation scope.
7. Re-enable it with `PATCH /plugins/nowledge-mem/enabled` and body `{ "enabled": true }`, or run `cradle plugin set-enabled nowledge-mem --enabled true`.
8. Request `/api/plugins/nowledge-mem/config` and observe the plugin response again.

Automated acceptance must cover the same behavior without relying on the UI. The route registry test proves disposed routes disappear from dispatch. The loader hot-disable test proves server activation effects are disposed. The plugin API test proves the persistent policy can be changed through HTTP. The mention candidate test proves disabled plugins are not offered as active plugin mentions. The runtime MCP projection can be validated by existing Codex and Claude tests if they read from the shared MCP registry after the plugin is disabled.

Focused command set run during implementation:

    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/loader.test.ts src/plugins/runtime-registry.test.ts src/plugins/activation-policy.test.ts
    pnpm --filter @cradle/server exec vitest run tests/plugins.test.ts
    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm exec eslint apps/server/src/plugins apps/server/src/modules/plugins apps/server/tests/plugins.test.ts packages/plugin-sdk/src/index.ts packages/db/src/schema/plugin.ts apps/server/src/app.ts
    pnpm gen:cli
    pnpm --filter @cradle/cli typecheck
    pnpm --filter @cradle/cli cradle --help

A command passing means it exits with code 0. A test that should fail before implementation is the hot-disable route test: before dynamic dispatch exists, disabling or disposing a plugin route cannot remove the already-mounted Elysia route from the server.

## Idempotence and Recovery

The route registry changes are in-memory and can be retried safely. Tests should call reset functions such as `resetPluginRuntimeRegistry()` and the new route registry reset to avoid cross-test contamination. If a plugin activation attempt fails halfway, dispose any subscriptions already created and mark the layer failed. Do not leave a partially active plugin with no descriptor error.

The activation policy migration is additive. If the migration is generated twice, keep only the intended new migration and do not edit unrelated migration snapshots. If the implementation has to rename the activation policy table or columns before commit, regenerate the migration cleanly rather than stacking compatibility shims; the project is pre-release and AGENTS.md explicitly prefers clean architecture over compatibility code.

Disabling a plugin should be safe to repeat. Calling `disablePlugin('@cradle/example')` twice should leave one disabled policy row, no active subscriptions, no route records, and descriptor layers disabled. Enabling a plugin should be safe after a failed activation; it should retry from a clean state after disposing any previous partial subscriptions.

Do not use destructive git commands. The worktree may contain unrelated changes. Stage only files touched by this plan when committing.

## Artifacts and Notes

Important pre-implementation code shape:

    apps/server/src/plugins/loader.ts:
      const pluginApp = new Elysia({ prefix: `/api/plugins/${descriptor.routeSegment}` })
      const ctx = createServerPluginContext(manifest, pluginApp)
      await mod.activate(ctx)
      app.use(pluginApp)

    apps/server/src/plugins/context.ts:
      function registerRoute(route: ServerPluginRouteRegistration): Disposable {
        ...
        if (route.method === 'GET') {
          routeApp.get(normalizedPath, handler)
        }
        ...
      }

These excerpts show why route dispatch had to become host-owned before the switch could be honest.

Implemented route dispatcher:

    apps/server/src/plugins/route-registry.ts:
      registerPluginRoute(owner, routeSegment, route) stores a normalized method/path handler.
      dispatchPluginRoute(input) matches routeSegment + method + path and invokes the plugin handler.
      clearPluginRoutes(owner) removes all plugin-owned handlers during disable or deactivate.

Implemented activation policy:

    packages/db/drizzle/0007_early_spacker_dave.sql:
      CREATE TABLE `plugin_activation_policies` (...)
      CREATE UNIQUE INDEX `plugin_activation_policies_plugin_unique` ...

Implemented host management APIs and generated CLI:

    GET /plugins
    GET /plugins/:routeSegment
    PATCH /plugins/:routeSegment/enabled
    cradle plugin list
    cradle plugin get <routeSegment>
    cradle plugin set-enabled <routeSegment> --enabled <boolean> [--reason <string>]

Recommended new descriptor shape:

    export interface PluginActivationState {
      enabled: boolean
      source: 'default' | 'user'
      reason?: string
      updatedAt?: number
    }

    export interface PluginDescriptor {
      ...
      activation: PluginActivationState
      layers: Record<PluginLayer, PluginLayerState>
      ...
    }

Recommended activation policy schema shape:

    export const pluginActivationPolicies = sqliteTable('plugin_activation_policies', {
      id: textPk(),
      pluginName: text('plugin_name').notNull(),
      enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
      reason: text('reason'),
      ...timestamps(),
    }, table => ({
      byPlugin: uniqueIndex('plugin_activation_policies_plugin_unique').on(table.pluginName),
    }))

Use the exact schema style that fits `packages/db/src/schema/plugin.ts` during implementation. The key requirements are unique plugin identity, boolean enabled state, optional reason, and timestamps.

## Interfaces and Dependencies

Use Drizzle ORM for persistence. Do not write raw SQL queries in service code. Add schema in `packages/db/src/schema/plugin.ts` and migrations under `packages/db/drizzle` using the repository migration workflow.

Add a route registry module:

    apps/server/src/plugins/route-registry.ts

It exports:

    export function registerPluginRoute(owner: string, routeSegment: string, route: ServerPluginRouteRegistration): string
    export function unregisterPluginRoute(routeId: string): void
    export function clearPluginRoutes(owner: string): void
    export function resetPluginRouteRegistry(): void
    export async function dispatchPluginRoute(input: PluginRouteDispatchInput): Promise<PluginRouteDispatchResult>

`registerPluginRoute` returns the route id so the plugin context can unregister the exact handler when a route disposable is disposed. `dispatchPluginRoute` accepts a `set` object compatible with `ServerPluginRouteContext.set`; the Elysia dispatcher copies status and headers back to the HTTP response.

Add activation policy service:

    apps/server/src/plugins/activation-policy.ts

It should export:

    export interface PluginActivationPolicy {
      pluginName: string
      enabled: boolean
      reason?: string | null
      updatedAt?: number
    }

    export function listPluginActivationPolicies(): PluginActivationPolicy[]
    export function readPluginActivationPolicy(pluginName: string): PluginActivationPolicy | null
    export function isPluginEnabled(pluginName: string): boolean
    export function setPluginActivationPolicy(pluginName: string, input: { enabled: boolean, reason?: string | null }): PluginActivationPolicy

Add loader lifecycle functions in `apps/server/src/plugins/loader.ts` or a new helper if the file becomes too large:

    export async function enablePlugin(pluginName: string): Promise<PluginDescriptor>
    export async function disablePlugin(pluginName: string, reason?: string): Promise<PluginDescriptor>

These functions should be the only server API path for changing plugin activation. UI and CLI should call HTTP routes, and HTTP routes should call these functions.

Add plugin module routes under `apps/server/src/modules/plugins/index.ts`:

    GET /plugins
    GET /plugins/:routeSegment
    PATCH /plugins/:routeSegment/enabled

Prefer route segment in the URL because it avoids scoped package name encoding issues and matches existing icon routes. The service can resolve route segment to descriptor identity with `getPluginDescriptorByRouteSegment`.

The web UI is deferred. When implemented later, it should use generated API client functions after regeneration and place domain-specific UI in `apps/web/src/features/plugins`, not in `components/ui`, because plugin management is Cradle application behavior, not a reusable primitive.

Revision note 2026-06-20 10:02Z: Initial plan drafted from current plugin loader, context, static server, runtime registry, plugin storage, and plugin module code. The central design decision is to implement dynamic route dispatch before exposing a user-facing activation switch.

Revision note 2026-06-20 11:06Z: Revised before backend implementation. The plan now excludes frontend work for this pass, records the Elysia wildcard dispatch shape, keeps plugin-private routes out of the stable host OpenAPI contract, and clarifies that already-started runtime sessions are not live-mutated when MCP registrations are removed.

Revision note 2026-06-20 11:36Z: Updated after backend implementation. The plan now records the implemented route dispatcher, activation policy migration, loader hot lifecycle functions, management APIs, generated CLI commands, focused validation evidence, and the explicit remaining frontend UI gap.

Revision note 2026-06-20 11:39Z: Added final validation evidence after rerunning focused tests, type checks, lint, CLI help, and whitespace checks.
