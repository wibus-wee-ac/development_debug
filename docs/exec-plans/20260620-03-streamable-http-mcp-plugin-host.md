# Streamable HTTP MCP Plugin Host

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained: a contributor who has only this repository and this file should be able to add streamable HTTP MCP support to Cradle's plugin host without relying on prior chat history.

## Purpose / Big Picture

Cradle plugins can currently register MCP servers only as local stdio processes: the plugin gives Cradle a command, arguments, and environment variables, and an agent runtime starts that process. Nowledge Mem and other modern MCP providers may expose an MCP endpoint over HTTP instead. After this change, a server plugin can register either a stdio MCP server or a streamable HTTP MCP server through the same plugin-owned `ctx.mcp.registerServer(...)` surface. Cradle will preserve ownership boundaries: plugins own their MCP registrations, the plugin host owns the registry and capability projection, and chat runtime providers only receive MCP entries they can safely consume.

The user-visible outcome is narrow and observable. A test plugin can register a streamable HTTP MCP server with a URL, and Cradle's plugin registry will show an MCP capability with transport metadata without exposing secrets. Runtime config projection tests will show that supported runtimes receive a valid HTTP MCP config, while unsupported runtimes skip HTTP MCP entries instead of crashing or inventing a stdio proxy. Nowledge Mem can then register its direct MCP endpoint in a later step without embedding Nowledge logic inside Chat Runtime.

## Progress

- [x] (2026-06-20T06:21:36Z) Read the ExecPlan rules and confirmed the non-negotiables: the plan must be self-contained, novice-friendly, observable, and maintained as a living document.
- [x] (2026-06-20T06:21:36Z) Confirmed the next plan filename for the day is `docs/exec-plans/20260620-03-streamable-http-mcp-plugin-host.md`.
- [x] (2026-06-20T06:21:36Z) Inspected the current plugin MCP registry, plugin SDK type, browser-use plugin registration, plugin context tests, loader tests, and three runtime MCP projection points.
- [x] (2026-06-20T07:25:38Z) Implemented the typed MCP transport union in the plugin SDK and server plugin registry, including safe streamable HTTP metadata projection that does not expose headers.
- [x] (2026-06-20T07:25:38Z) Updated first-party stdio call sites and plugin test fixtures to use explicit `transport: 'stdio'`.
- [x] (2026-06-20T07:25:38Z) Projected streamable HTTP MCP into Claude Agent SDK as `{ type: 'http', url, headers }` and added explicit stdio-only filters for Codex and ACP.
- [x] (2026-06-20T07:25:38Z) Wired optional Nowledge Mem streamable HTTP MCP registration through `mcpUrl` / `NMEM_MCP_URL`, with API key headers kept out of storage and route responses.
- [x] (2026-06-20T07:25:38Z) Ran focused tests for plugin host, loader, Claude MCP projection, Codex MCP projection filtering, ACP projection filtering, and Nowledge server registration. These focused tests passed.
- [x] (2026-06-20T07:29:46Z) Ran type checks, targeted ESLint, focused server tests, Nowledge tests, manifest validation, plugin SDK typecheck, and Nowledge build successfully.

## Surprises & Discoveries

- Observation: Cradle's server plugin SDK currently exposes only stdio-shaped MCP configuration.
  Evidence: `packages/plugin-sdk/src/server.ts` defines `McpServerConfig` with `name`, `command`, `args`, optional `env`, and optional `when`.

- Observation: The server plugin MCP registry validates only stdio fields today.
  Evidence: `apps/server/src/plugins/mcp-registry.ts` uses `McpServerConfigSchema = z.object({ name, command, args, env, when })` and `getRegisteredMcpServers()` returns only `{ command, args, env }`.

- Observation: Existing runtime projection code assumes all registered MCP servers are stdio processes.
  Evidence: `apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts` copies `getRegisteredMcpServers()` directly into `queryOptions.mcpServers`; `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts` and `apps/server/src/modules/chat-runtime-providers/codex/app-server/bridge.ts` build `{ command, args, env }`; `apps/server/src/modules/chat-runtime-providers/acp/connection-manager.ts` maps each server into ACP `McpServer` with `command`, `args`, and env name/value pairs.

- Observation: The existing `browser-use` plugin registers a stdio MCP server without a transport discriminator.
  Evidence: `plugins/browser-use/src/server.ts` calls `ctx.mcp.registerServer({ name: 'browser-use', command: 'node', args: [...], env: ... })`.

- Observation: The installed Claude Agent SDK supports HTTP MCP server configs directly.
  Evidence: `apps/server/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` defines `McpHttpServerConfig = { type: 'http'; url: string; headers?: Record<string, string>; ... }` and `Options['mcpServers']` as `Record<string, McpServerConfig>`.

- Observation: The current Codex and ACP projection paths do not expose a clear streamable HTTP MCP config shape in local TypeScript types.
  Evidence: Codex config builders in `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts` and `apps/server/src/modules/chat-runtime-providers/codex/app-server/bridge.ts` were stdio-shaped; ACP `McpServer` projection in `apps/server/src/modules/chat-runtime-providers/acp/connection-manager.ts` still requires `command`, `args`, and env pairs.

## Decision Log

- Decision: Make MCP transport explicit with a discriminated union rather than inferring stdio from the presence of `command`.
  Rationale: The repository is pre-release, and AGENTS.md asks for clean architecture over compatibility shims. An explicit `transport` field prevents ambiguous configs and makes runtime projection safer.
  Date/Author: 2026-06-20 / Codex

- Decision: Do not implement an automatic stdio-to-HTTP proxy for runtimes that cannot consume streamable HTTP MCP directly.
  Rationale: A proxy would add another lifecycle owner, process management, auth forwarding, error mapping, and observability surface. The first host primitive should honestly expose what each runtime supports.
  Date/Author: 2026-06-20 / Codex

- Decision: Keep secrets out of capability records and public plugin projections.
  Rationale: HTTP MCP headers may contain API keys or bearer tokens. The registry can hold private runtime config in memory, but descriptor capabilities and plugin list responses should expose only safe metadata such as `transport`, `urlOrigin`, and `hasHeaders`.
  Date/Author: 2026-06-20 / Codex

- Decision: Streamable HTTP MCP is a plugin host capability, not a Nowledge-specific chat runtime feature.
  Rationale: Nowledge Mem should be the first consumer, but the ownership belongs in `packages/plugin-sdk` and `apps/server/src/plugins`, with runtime-specific projection only at provider boundaries.
  Date/Author: 2026-06-20 / Codex

- Decision: Project streamable HTTP MCP into Claude Agent SDK now, but filter it from Codex and ACP until their local config contracts support it.
  Rationale: Claude's installed SDK has a typed HTTP MCP config. Codex and ACP do not expose a confirmed HTTP MCP shape in the code currently in this repository, and the plan explicitly forbids guessing with untyped casts or adding a proxy.
  Date/Author: 2026-06-20 / Codex

## Outcomes & Retrospective

Implementation is complete. The SDK and host registry now accept both stdio and streamable HTTP MCP registrations. Claude Agent receives streamable HTTP MCP configs because its local SDK supports them. Codex and ACP intentionally filter streamable HTTP entries and keep stdio behavior intact. Nowledge Mem registers a `nowledge-mem` streamable HTTP MCP server when `mcpUrl` or `NMEM_MCP_URL` is configured. Headers are retained only in runtime config and are not exposed through plugin capability metadata, plugin storage, or Nowledge config route responses.

Validation passed with focused host/runtime tests, Nowledge plugin tests, server and plugin SDK type checks, Nowledge typecheck/build, manifest boundary validation, and targeted ESLint. The remaining future work is outside this plan: plugin lifecycle hooks, transcript export for plugins, and provider-neutral MCP/tool exposure for runtimes that do not support streamable HTTP MCP directly.

## Context and Orientation

MCP means Model Context Protocol. In this repository, an MCP server is an external tool server that an agent runtime can connect to and expose as callable tools. A stdio MCP server is launched as a child process and communicates through standard input and output. A streamable HTTP MCP server is already running at an HTTP endpoint and communicates through HTTP requests, often with headers for authentication.

Cradle plugins live under `plugins/*`. A plugin's server entry receives a `ServerPluginContext` from `packages/plugin-sdk/src/server.ts`. The relevant API is `ctx.mcp.registerServer(...)`, which records an MCP server owned by that plugin. The server-side registry implementation is `apps/server/src/plugins/mcp-registry.ts`. `apps/server/src/plugins/context.ts` wires `ctx.mcp.registerServer(...)` to `registerPluginMcpServer(...)` and tracks returned disposables in `ctx.subscriptions`. Runtime capability records are projected through `apps/server/src/plugins/runtime-registry.ts` and then surfaced by `apps/server/src/modules/plugins/service.ts`.

Three chat runtime provider paths currently consume the MCP registry. Claude Agent uses `apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts` and copies registered servers into SDK query options. Codex has two paths: `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts` for normal runtime config and `apps/server/src/modules/chat-runtime-providers/codex/app-server/bridge.ts` for app-server bridge config. ACP uses `apps/server/src/modules/chat-runtime-providers/acp/connection-manager.ts` and maps the registry into ACP `McpServer` values.

The first-party `plugins/browser-use` package is the existing stdio MCP plugin example. It should remain stdio and should be updated to explicitly declare `transport: 'stdio'`. The first-party `plugins/nowledge-mem` package is the intended streamable HTTP MCP consumer. Its M0 implementation already exposes HTTP plugin routes and skill registration, but it deliberately did not register direct MCP because the host did not support that transport yet.

## Plan of Work

First, update the plugin SDK type in `packages/plugin-sdk/src/server.ts`. Replace the single `McpServerConfig` interface with a discriminated union. The stdio variant should be named by `transport: 'stdio'` and contain `name`, `command`, `args`, optional `env`, and optional `when`. The streamable HTTP variant should be named by `transport: 'streamable-http'` and contain `name`, `url`, optional `headers`, and optional `when`. Keep `ServerPluginMcpRegistry.registerServer` as the single registration method so plugin authors have one stable owner-scoped API. Update the relevant SDK documentation in `packages/plugin-sdk/DEVELOPERS.md` to show both transports and to warn that headers may carry secrets.

Second, update `apps/server/src/plugins/mcp-registry.ts` so it validates the same discriminated union with zod. Store the full registered config internally. Replace the current return type of `getRegisteredMcpServers()` with a type that can return both variants. Add helper projection functions if they keep runtime code clear, for example `getRegisteredStdioMcpServers()` for ACP if ACP remains stdio-only, and `getRegisteredMcpServers()` for providers that can inspect transport themselves. Capability registration should include safe metadata. For stdio, safe metadata is `transport: 'stdio'`, `command`, `args`, and `hasEnv`. For streamable HTTP, safe metadata is `transport: 'streamable-http'`, a non-secret URL summary such as origin plus pathname, and `hasHeaders`. Do not write header values into capability metadata, plugin descriptors, logs, or public API responses.

Third, update plugin context and lifecycle tests. `apps/server/src/plugins/context.ts` should not need much logic beyond accepting the broader `McpServerConfig` type, but async `when` registration must work for both transports. Update `apps/server/src/plugins/context.test.ts` to register explicit stdio configs in existing tests, add a streamable HTTP registration test, add a streamable HTTP async `when` skip test, and assert disposal removes registry entries and capability records. Update `apps/server/src/plugins/loader.test.ts` so generated test plugins use `transport: 'stdio'`, then add a loader test for an external plugin that registers undeclared streamable HTTP MCP and verify the same declaration guard applies.

Fourth, update first-party plugin consumers and manifests. `plugins/browser-use/src/server.ts` should register `transport: 'stdio'`. Any test fixture or generated plugin snippets in `packages/plugin-sdk/DEVELOPERS.md`, plugin tests, or docs should use explicit stdio transport. For `plugins/nowledge-mem`, add optional streamable HTTP MCP registration only after the host primitive tests pass. The plugin should read a non-secret MCP URL from plugin config or shared config and should read authentication from environment or shared config in the same spirit as its M0 API key behavior. It must not persist API keys in plugin storage. If Nowledge Mem does not have a configured MCP URL, activation should still succeed and simply skip MCP registration.

Fifth, update runtime projections provider by provider. For Claude Agent, inspect the installed `@anthropic-ai/claude-agent-sdk` type or runtime source in `node_modules/.pnpm` before changing projection. If its `mcpServers` option supports streamable HTTP entries, implement a typed projection that maps `transport: 'streamable-http'` into the SDK's documented shape. If the SDK supports only stdio in this checkout, filter to stdio and add a test that HTTP entries are skipped without failing. For Codex, inspect the vendored Codex app-server protocol/config shape before changing both `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts` and `apps/server/src/modules/chat-runtime-providers/codex/app-server/bridge.ts`. If Codex supports streamable HTTP MCP config, project it in both builders with identical semantics; otherwise filter to stdio and test the skip. For ACP, keep stdio-only unless the local ACP type clearly supports HTTP transport; use `getRegisteredStdioMcpServers()` or equivalent so the unsupported transport is intentionally excluded.

Sixth, update documentation. `apps/server/src/plugins/README.md` should describe that the registry owns both stdio and streamable HTTP MCP registrations. `plugins/nowledge-mem/README.md` should move streamable HTTP MCP out of the "not supported" list only if Nowledge registration is implemented in this milestone. If Nowledge registration remains a follow-up, the README should say the host now supports the transport, but Nowledge direct registration is not wired yet. Avoid overclaiming cross-runtime support; document per-runtime support honestly.

## Concrete Steps

Work from the repository root:

    cd /Users/wibus/dev/Cradle

Start by confirming the current stdio-only state:

    rg -n "interface McpServerConfig|McpServerConfigSchema|getRegisteredMcpServers|registerServer\\(" packages/plugin-sdk apps/server/src plugins -S

Expected result before implementation: `packages/plugin-sdk/src/server.ts` has a single stdio-shaped `McpServerConfig`, `apps/server/src/plugins/mcp-registry.ts` has a single stdio zod object, and `plugins/browser-use/src/server.ts` registers without `transport`.

Edit `packages/plugin-sdk/src/server.ts` to define these exported types:

    export type McpServerConfig = StdioMcpServerConfig | StreamableHttpMcpServerConfig

    export interface StdioMcpServerConfig {
      transport: 'stdio'
      name: string
      command: string
      args: string[]
      env?: Record<string, string>
      when?: () => boolean | Promise<boolean>
    }

    export interface StreamableHttpMcpServerConfig {
      transport: 'streamable-http'
      name: string
      url: string
      headers?: Record<string, string>
      when?: () => boolean | Promise<boolean>
    }

Then update `packages/plugin-sdk/DEVELOPERS.md` so examples use `transport: 'stdio'` and add a streamable HTTP example with placeholder headers. Do not show a real token value.

Edit `apps/server/src/plugins/mcp-registry.ts`. Replace the single zod object with a discriminated union on `transport`. Add exported helper types for the registered public shape if needed. Keep duplicate-name behavior unchanged. Add a safe metadata helper that never returns raw HTTP headers. Update `getRegisteredMcpServers()` to return both variants, or add `getRegisteredMcpServerConfigs()` and update callers intentionally. If adding `getRegisteredStdioMcpServers()`, make it filter by `config.transport === 'stdio'`.

Update stdio call sites and test fixtures by adding `transport: 'stdio'`:

    plugins/browser-use/src/server.ts
    apps/server/src/plugins/context.test.ts
    apps/server/src/plugins/loader.test.ts
    apps/server/src/modules/chat-runtime-providers/claude-agent/provider.test.ts
    any other test fixture found by rg "command: .*args:" under apps/server/src plugins packages

Update runtime projection code:

    apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts
    apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts
    apps/server/src/modules/chat-runtime-providers/codex/app-server/bridge.ts
    apps/server/src/modules/chat-runtime-providers/acp/connection-manager.ts

The safe default is to filter unsupported transports. Only project streamable HTTP into a provider after inspecting local provider types and adding a test that proves the generated config shape.

Add focused tests. At minimum, `apps/server/src/plugins/context.test.ts` should include a test named like "tracks streamable HTTP MCP registrations without exposing headers in capability metadata". `apps/server/src/plugins/loader.test.ts` should include a fixture plugin with `transport: 'streamable-http'`. Runtime provider tests should prove either projection or intentional skip:

    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/loader.test.ts
    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/claude-agent/provider.test.ts
    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/provider.test.ts

If Nowledge Mem is wired in this milestone, edit `plugins/nowledge-mem/src/server.ts` to register streamable HTTP MCP only when configured. Add or update `plugins/nowledge-mem/src/server.test.ts` to prove missing config skips registration and configured URL registers `transport: 'streamable-http'` without persisting or returning headers.

Run type checks after the focused tests:

    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/nowledge-mem exec tsc --noEmit

Run targeted lint for files touched by implementation:

    pnpm exec eslint packages/plugin-sdk/src/server.ts apps/server/src/plugins/mcp-registry.ts apps/server/src/plugins/context.ts apps/server/src/plugins/context.test.ts apps/server/src/plugins/loader.test.ts plugins/browser-use/src/server.ts

If Nowledge files are touched, include:

    pnpm exec eslint plugins/nowledge-mem/src/server.ts plugins/nowledge-mem/src/server.test.ts

## Validation and Acceptance

The host primitive is accepted when a plugin can register both MCP transport variants and the registry behaves correctly. Running:

    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/loader.test.ts

should pass. The new context test should fail before the implementation because the current zod schema rejects `transport: 'streamable-http'` and lacks `url`; it should pass after the implementation and prove that capability metadata contains `transport: 'streamable-http'` and `hasHeaders: true` but not the `Authorization` value.

Runtime projection is accepted when supported providers receive a valid HTTP MCP config and unsupported providers skip it intentionally. If Claude or Codex supports HTTP MCP in the local dependency version, the relevant provider test should assert the exact config shape. If a provider does not support HTTP MCP, the test should assert that a streamable HTTP registry entry does not appear in that provider's outgoing config and that stdio entries still appear.

Nowledge Mem MCP registration is accepted only if wired in this milestone. With an MCP URL configured through shared config or non-secret plugin config, activating `@cradle/nowledge-mem` should create an MCP registry entry named `nowledge-mem` with `transport: 'streamable-http'`. Without an MCP URL, activation should still register all M0 routes and the skill, but no MCP server. No test or route response should expose raw auth headers or API keys.

The final type and lint acceptance commands are:

    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/nowledge-mem exec tsc --noEmit
    pnpm exec eslint packages/plugin-sdk/src/server.ts apps/server/src/plugins/mcp-registry.ts apps/server/src/plugins/context.ts apps/server/src/plugins/context.test.ts apps/server/src/plugins/loader.test.ts plugins/browser-use/src/server.ts

If runtime provider files or Nowledge files are touched, include them in the ESLint command. Expected result: all commands exit with code 0.

Actual validation on 2026-06-20T07:29:46Z:

    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/loader.test.ts src/plugins/manifest-boundary.test.ts src/modules/chat-runtime-providers/acp/connection-manager.test.ts src/modules/chat-runtime-providers/codex/config/runtime-config.test.ts
    Result: 5 test files passed, 26 tests passed.

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/claude-agent/provider.test.ts --testNamePattern "MCP"
    Result: 1 test file passed, 30 MCP-matching tests passed.

    pnpm --filter @cradle/nowledge-mem exec vitest run src/nowledge-client.test.ts src/server.test.ts
    Result: 2 test files passed, 11 tests passed.

    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/nowledge-mem exec tsc --noEmit
    pnpm --filter @cradle/plugin-sdk typecheck
    Result: all exited with code 0.

    pnpm exec eslint packages/plugin-sdk/src/server.ts apps/server/src/plugins/mcp-registry.ts apps/server/src/plugins/context.ts apps/server/src/plugins/context.test.ts apps/server/src/plugins/loader.test.ts apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts apps/server/src/modules/chat-runtime-providers/claude-agent/provider.test.ts apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.test.ts apps/server/src/modules/chat-runtime-providers/codex/app-server/bridge.ts apps/server/src/modules/chat-runtime-providers/acp/connection-manager.ts apps/server/src/modules/chat-runtime-providers/acp/connection-manager.test.ts plugins/browser-use/src/server.ts plugins/nowledge-mem/src/config.ts plugins/nowledge-mem/src/server.ts plugins/nowledge-mem/src/server.test.ts
    Result: exited with code 0.

    pnpm --filter @cradle/nowledge-mem build
    Result: Vite built `dist/server.mjs` and copied `SKILL.md` to `dist/SKILL.md`.

## Idempotence and Recovery

These changes are source-only and can be retried safely. If a test run leaves plugin registry state behind, use existing test cleanup patterns: `resetPluginRuntimeRegistry()` in unit tests and `deactivateAllPlugins()` in loader tests. Do not run destructive git commands. If a runtime provider's local SDK does not support streamable HTTP MCP, do not force support with `unknown` casts or ad hoc config shapes; filter to stdio, record the discovery in this plan, and leave a clear test proving the skip.

If type changes cascade too widely, stop and inspect why. The expected cascade is limited to MCP registration call sites, registry consumers, and tests. A change that reaches unrelated chat session persistence, Chronicle, provider database schemas, or UI components likely means the transport boundary is being placed too high or too low. Keep the owner boundary at plugin SDK, plugin host registry, and runtime provider projection.

## Artifacts and Notes

Current evidence from the pre-implementation audit:

    packages/plugin-sdk/src/server.ts:
      export interface McpServerConfig {
        name: string
        command: string
        args: string[]
        env?: Record<string, string>
        when?: () => boolean | Promise<boolean>
      }

    apps/server/src/plugins/mcp-registry.ts:
      const McpServerConfigSchema = z.object({
        name: z.string(),
        command: z.string(),
        args: z.array(z.string()),
        env: z.record(z.string(), z.string()).default({}),
        when: z.function().optional(),
      })

    plugins/browser-use/src/server.ts:
      ctx.mcp.registerServer({
        name: 'browser-use',
        command: 'node',
        args: [resolve(__dirname, 'mcp-server.mjs')],
        env: { BROWSER_BACKEND_SOCKET: socketPath },
      })

Avoid adding generated artifacts manually. If a future implementation needs generated protocol updates, document the generator command and resulting files in this section before committing them.

Revision note 2026-06-20T06:21:36Z: Initial plan created after auditing the current stdio-only MCP registry and runtime projection points. The plan intentionally separates the generic plugin host primitive from Nowledge-specific lifecycle work.

Revision note 2026-06-20T07:25:38Z: Updated the plan after implementing the transport union, runtime projections, Nowledge MCP registration, documentation updates, and focused tests. Recorded the provider-support decision: Claude supports HTTP MCP directly; Codex and ACP filter HTTP entries for now.

Revision note 2026-06-20T07:29:46Z: Marked implementation complete after typecheck, lint, focused test, manifest, and build validation passed. Added the exact validation commands and outcomes for future audit.

## Interfaces and Dependencies

At the end of this plan, `packages/plugin-sdk/src/server.ts` must export a transport-discriminated `McpServerConfig` union with `StdioMcpServerConfig` and `StreamableHttpMcpServerConfig`. `ServerPluginMcpRegistry.registerServer(config)` must continue to accept one config and return `Disposable | Promise<Disposable | undefined> | undefined`.

`apps/server/src/plugins/mcp-registry.ts` must validate and store both transport variants. It must expose registry readers that let runtime providers either inspect all transport variants or intentionally read only stdio entries. Public capability metadata must never include raw `headers` values for streamable HTTP or raw env values beyond the existing stdio behavior; prefer booleans such as `hasHeaders` and `hasEnv`.

`plugins/browser-use/src/server.ts` must remain a stdio MCP plugin using `transport: 'stdio'`. `plugins/nowledge-mem/src/server.ts` may become a streamable HTTP MCP plugin using `transport: 'streamable-http'`, but only if its registration can be configured without storing secrets in plugin KV storage.

Runtime providers must not share a single untyped projection. Each provider owns the config shape it sends to its underlying runtime. Claude Agent projection belongs in `apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts`. Codex projection belongs in both `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts` and `apps/server/src/modules/chat-runtime-providers/codex/app-server/bridge.ts`. ACP projection belongs in `apps/server/src/modules/chat-runtime-providers/acp/connection-manager.ts`. Unsupported transports must be filtered intentionally with tests.
