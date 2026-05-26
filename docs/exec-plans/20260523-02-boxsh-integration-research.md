# Boxsh Integration Research and Execution Plan

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is intentionally self-contained: a reader should be able to understand what `boxsh` is, where it fits in Cradle, what remains unknown, and how to implement a first integration without relying on earlier chat context.

## Purpose / Big Picture

Cradle already runs multiple agent runtimes, including Claude Agent, Codex, and ACP-backed agents. Those agents can call Model Context Protocol servers, usually abbreviated as MCP servers. An MCP server is a separate process that exposes tools to an agent over standard input and output. `boxsh` is a sandboxed POSIX shell and MCP server. Its practical value for Cradle is that an agent can execute commands and edit files inside an isolated, copy-on-write workspace, so the original project directory is not mutated until Cradle chooses to promote or copy changes back.

After this integration, a Cradle user should be able to enable a Cradle-owned `boxsh` capability for an agent session. The agent should see a `boxsh` MCP server with shell and file tools, run commands in an OS sandbox, and write changes into a Cradle-owned copy-on-write destination instead of directly writing the workspace. A human should be able to verify this by starting an agent session, asking it to write a file, and observing that the real workspace is unchanged while the Cradle-owned copy-on-write directory contains the new file or whiteout.

This plan is currently a research and implementation plan. No runtime code has been changed yet.

## Progress

- [x] (2026-05-23 19:34 +0800) Read the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md` and confirmed the required living-document sections and self-contained format.
- [x] (2026-05-23 19:34 +0800) Confirmed today's next ExecPlan filename is `docs/exec-plans/20260523-02-boxsh-integration-research.md` because `docs/exec-plans/20260523-01-rust-chronicle-core.md` already exists.
- [x] (2026-05-23 19:34 +0800) Researched `boxsh` upstream README and release metadata.
- [x] (2026-05-23 19:34 +0800) Inspected Cradle's plugin MCP registry, runtime providers, plugin SDK manifest and permission surface, and existing `browser-use` plugin as the closest local implementation pattern.
- [x] (2026-05-23 19:34 +0800) Captured the recommended integration path, alternatives, risks, and validation plan in this ExecPlan.
- [ ] Implement `plugins/boxsh` as a first-party bundled plugin that registers a `boxsh --rpc` MCP server.
- [ ] Add a Cradle-owned copy-on-write workspace path resolver and tests.
- [ ] Add binary discovery and later optional binary installation or packaging support.
- [ ] Add user-visible controls or profile configuration for enabling the capability.
- [ ] Add end-to-end validation that proves the original workspace remains unchanged while the copy-on-write destination captures modifications.

## Surprises & Discoveries

- Observation: `boxsh` is not just a shell wrapper. It already implements an MCP stdio server and provides agent-facing tools directly.
  Evidence: The upstream README describes `boxsh --rpc` as an MCP-compatible server with tools named `bash`, `read`, `write`, `edit`, `run_in_terminal`, `send_to_terminal`, `get_terminal_output`, `kill_terminal`, and `list_terminals`.

- Observation: Cradle already has the exact registry path needed for this integration.
  Evidence: `apps/server/src/plugins/mcp-registry.ts` stores MCP server registrations and exposes `getRegisteredMcpServers()`. `apps/server/src/modules/chat-runtime/providers/codex/provider.ts` reads that registry and projects it into Codex `config.mcp_servers`. `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts` reads the same registry and projects it into Claude Agent SDK `queryOptions.mcpServers`.

- Observation: The existing `plugins/browser-use` package is the closest local pattern.
  Evidence: `plugins/browser-use/src/server.ts` calls `ctx.mcp.registerServer(...)` during plugin activation and registers a skill. Its `package.json` declares a `mcp-server` capability under `cradle.contributes.capabilities`.

- Observation: `boxsh` can sandbox another stdio MCP server, not only expose its own tools.
  Evidence: The upstream README shows replacing an MCP command such as `npx` with `boxsh --sandbox --bind ro:/path/to/project --new-net-ns -- npx ...`. This means a later phase could use `boxsh` as a wrapper for third-party MCP servers.

- Observation: The upstream licensing signal is inconsistent and must be resolved before bundling binaries or source.
  Evidence: The upstream README says `boxsh` is MIT licensed, while the repository `LICENSE.md` content fetched during research is GPLv3. Treat binary redistribution or vendoring as blocked until this is clarified.

- Observation: The latest release visible from GitHub during research was `v3.0.0`, published on 2026-05-15, with assets for macOS and Linux architectures including `darwin-arm64`, `darwin-x86_64`, `linux-x64`, `linux-arm64`, and others.
  Evidence: The GitHub releases API response for `xicilion/boxsh` reported tag `v3.0.0`, `published_at` `2026-05-15T19:50:27Z`, and per-asset SHA-256 digests.

## Decision Log

- Decision: Prefer a first-party bundled plugin named `@cradle/boxsh` as the first integration shape, not a new chat runtime and not vendored C++ source.
  Rationale: `boxsh` already exposes an MCP stdio server, and Cradle already projects plugin-registered MCP servers into Claude Agent, Codex, and ACP runtimes. A plugin keeps ownership clear: the plugin owns `boxsh` registration and sandbox configuration; chat runtime providers remain consumers of the MCP registry.
  Date/Author: 2026-05-23 / Codex

- Decision: Put copy-on-write destination directories under a Cradle-owned namespace, not under the workspace and not under `~/.agents`.
  Rationale: Cradle's repository rule says a feature may read from another namespace but must not write into another owner namespace. The copy-on-write destination is Cradle state, so it should live under Cradle application data or another Cradle-owned path.
  Date/Author: 2026-05-23 / Codex

- Decision: Do not replace Cradle's existing PTY module with `boxsh` terminal tools in the first phase.
  Rationale: `boxsh` terminal tools are agent-facing MCP tools. Cradle's `apps/server/src/modules/pty` is a UI-facing terminal lifecycle and transport surface used by the app. These have different owners, semantics, and validation needs.
  Date/Author: 2026-05-23 / Codex

- Decision: Treat `boxsh` binary packaging as a later phase, after proving MCP registration and COW semantics with a user-installed binary.
  Rationale: The license inconsistency and platform-specific sandbox semantics make binary redistribution higher risk than registering an existing command. The first phase can still validate integration value without taking on packaging risk.
  Date/Author: 2026-05-23 / Codex

## Outcomes & Retrospective

This plan currently captures research only. The main outcome is a recommended low-risk integration path that uses existing Cradle plugin and MCP infrastructure. The largest unresolved items are license clarification, binary lifecycle management, and how Cradle should let a user inspect and promote copy-on-write modifications back into the real workspace.

When implementation begins, update this section after each major milestone with what was built, which tests passed, and which risks changed.

## Context and Orientation

`boxsh` is a C and C++ project based on dash, the small POSIX shell. It can run as a normal shell, as a quick sandboxed shell over the current working directory, or as an MCP server over stdio. Stdio means the parent process starts `boxsh` and talks to it through the process standard input and output streams. MCP is the protocol that lets agents discover and call tools exposed by such a process.

The upstream `boxsh` command modes relevant to Cradle are:

    boxsh --rpc
    boxsh --rpc --workers 4
    boxsh --rpc --workers 4 --sandbox --bind cow:/path/to/workspace:/path/to/cradle-owned/cow
    boxsh --sandbox --bind ro:/path/to/workspace --new-net-ns -- npx -y some-mcp-server

`--rpc` starts the MCP server. `--workers N` configures a worker pool for parallel command execution. `--sandbox` applies OS-native restrictions. `--new-net-ns` blocks outbound network on Linux by creating a new network namespace. `--bind ro:PATH` exposes a path read-only. `--bind wr:PATH` exposes a path read-write. `--bind cow:SRC:DST` exposes `SRC` as a copy-on-write workspace and stores all modifications in `DST`. Copy-on-write means reads see the original project, but writes are captured elsewhere so the original directory remains unchanged.

Cradle's current integration points are:

`apps/server/src/plugins/mcp-registry.ts` owns the in-memory MCP server registry. `registerPluginMcpServer(owner, config)` records a server by name and projects a plugin capability record. `getRegisteredMcpServers()` returns a map that runtime providers consume.

`apps/server/src/plugins/context.ts` creates the server-side plugin context passed to plugin `activate(ctx)` functions. The `ctx.mcp.registerServer(config)` function calls the registry. This is the API a `boxsh` plugin should use.

`packages/plugin-sdk/src/server.ts` defines `McpServerConfig` with `name`, `command`, `args`, optional `env`, and optional `when`. A `boxsh` plugin should use this public SDK type rather than importing server internals.

`packages/plugin-sdk/src/manifest.ts` defines plugin manifest shape through `package.json#cradle`. Capabilities and permissions must be declared under `cradle.contributes`. A first-party bundled plugin can declare the MCP capability without requiring external-local operator permission grants.

`packages/plugin-sdk/src/permissions.ts` enforces permission policy for external local plugins. The first implementation should still declare permissions honestly, even if first-party source policy trusts bundled plugins.

`apps/server/src/modules/chat-runtime/providers/codex/provider.ts` builds Codex config. It calls `buildCodexMcpServersConfig()`, which reads `getRegisteredMcpServers()` and writes the result to `codexConfig.mcp_servers`. This means a registered `boxsh` MCP server becomes visible to Codex sessions without adding a new Codex-specific path.

`apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts` builds Claude Agent SDK options. It reads `getRegisteredMcpServers()` and merges them into `queryOptions.mcpServers`. This means a registered `boxsh` MCP server becomes visible to Claude Agent sessions without adding a new Claude-specific path.

`apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts` converts registered MCP servers into ACP session `mcpServers`. This suggests ACP can also consume the server, but ACP behavior should be validated separately because ACP agents may interpret MCP tools differently.

`plugins/browser-use` is a working example of a bundled plugin that registers an MCP server. It has a `package.json`, `vite.config.ts`, `src/server.ts`, and MCP server entry files. A `boxsh` plugin should mirror this structure where possible.

The repository ownership principle matters here. `boxsh` may read the workspace path because the workspace is the user's project. It should not write directly into the workspace unless the user explicitly chooses a direct-write mode. For the default integration, `boxsh` should write into a Cradle-owned directory such as an application data location or a server-configured path. Cradle can then later provide a review and promote flow.

## Plan of Work

The first milestone is a research-only planning milestone. It is complete when this ExecPlan exists and records all findings, risks, and recommended implementation path. No runtime behavior changes during this milestone.

The second milestone is a minimal plugin registration. Create `plugins/boxsh/package.json`, `plugins/boxsh/src/server.ts`, `plugins/boxsh/tsconfig.json`, and `plugins/boxsh/vite.config.ts`. The server entry should register an MCP server named `boxsh` only when a `boxsh` executable is discoverable. For the first pass, discovery can be conservative: use `process.env.CRADLE_BOXSH_BIN` if present, otherwise use `boxsh` and let the runtime fail visibly if it is not installed. The activation log should state which command was registered. The plugin manifest should declare a server-layer `mcp-server` capability with a permission such as `filesystem.workspace.sandboxed`.

The third milestone is Cradle-owned COW path resolution. Add a small helper owned by the plugin, for example `plugins/boxsh/src/cow-workspace.ts`, that accepts `workspacePath`, `chatSessionId`, and a Cradle data root, and returns a deterministic destination directory. The helper should create the destination parent if needed. The path must not be inside the workspace. The destination naming should include the session id, not only the workspace name, because two sessions over the same workspace need isolated writes. Avoid writing into `~/.agents` because that namespace is not owned by Cradle.

The fourth milestone is making the plugin aware of session and workspace context. The current `McpServerConfig` is static at registry time and does not carry per-session workspace paths. There are two viable implementation directions. The lower-risk direction is to register a conservative `boxsh` server with read-only or manually configured binds first, then extend the plugin/server registry API later to support context-aware MCP server factories. The more product-complete direction is to extend `McpServerConfig` or add a new registry shape so providers ask for MCP servers per session, passing `chatSessionId` and `workspacePath`. The recommended direction is to add a context-aware registry only after the static plugin proves basic MCP visibility, because it touches shared runtime-provider contracts.

The fifth milestone is user-facing configuration. Add an app setting or profile setting that controls whether `boxsh` is enabled for agent sessions. The default should be disabled until binary packaging and COW promotion are reliable. A later UI can expose a mode selector with values equivalent to `off`, `read-only`, `copy-on-write`, and `direct-write`. The first product-ready default should be copy-on-write.

The sixth milestone is promotion and inspection. Copy-on-write output is useful only if a human can inspect what changed. Add a flow that shows the COW destination path and a diff against the source workspace. This can start as a CLI or documented manual step, then become a UI. Do not silently copy changes back into the workspace.

The seventh milestone is binary lifecycle. Decide whether Cradle merely detects `boxsh` on `PATH`, downloads a pinned release asset into a Cradle-owned tools directory, or bundles binaries in the desktop app. If downloading or bundling, resolve the license inconsistency first, pin a version such as `v3.0.0`, verify SHA-256 digests, and support `darwin-arm64`, `darwin-x86_64`, `linux-x64`, and `linux-arm64` before claiming broad support.

## Concrete Steps

From the repository root `/Users/wibus/dev/Cradle`, inspect the current MCP registry and provider paths:

    rg -n "getRegisteredMcpServers|registerServer|mcpServers|mcp_servers" apps/server/src plugins packages/plugin-sdk

Expected result: matches in `apps/server/src/plugins/mcp-registry.ts`, `apps/server/src/plugins/context.ts`, Codex provider, Claude Agent provider, ACP connection manager, and `plugins/browser-use/src/server.ts`.

Create the plugin package:

    mkdir -p plugins/boxsh/src

Do not use this shell command if editing through an automated patch tool that can create directories implicitly. The target file set for the minimal plugin is:

    plugins/boxsh/package.json
    plugins/boxsh/src/server.ts
    plugins/boxsh/src/cow-workspace.ts
    plugins/boxsh/src/cow-workspace.test.ts
    plugins/boxsh/tsconfig.json
    plugins/boxsh/vite.config.ts

The initial `plugins/boxsh/package.json` should follow the existing plugin manifest format:

    {
      "name": "@cradle/boxsh",
      "type": "module",
      "version": "0.0.1",
      "private": true,
      "cradle": {
        "apiVersion": "1",
        "displayName": "Boxsh",
        "description": "Registers a sandboxed boxsh MCP server for agent sessions.",
        "server": "dist/server.mjs",
        "deployments": ["desktop"],
        "contributes": {
          "capabilities": [
            {
              "id": "mcp.boxsh",
              "type": "mcp-server",
              "layer": "server",
              "label": "Boxsh sandbox MCP server",
              "permissions": ["filesystem.workspace.sandboxed"]
            }
          ],
          "permissions": [
            {
              "id": "filesystem.workspace.sandboxed",
              "label": "Run sandboxed commands over workspace files",
              "required": true
            }
          ]
        }
      },
      "scripts": {
        "build": "vite build",
        "typecheck": "tsc --noEmit",
        "test": "vitest run"
      },
      "devDependencies": {
        "@cradle/plugin-sdk": "workspace:*",
        "@types/node": "^22.19.1",
        "vite": "^8.0.0",
        "vitest": "^4.1.4",
        "typescript": "^5.9.3"
      }
    }

The first `plugins/boxsh/src/server.ts` should register a static MCP server. This is enough to prove registry visibility but is not yet the final COW-aware shape:

    import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

    export function activate(ctx: ServerPluginContext): void {
      const boxshBin = process.env.CRADLE_BOXSH_BIN?.trim() || 'boxsh'
      ctx.mcp.registerServer({
        name: 'boxsh',
        command: boxshBin,
        args: ['--rpc', '--workers', '4'],
      })
      ctx.logger.info('Boxsh plugin activated')
    }

For copy-on-write support, update the args only after a session-aware MCP registry exists or after an acceptable interim configuration path exists:

    [
      '--rpc',
      '--workers',
      '4',
      '--sandbox',
      '--bind',
      `cow:${workspacePath}:${cowDestinationPath}`
    ]

Add tests for path resolution before wiring it into runtime providers:

    pnpm --filter @cradle/boxsh test

Add plugin build validation:

    pnpm --filter @cradle/boxsh build

Add server/plugin registry validation after the plugin exists:

    pnpm --filter @cradle/server test -- apps/server/src/plugins/loader.test.ts

If provider tests are updated, run:

    pnpm --filter @cradle/server test -- apps/server/src/modules/chat-runtime/providers/claude-agent/provider.test.ts apps/server/tests/sdk-providers.test.ts apps/server/tests/acp-chat-runtime.test.ts

Before claiming a product-ready integration, run a manual smoke test with a temporary workspace and a COW destination. The command shape should be:

    mkdir -p /tmp/cradle-boxsh-src /tmp/cradle-boxsh-cow
    printf 'original\n' > /tmp/cradle-boxsh-src/example.txt
    printf '%s\n' \
      '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{}}' \
      '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
      '{"jsonrpc":"2.0","id":"2","method":"tools/call","params":{"name":"write","arguments":{"path":"/tmp/cradle-boxsh-src/example.txt","content":"changed\n"}}}' \
      | boxsh --rpc --workers 1 --sandbox --bind cow:/tmp/cradle-boxsh-src:/tmp/cradle-boxsh-cow

The exact path visible inside the sandbox may need adjustment after testing `boxsh` bind semantics on the target platform. The acceptance property is stable: after the tool call, `/tmp/cradle-boxsh-src/example.txt` should still contain `original`, and the COW destination should contain the changed data or overlay metadata representing the change.

## Validation and Acceptance

The research milestone is accepted when this file exists and contains enough context for another contributor to implement the feature without reading the earlier conversation.

The minimal plugin milestone is accepted when `plugins/boxsh` builds and a test can activate the plugin, then observe `getRegisteredMcpServers()` containing a `boxsh` entry with command `boxsh` or the value from `CRADLE_BOXSH_BIN`.

The provider integration milestone is accepted when Codex, Claude Agent, and ACP provider tests show that registered MCP servers include the `boxsh` entry without provider-specific special cases.

The copy-on-write milestone is accepted only when an automated or manual test proves all three of these statements:

1. The original workspace file remains unchanged after an agent writes through `boxsh`.
2. The Cradle-owned COW destination contains the modified file state.
3. A failed or interrupted run can be retried without deleting the original workspace.

The product-readiness milestone is accepted when the UI or documented setting makes the feature opt-in, binary availability errors are understandable, and a user can inspect COW changes before promoting them.

## Idempotence and Recovery

All early implementation steps should be additive. Creating `plugins/boxsh` should not modify existing runtime provider behavior beyond registering one more plugin-owned MCP server when the plugin is active.

Path creation for COW destinations must be idempotent. If the directory already exists for a session, the helper should reuse it or create a deterministic child directory for a new run. It must not delete existing COW output automatically.

If `boxsh` is not installed, plugin activation should not crash the entire server. The preferred behavior is to leave a descriptor warning or log entry and skip registration. If the first minimal version registers `boxsh` optimistically, provider-level failures should be treated as a temporary MVP limitation and replaced before product release.

If binary download or installation is added later, it must write only to a Cradle-owned tools directory. It should verify SHA-256 before marking the binary usable. A partial download should use a temporary file and rename after verification.

Never run destructive commands such as deleting the workspace or force-cleaning COW directories as part of normal validation. Manual cleanup should target only temporary directories created for the test, such as `/tmp/cradle-boxsh-src` and `/tmp/cradle-boxsh-cow`.

## Artifacts and Notes

Relevant upstream facts captured during research:

    Repository: https://github.com/xicilion/boxsh
    Latest release observed: v3.0.0
    Release publish time observed: 2026-05-15T19:50:27Z
    Important modes: shell mode, --rpc MCP mode, --try quick sandbox mode
    Important flags: --sandbox, --new-net-ns, --bind ro:PATH, --bind wr:PATH, --bind cow:SRC:DST
    Important tools: bash, read, write, edit, run_in_terminal, send_to_terminal, get_terminal_output, kill_terminal, list_terminals
    License warning: README says MIT, LICENSE.md content observed as GPLv3

Relevant Cradle files:

    apps/server/src/plugins/mcp-registry.ts
    apps/server/src/plugins/context.ts
    packages/plugin-sdk/src/server.ts
    packages/plugin-sdk/src/manifest.ts
    packages/plugin-sdk/src/permissions.ts
    apps/server/src/modules/chat-runtime/providers/codex/provider.ts
    apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts
    apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts
    plugins/browser-use/package.json
    plugins/browser-use/src/server.ts
    plugins/browser-use/vite.config.ts

Important local code excerpts observed during research:

    // apps/server/src/plugins/mcp-registry.ts
    export function registerPluginMcpServer(owner: string, config: McpServerConfig): Disposable
    export function getRegisteredMcpServers(): Record<string, { command: string; args: string[]; env: Record<string, string> }>

    // packages/plugin-sdk/src/server.ts
    export interface McpServerConfig {
      name: string
      command: string
      args: string[]
      env?: Record<string, string>
      when?: () => boolean | Promise<boolean>
    }

    // plugins/browser-use/src/server.ts pattern
    ctx.mcp.registerServer({
      name: 'browser-use',
      command: 'node',
      args: [resolve(__dirname, 'mcp-server.mjs')],
      env: { BROWSER_BACKEND_SOCKET: socketPath },
    })

## Interfaces and Dependencies

Use `@cradle/plugin-sdk/server` for the server plugin API. The plugin activation function should keep this shape:

    import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

    export function activate(ctx: ServerPluginContext): void {
      // register plugin-owned capabilities here
    }

Use `ctx.mcp.registerServer(config)` to register `boxsh`. Do not import `registerPluginMcpServer` directly from `apps/server/src/plugins/mcp-registry.ts` inside the plugin because plugins should depend on the SDK contract, not host internals.

If a COW helper is added, use a small explicit interface. Avoid names such as `ensure` or `make` in function names because the repository instruction rejects vague naming.

    export interface CowWorkspaceRequest {
      workspacePath: string
      chatSessionId: string
      dataRoot: string
    }

    export interface CowWorkspacePaths {
      sourcePath: string
      destinationPath: string
    }

    export function resolveCowWorkspacePaths(input: CowWorkspaceRequest): CowWorkspacePaths

If the MCP registry becomes session-aware, add a new host-owned type rather than overloading static `McpServerConfig` in a way that hides session dependency:

    export interface McpServerContext {
      chatSessionId: string
      workspaceId?: string | null
      workspacePath: string
      runtimeKind: RuntimeKind
    }

    export type McpServerConfigFactory = (context: McpServerContext) => McpServerConfig | null | Promise<McpServerConfig | null>

Any new registry API must preserve existing static registrations for `browser-use`, Chronicle, and other current plugins.

The `boxsh` binary is an external dependency. In the MVP it can be resolved from `CRADLE_BOXSH_BIN` or `PATH`. In a packaged implementation, use a Cradle-owned tools directory and pin the release version and SHA-256 digests.

## Revision Notes

2026-05-23 19:34 +0800: Initial research plan created from upstream `boxsh` investigation and Cradle plugin/runtime code inspection. No implementation changes have been made.
