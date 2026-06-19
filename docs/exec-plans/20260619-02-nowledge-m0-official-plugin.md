# Nowledge Mem M0 Official Plugin Support

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained: a contributor who has only this repository and this file should be able to understand and complete the M0 official Nowledge Mem plugin without relying on prior chat history.

## Purpose / Big Picture

Cradle should use Nowledge Mem as the first serious official plugin case, not as a one-off native module. After M0, a user running Cradle with the bundled `@cradle/nowledge-mem` plugin can verify that Cradle sees Nowledge Mem, read Working Memory, fetch a Context Bundle, search memories and threads, create or append Nowledge threads, and expose a skill that teaches agents how to use the plugin surface. This proves that Cradle's plugin system can host a real memory integration while keeping data ownership clean: Nowledge owns memories, threads, spaces, graph, and remote credentials; Cradle owns only the plugin package, plugin-local non-secret configuration, and the route/tool surfaces it exposes.

M0 intentionally does not claim automatic pre-turn recall, automatic turn capture, pre-compaction capture, or cross-runtime tool exposure. Those require later plugin host lifecycle work. M0 is complete when the plugin can be built, discovered by the existing plugin host, exercised through `/api/plugins/nowledge-mem/*` routes against a mocked Nowledge API, and validated with focused tests.

## Progress

- [x] (2026-06-19T03:19:37Z) Read the ExecPlan rules and confirmed the non-negotiables: the plan must be self-contained, living, novice-friendly, concrete about commands and files, and independently verifiable.
- [x] (2026-06-19T03:19:37Z) Confirmed the next plan filename for the day is `docs/exec-plans/20260619-02-nowledge-m0-official-plugin.md`.
- [x] (2026-06-19T03:19:37Z) Researched existing first-party plugin patterns in `plugins/system-info`, `plugins/browser-use`, and `plugins/github-issues`.
- [x] (2026-06-19T03:19:37Z) Confirmed the current plugin host supports server routes, plugin-scoped KV storage, skill registration, and stdio-shaped MCP registration, but not streamable HTTP MCP or wired chat lifecycle hooks.
- [ ] Create the `plugins/nowledge-mem` package, manifest, Vite config, TypeScript config, server entry, client modules, tests, and bundled skill.
- [ ] Update plugin manifest boundary coverage so `@cradle/nowledge-mem` is treated as a first-party plugin.
- [ ] Build and test the new plugin against mocked Nowledge API responses.
- [ ] Run focused server plugin tests and TypeScript checks that prove the new package fits the existing host.

## Surprises & Discoveries

- Observation: Cradle's existing plugin hook registry is not enough for Nowledge automatic recall or capture because the exported hook runner functions are not called from Chat Runtime.
  Evidence: `apps/server/src/plugins/hooks.ts` exports `runBeforeQueryHooks` and `runAfterResponseHooks`, but repository search only finds those functions in plugin host exports and tests, not in the ordinary chat runtime path.

- Observation: Cradle's MCP registry is currently stdio-shaped only.
  Evidence: `apps/server/src/plugins/mcp-registry.ts` validates only `name`, `command`, `args`, `env`, and `when`. Nowledge direct MCP uses a `streamableHttp` config with `url` and `type`.

- Observation: Nowledge's current plugin examples use HTTP memory search as `GET /memories/search?q=...`, while thread search uses `GET /threads/search?query=...`.
  Evidence: The current Nowledge Alma plugin client calls `_fetch("GET", "/memories/search", { params: { q, limit } })` and `_fetch("GET", "/threads/search", { params: { query, limit } })`.

- Observation: The existing Cradle plugin route segment for a first-party package named `@cradle/nowledge-mem` will be `nowledge-mem`.
  Evidence: `apps/server/src/plugins/runtime-registry.ts` calls `derivePluginRouteSegment(identity)`, and existing tests assert `@cradle/system-info` maps to `system-info`.

## Decision Log

- Decision: Implement M0 as an official first-party plugin under `plugins/nowledge-mem`, not as `apps/server/src/modules/nowledge`.
  Rationale: The goal is official plugin support and a path to expand Cradle Plugin System capability. Putting Nowledge semantics directly in Chat Runtime would bypass the plugin architecture we want to strengthen.
  Date/Author: 2026-06-19 / Codex

- Decision: M0 uses Nowledge's HTTP API as the primary transport and does not require `nmem` on PATH.
  Rationale: HTTP routes are the cleanest fit for a server plugin and are easy to test with a local mock. `nmem` remains useful later for diagnostics and native transcript import, but M0 should not depend on a local CLI installation.
  Date/Author: 2026-06-19 / Codex

- Decision: M0 does not store Nowledge API keys in plugin KV storage.
  Rationale: Plugin storage is plain plugin-scoped KV, not a secret manager. Until Cradle exposes a plugin-safe secret API, the plugin should read credentials from `NMEM_API_KEY`, `NMEM_API_URL`, or Cradle shared config injected by the host. Non-secret settings such as endpoint URL, default space, and enabled flags may live in plugin storage.
  Date/Author: 2026-06-19 / Codex

- Decision: M0's public plugin routes are narrow adapter routes, not generic Nowledge proxy tunnels.
  Rationale: A generic proxy would blur ownership and make permissions harder to reason about. M0 should expose explicit operations: status, config, Working Memory, Context Bundle, memory search/write, thread search/read/create/append.
  Date/Author: 2026-06-19 / Codex

- Decision: Automatic recall, automatic capture, streamable HTTP MCP, provider-neutral tool exposure, and pre-compaction hooks are out of scope for M0.
  Rationale: Those require host capabilities that do not exist yet. M0 should be honest and useful rather than fake lifecycle behavior with ad hoc background logic.
  Date/Author: 2026-06-19 / Codex

## Outcomes & Retrospective

No implementation has been completed yet. This plan defines M0 scope and the expected implementation path. At the end of M0, update this section with what was built, what tests passed, which routes were exercised, and which follow-up host capabilities remain for M1.

## Context and Orientation

Cradle plugins are packages under `plugins/*`. A plugin package has a `package.json` with a `cradle` manifest. The manifest declares the plugin identity, entries, capabilities, and permissions. The server plugin host discovers these packages from `plugins/`, derives a route segment from the package name, imports the server entry, and mounts routes under `/api/plugins/{routeSegment}`.

The main existing plugin examples are:

- `plugins/system-info`, a simple server and web plugin. Its server entry `plugins/system-info/src/server.ts` registers `GET /info`.
- `plugins/browser-use`, a server and desktop plugin. Its server entry registers a stdio MCP server and a bundled skill.
- `plugins/github-issues`, a server plugin that registers an external issue source.

The server plugin API is defined in `packages/plugin-sdk/src/server.ts`. The important M0 pieces are:

- `ctx.routes.register(...)`, which registers plugin-owned HTTP routes below `/api/plugins/{routeSegment}`.
- `ctx.skills.register(...)`, which registers a skill file for agent discovery.
- `ctx.storage.get/set/delete(...)`, which provides plugin-scoped non-secret persistent key-value storage.
- `ctx.sharedConfig`, which reads environment variables prefixed with `CRADLE_PLUGIN_`.
- `ctx.logger`, which logs plugin-owned diagnostics.

The host implementation lives in `apps/server/src/plugins`. `apps/server/src/plugins/context.ts` builds `ServerPluginContext`. `apps/server/src/plugins/loader.ts` discovers packages and mounts plugin routes. `apps/server/src/plugins/runtime-registry.ts` records capabilities and derives route segments. `apps/server/src/plugins/manifest-boundary.test.ts` validates first-party plugin manifests.

Nowledge Mem is an external memory product. In this plan, a memory is durable user or agent knowledge stored by Nowledge. A thread is a saved conversation stored by Nowledge. Working Memory is Nowledge's daily briefing or short-lived context surface. A Context Bundle is a Nowledge API response that packages Working Memory and relevant memory context for an agent. A space is Nowledge's optional lane or profile identifier. Cradle must not write Nowledge data into Chronicle tables or any other Cradle-owned memory namespace. Cradle's plugin only calls Nowledge-owned APIs.

The Nowledge API shape used for M0 is:

- `GET /health` for basic health when available.
- `GET /agent/working-memory` to read Working Memory. It accepts `space_id` when a non-default space is configured.
- `GET /context/bundle` to read Context Bundle. The plugin should pass `source_app=cradle`, optional `agent_id`, optional `host_agent_id`, optional `space_id`, and `include_working_memory=true` by default.
- `GET /memories/search?q=...&limit=...` for memory search. Use `q`, not `query`.
- `POST /memories` for memory creation or upsert when the caller explicitly asks to write memory.
- `GET /threads/search?query=...&limit=...` for thread search. Use `query`, not `q`.
- `GET /threads/{thread_id}?limit=...&offset=...` for thread read.
- `POST /threads` for thread creation from `thread_id`, `title`, `source`, and `messages`.
- `POST /threads/{thread_id}/append` for appending messages to an existing thread.

## Plan of Work

The first milestone is to create the plugin package. Add `plugins/nowledge-mem/package.json` with name `@cradle/nowledge-mem`, `type: "module"`, a private version, `cradle.apiVersion: "1"`, `displayName: "Nowledge Mem"`, `description`, `server: "dist/server.mjs"`, and declared capabilities for each route plus the bundled skill. Add `plugins/nowledge-mem/vite.config.ts`, `plugins/nowledge-mem/tsconfig.json`, and a build script matching the existing plugin style. The build should compile `src/server.ts` to `dist/server.mjs` and copy `SKILL.md` to `dist/SKILL.md`.

The second milestone is to implement a typed Nowledge HTTP client. Create `plugins/nowledge-mem/src/nowledge-client.ts`. The client should accept an endpoint URL, optional API key, optional default space, and optional fetch implementation for tests. It should normalize the base URL by trimming trailing slashes. It should send `Accept: application/json` and `Content-Type: application/json` for JSON bodies. If an API key is present, send it as `Authorization: Bearer <key>`. Do not put secrets in URL query strings or logs. The client should expose methods named `readHealth`, `readWorkingMemory`, `readContextBundle`, `searchMemories`, `createMemory`, `searchThreads`, `readThread`, `createThread`, and `appendThread`.

The third milestone is to implement plugin configuration. Create `plugins/nowledge-mem/src/config.ts`. Define a `NowledgePluginConfig` type with `apiUrl`, `spaceId`, `enabled`, and maybe `captureEnabled` / `recallEnabled` fields that default to false for M0 because automatic lifecycle is not implemented. The default API URL is `http://127.0.0.1:14242`. Read API key from `ctx.sharedConfig.get("NMEM_API_KEY")`, `process.env.NMEM_API_KEY`, or a future host-injected value. Read API URL first from plugin storage, then `ctx.sharedConfig.get("NMEM_API_URL")`, then `process.env.NMEM_API_URL`, then the default. The config route must never return the API key value; it may return `hasApiKey: boolean`.

The fourth milestone is to implement the server entry. Create `plugins/nowledge-mem/src/server.ts`. In `activate(ctx)`, register these routes:

- `GET /status`: returns plugin status, effective non-secret config, `hasApiKey`, and a Nowledge health probe result.
- `GET /config`: returns non-secret config and `hasApiKey`.
- `PUT /config`: accepts non-secret config updates. It may update `apiUrl`, `spaceId`, and `enabled`; it must ignore or reject `apiKey`.
- `GET /working-memory`: calls `client.readWorkingMemory`.
- `GET /context-bundle`: calls `client.readContextBundle` with `source_app=cradle`.
- `GET /memories/search`: requires `q`, accepts `limit`, `mode`, and optional `space_id`, then calls `client.searchMemories`.
- `POST /memories`: creates a Nowledge memory through explicit caller input.
- `GET /threads/search`: requires `query`, accepts `limit` and `source`, then calls `client.searchThreads`.
- `GET /threads/:threadId`: reads a Nowledge thread with optional `limit` and `offset`.
- `POST /threads`: creates a Nowledge thread. Default `source` to `cradle` if the body omits it.
- `POST /threads/:threadId/append`: appends messages to a Nowledge thread.

Route handlers should validate incoming query and body data using `zod` or small local validation functions. Prefer `zod` because the repository already depends on it and plugin packages can add it explicitly. On upstream failures, return structured errors with `ok: false`, `code`, and `message`, and set an appropriate HTTP status. Do not log request bodies that may contain memory content or API keys.

The fifth milestone is to register a bundled skill. Add `plugins/nowledge-mem/SKILL.md` and copy it during build. The skill should teach agents to use the plugin routes and Nowledge semantics honestly. It should say that M0 supports guided read/search/write and explicit thread operations, but not automatic recall or automatic capture. In `activate(ctx)`, register the skill as `nowledge-mem` with a description that triggers when a task needs Nowledge memories, Working Memory, thread lookup, or explicit memory distillation.

The sixth milestone is to add focused tests. Create `plugins/nowledge-mem/src/nowledge-client.test.ts` to test URL construction, auth header behavior, `q` versus `query` parameters, space propagation, and error mapping with a mocked fetch. Create `plugins/nowledge-mem/src/server.test.ts` using an Elysia app and `createServerPluginContext` when practical, or instantiate route handlers through a small exported registration helper. Tests should prove that `GET /memories/search?q=alpha` calls upstream `/memories/search?q=alpha`, `GET /threads/search?query=alpha` calls upstream `/threads/search?query=alpha`, `PUT /config` does not persist an API key, and `GET /config` returns only `hasApiKey`.

The seventh milestone is to update first-party plugin manifest validation. Edit `apps/server/src/plugins/manifest-boundary.test.ts` and add `plugins/nowledge-mem/package.json` to `firstPartyPluginManifests`. This makes the plugin part of the strict manifest contract.

The eighth milestone is validation. Build the plugin, run its tests, run the manifest boundary test, run server plugin context tests if new helpers touched plugin host code, and run TypeScript checks for the new plugin and server boundary. M0 does not require browser automation or live Nowledge API smoke because this plan intentionally uses mocked Nowledge HTTP responses for repeatable validation. If a developer has a local Nowledge instance, the Artifacts section includes optional manual curl checks.

## Concrete Steps

Work from the repository root:

    cd /Users/wibus/dev/Cradle

Create the plugin directory:

    mkdir -p plugins/nowledge-mem/src

Add these files:

    plugins/nowledge-mem/package.json
    plugins/nowledge-mem/vite.config.ts
    plugins/nowledge-mem/tsconfig.json
    plugins/nowledge-mem/SKILL.md
    plugins/nowledge-mem/src/config.ts
    plugins/nowledge-mem/src/nowledge-client.ts
    plugins/nowledge-mem/src/server.ts
    plugins/nowledge-mem/src/nowledge-client.test.ts
    plugins/nowledge-mem/src/server.test.ts

The package manifest should be valid under `parseCradlePluginPackageJsonText` and should declare at least these capabilities:

    route.status
    route.config
    route.working-memory
    route.context-bundle
    route.memories.search
    route.memories.create
    route.threads.search
    route.threads.read
    route.threads.create
    route.threads.append
    skill.nowledge-mem

Build the plugin:

    pnpm --filter @cradle/nowledge-mem build

Expected result:

    dist/server.mjs exists
    dist/SKILL.md exists
    the command exits with code 0

Run focused plugin tests:

    pnpm --filter @cradle/nowledge-mem exec vitest run src/nowledge-client.test.ts src/server.test.ts

Expected result:

    Test Files  2 passed
    Tests       all passed

Run manifest boundary validation:

    pnpm --filter @cradle/server exec vitest run src/plugins/manifest-boundary.test.ts

Expected result:

    Test Files  1 passed

Run server plugin host context tests if `createServerPluginContext`, capability registration, route registration, or manifest permission behavior was changed:

    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts

Expected result:

    Test Files  1 passed

Run type checks:

    pnpm --filter @cradle/nowledge-mem exec tsc --noEmit
    pnpm --filter @cradle/server exec tsc --noEmit

Expected result:

    no TypeScript errors

Optionally run a local server with the plugin enabled and inspect discovery:

    pnpm --filter @cradle/server dev

Then request the plugin list:

    curl -s http://127.0.0.1:21423/api/plugins | jq '.[] | select(.identity=="@cradle/nowledge-mem") | {identity, routeSegment, layers, capabilities}'

Expected result:

    identity is "@cradle/nowledge-mem"
    routeSegment is "nowledge-mem"
    the server layer status is "active"
    route and skill capabilities are present

If a local Nowledge Mem API is running on `http://127.0.0.1:14242`, manually exercise:

    curl -s 'http://127.0.0.1:21423/api/plugins/nowledge-mem/status' | jq
    curl -s 'http://127.0.0.1:21423/api/plugins/nowledge-mem/working-memory' | jq
    curl -s 'http://127.0.0.1:21423/api/plugins/nowledge-mem/memories/search?q=cradle&limit=3' | jq
    curl -s 'http://127.0.0.1:21423/api/plugins/nowledge-mem/threads/search?query=cradle&limit=3' | jq

Expected result:

    status returns ok true when Nowledge is reachable or ok false with a clear upstream error when it is not
    working-memory returns Nowledge's JSON shape or a structured upstream error
    memory search uses the q parameter
    thread search uses the query parameter

## Validation and Acceptance

M0 is accepted when a user can start Cradle with the official plugin installed in `plugins/nowledge-mem`, see `@cradle/nowledge-mem` in `GET /api/plugins`, and call explicit plugin routes under `/api/plugins/nowledge-mem`.

The most important automated acceptance behavior is transport correctness. A test must prove that memory search calls Nowledge with `q`, not `query`, because Nowledge's current HTTP API silently ignores wrong memory-search parameter names. A separate test must prove that thread search calls Nowledge with `query`, not `q`. Another test must prove that API keys are passed only through headers and are never returned by `/config`.

The most important human acceptance behavior is discoverability. `GET /api/plugins` should show a plugin descriptor with identity `@cradle/nowledge-mem`, route segment `nowledge-mem`, active server layer, and registered route and skill capabilities. The bundled skill should be present after build at `plugins/nowledge-mem/dist/SKILL.md`.

The plugin must not write into Chronicle tables, `~/.nowledge-mem`, `~/.agents/skills`, or any other external product namespace. It may read environment variables and call Nowledge-owned HTTP APIs. All Nowledge writes must go through explicit routes such as `POST /memories`, `POST /threads`, or `POST /threads/:threadId/append`.

M0 should not modify Chat Runtime lifecycle behavior. There should be no claims that automatic recall or automatic capture works. If someone asks how to use M0 in a chat session, the honest answer is to use the registered skill or explicit plugin routes until M1 adds lifecycle hooks.

## Idempotence and Recovery

Creating the plugin package is additive. Re-running the build should overwrite `plugins/nowledge-mem/dist` without changing source files. Re-running tests should not require a live Nowledge service because tests use mocked fetch responses.

`PUT /config` must be idempotent. Sending the same config body twice should leave plugin storage in the same state. If the user clears `spaceId`, subsequent requests should omit `space_id` rather than sending an empty value. If the user clears `apiUrl`, the plugin should fall back to `http://127.0.0.1:14242`.

If a build or test fails halfway, remove only generated output under `plugins/nowledge-mem/dist` and rerun the command. Do not delete plugin storage tables, Chronicle data, or Nowledge data. If an explicit Nowledge write route is exercised against a live Nowledge service during manual smoke, use a temporary title or unique marker and delete it through Nowledge's own UI or API if cleanup is needed.

If implementation reveals that the existing plugin host cannot route parameterized paths such as `/threads/:threadId`, do not add a Nowledge-specific router. Update the plan's Surprises section, add a small generic plugin route-host fix with tests in `apps/server/src/plugins/context.test.ts`, and keep the route API shape stable.

## Artifacts and Notes

The expected plugin `package.json` should look like this in shape, with exact dependency versions resolved by the workspace:

    {
      "name": "@cradle/nowledge-mem",
      "type": "module",
      "version": "0.0.1",
      "private": true,
      "cradle": {
        "apiVersion": "1",
        "displayName": "Nowledge Mem",
        "description": "Official Nowledge Mem adapter for guided memory, Working Memory, thread, and context operations.",
        "server": "dist/server.mjs",
        "contributes": {
          "capabilities": [
            { "id": "route.status", "type": "server-route", "layer": "server", "label": "Nowledge status", "permissions": ["nowledge.network"] },
            { "id": "skill.nowledge-mem", "type": "skill", "layer": "server", "label": "Nowledge Mem skill", "permissions": [] }
          ],
          "permissions": [
            { "id": "nowledge.network", "label": "Connect to Nowledge Mem API", "required": true }
          ]
        }
      },
      "scripts": {
        "build": "vite build && cp SKILL.md dist/SKILL.md",
        "test": "vitest run"
      },
      "dependencies": {
        "zod": "^4.4.3"
      },
      "devDependencies": {
        "@cradle/plugin-sdk": "workspace:*",
        "@types/node": "^22.19.1",
        "vite": "^8.0.0",
        "vitest": "^4.1.4",
        "typescript": "^5.9.3"
      }
    }

The expected successful plugin descriptor excerpt from `GET /api/plugins` should resemble:

    {
      "identity": "@cradle/nowledge-mem",
      "routeSegment": "nowledge-mem",
      "layers": {
        "server": { "status": "active" }
      },
      "capabilities": [
        { "type": "server-route", "label": "Nowledge status" },
        { "type": "skill", "label": "Nowledge Mem skill" }
      ]
    }

The route response shape should be stable and boring. For success:

    {
      "ok": true,
      "data": { "...": "Nowledge response or normalized result" }
    }

For failure:

    {
      "ok": false,
      "code": "nowledge_upstream_error",
      "message": "HTTP 401 from Nowledge Mem API"
    }

Do not include API keys, Authorization headers, or full request bodies in failure payloads.

## Interfaces and Dependencies

In `plugins/nowledge-mem/src/config.ts`, define:

    export interface NowledgePluginConfig {
      apiUrl: string
      spaceId?: string
      enabled: boolean
      recallEnabled: false
      captureEnabled: false
    }

    export interface NowledgeResolvedConfig extends NowledgePluginConfig {
      apiKey?: string
      hasApiKey: boolean
    }

    export async function readNowledgePluginConfig(ctx: ServerPluginContext): Promise<NowledgeResolvedConfig>
    export async function writeNowledgePluginConfig(ctx: ServerPluginContext, input: unknown): Promise<NowledgePluginConfig>

In `plugins/nowledge-mem/src/nowledge-client.ts`, define:

    export interface NowledgeClientOptions {
      apiUrl: string
      apiKey?: string
      spaceId?: string
      fetch?: typeof fetch
    }

    export class NowledgeClient {
      constructor(options: NowledgeClientOptions)
      readHealth(): Promise<unknown>
      readWorkingMemory(input?: { spaceId?: string }): Promise<unknown>
      readContextBundle(input?: { agentId?: string; hostAgentId?: string; includeWorkingMemory?: boolean; spaceId?: string }): Promise<unknown>
      searchMemories(input: { q: string; limit?: number; mode?: "fast" | "deep"; spaceId?: string }): Promise<unknown>
      createMemory(input: unknown): Promise<unknown>
      searchThreads(input: { query: string; limit?: number; source?: string; spaceId?: string }): Promise<unknown>
      readThread(input: { threadId: string; limit?: number; offset?: number; spaceId?: string }): Promise<unknown>
      createThread(input: unknown): Promise<unknown>
      appendThread(input: { threadId: string; messages: unknown[]; idempotencyKey?: string; spaceId?: string }): Promise<unknown>
    }

In `plugins/nowledge-mem/src/server.ts`, define:

    export function activate(ctx: ServerPluginContext): void

If tests need direct route registration without plugin host activation, define an internal helper and export it only for tests:

    export function registerNowledgeRoutes(ctx: ServerPluginContext): void

Use `@cradle/plugin-sdk/server` for plugin context types, `zod` for route input parsing, built-in `fetch` for HTTP calls, and existing Cradle plugin host APIs for route and skill registration. Do not add a database schema or migration for M0.

Revision note, 2026-06-19T03:19:37Z: Initial M0 ExecPlan created to define official plugin support for Nowledge Mem while explicitly deferring lifecycle-heavy native-feeling behavior to later plugin host milestones.
