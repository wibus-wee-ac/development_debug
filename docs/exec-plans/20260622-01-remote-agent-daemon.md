# Build Remote Agent Daemon Boundaries

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The file itself is the plan, so it intentionally omits an outer Markdown code fence. A future implementer must be able to start from only this file and complete the change without relying on chat history.

## Purpose / Big Picture

Cradle should let a user sit on one machine, connect to a remote host over SSH, start or attach to an agent process on that remote host, and watch that agent stream back into the normal Cradle chat UI. The remote host owns the live runtime process, the remote workspace, the runtime credentials available on that host, and remote PTYs. The local Cradle Server owns the user's Cradle sessions, messages, run rows, queue rows, and UI projections.

After this plan is implemented, Cradle will have a new `apps/agentd` daemon app that can run on a remote machine, a shared protocol package that both the local server and daemon import, and a server-side `remote-runtime-hosts` module that can connect to a daemon through an SSH tunnel and expose remote host actions. The first observable behavior is intentionally narrow: a developer can start `cradle-agentd` locally or on a remote host, connect to it through the server's remote host client, list daemon runtimes/workspaces/agents, open a PTY, and run a mock remote chat turn that streams AI SDK `UIMessageChunk` data through the existing Chat Runtime projection path. Handoff between machines is not part of this plan.

The most important architectural outcome is dependency direction. `apps/agentd` must not import `@cradle/server` internals. Shared contracts and wire protocol live in packages under `packages/`, and both `apps/server` and `apps/agentd` depend on those packages. This keeps the remote host runtime owner independent of the local server's database, HTTP route modules, preferences, plugin loader, and process-local registries.

## Progress

- [x] (2026-06-22 18:54 +0800) Read the ExecPlan rules and confirmed this work is complex enough to require a formal plan because it creates a new app, extracts shared contracts, adds transport, and changes runtime ownership boundaries.
- [x] (2026-06-22 18:54 +0800) Confirmed today's first plan filename is `docs/exec-plans/20260622-01-remote-agent-daemon.md`.
- [x] (2026-06-22 18:54 +0800) Confirmed the monorepo already includes `zod`, `node-pty`, `ai`, and workspace package patterns, but does not include an SSH client library as a runtime dependency.
- [x] (2026-06-22 18:54 +0800) Wrote this initial self-contained plan.
- [x] (2026-06-22 19:04 +0800) Revised the plan after design review to define host registry storage, reconnect behavior, ProviderContext fields, agent/turn mapping, RemoteChatRuntime ownership, and PTY/agent separation.
- [x] (2026-06-22 20:20 +0800) Created `packages/chat-runtime-contracts` and moved the shared Chat Runtime provider contract into it. `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` is now a thin compatibility re-export, and dependency boundary grep shows no server imports from the shared package.
- [x] (2026-06-22 20:20 +0800) Created `packages/remote-agent-protocol` with zod-validated JSON/WebSocket frame schemas, method maps, `RemoteAgentTurnParams`, `RemoteAgentTurnEvent`, PTY event types, and protocol frame tests.
- [x] (2026-06-22 20:20 +0800) Created `apps/agentd` as an independent daemon app with a Unix socket WebSocket server, host/runtime/workspace/agent/PTY methods, stable daemon host id, process-local mock agents, and bounded workspace listing from `CRADLE_AGENTD_WORKSPACE_ROOTS`.
- [x] (2026-06-22 20:20 +0800) Added `apps/server/src/modules/remote-runtime-hosts` with DB-backed host registry, remote session links, OpenSSH tunnel lifecycle, Unix-socket daemon client, host routes, and explicit transport-vs-stream failure handling.
- [x] (2026-06-22 20:20 +0800) Added `apps/server/src/modules/chat-runtime-providers/remote-mock/provider.ts` and registered it behind `CRADLE_REMOTE_AGENT_DEV=1`. A focused server test proves a mock remote chat turn streams through existing `/chat/sessions/:sessionId/response` persistence and projection, with assistant text derived from the user input.
- [x] (2026-06-22 20:20 +0800) Defined the provider adapter extraction boundary through `ProviderContext` in `packages/chat-runtime-contracts`. Real Codex and Claude Agent adapter extraction is deliberately deferred until after this transport proof, because moving their server-local dependencies is a separate migration phase.
- [x] (2026-06-22 23:38 +0800) Added structured SSH profile support to `apps/server/src/modules/remote-runtime-hosts`. Create and update routes now accept `sshProfile`, `transport`, `localSocketPath`, and `connectTimeoutMs`; the service normalizes those fields into `connectionConfigJson`, derives the legacy `sshTarget` column from `user@hostName`, defaults `remoteSocketPath` to `~/.cradle/agentd/agent.sock` when omitted, and generates OpenSSH `-p` and `-i` argv entries only at connect time.

## Surprises & Discoveries

- Observation: There is no existing remote-agent module or SSH transport module in the repository.
  Evidence: Searching `apps/server/src`, `docs`, `packages`, and `plugins` for `remote`, `ssh`, `tunnel`, `daemon`, `agent/list`, and `pty/open` found unrelated Git remotes, Codex generated remoteControl protocol types, Chronicle daemon code, and plugin docs, but no Cradle-owned remote runtime host module.

- Observation: `ProviderRuntimeHostManager` is not a remote-machine registry despite its name.
  Evidence: `apps/server/src/modules/provider-runtime/host-manager.ts` tracks provider-neutral in-process host resource leases keyed by `runtimeKind`, `providerTargetId`, and `scopeId`. Codex uses it for app-server client lifetime. It does not know SSH targets, remote daemon sockets, or remote workspace roots.

- Observation: The existing `ChatRuntime` contract has almost exactly the shape needed for a remote adapter, but it currently imports server-local types.
  Evidence: `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` defines `ChatRuntime` with `startChatSession`, `resumeChatSession`, `streamTurn`, `cancelTurn`, `steerTurn`, provider-thread reads, background terminal reads, UI slot reads, runtime settings, and provider-native app-server hooks. The same file currently imports `ProviderRuntimeLease` from `../provider-runtime/host-manager`, `CreateEventInput` from `../observability/contract`, `SecretValueWithMetadata` from `../secrets/service`, `Logger` from `../../logging/logger`, and `CradleTurnTranscript` from `./transcript`, which prevents clean reuse by `apps/agentd`.

- Observation: `backend_session_bindings` cannot represent remote host identity by itself.
  Evidence: `packages/db/src/schema/backend-control-plane.ts` stores `chatSessionId`, `providerTargetId`, `runtimeKind`, `backendSessionId`, `backendStateSnapshot`, and `requestedModelId`. There is no `remoteHostId` or daemon identity column. A remote implementation that writes a native thread id into `backendSessionId` without host context would not know which remote host owns that native session.

- Observation: The repo already uses workspace package exports for shared contracts.
  Evidence: `packages/ipc/package.json` exports TypeScript sources and depends on `zod`; `packages/db/package.json` exports schema and path helpers. `pnpm-workspace.yaml` includes `packages/*` and `apps/*`, so new `packages/chat-runtime-contracts`, `packages/remote-agent-protocol`, and `apps/agentd` fit the existing monorepo layout.

- Observation: Design review found six underspecified implementation points in the initial plan.
  Evidence: The review asked where host registry entries are stored, how WebSocket and SSH disconnects differ, what exact fields belong in `ProviderContext`, how `agent/turn` maps to `streamTurn`, where `RemoteChatRuntime` lives, and whether daemon PTY sessions are related to daemon agents. This revision resolves each point in the Decision Log, Plan of Work, Concrete Steps, and Interfaces sections.

- Observation: New workspace packages must be linked before server typecheck can see their re-exported types.
  Evidence: Before `pnpm install`, `pnpm --filter @cradle/server exec tsc --noEmit --pretty false` reported that `@cradle/chat-runtime-contracts` and `@cradle/remote-agent-protocol` could not be found, causing every `runtime-provider-types.ts` re-export to appear missing. After `pnpm install`, those missing-export errors disappeared.

- Observation: Side chat host leases are server-local semantics, not part of the shared provider contract.
  Evidence: After contract extraction, TypeScript reported that `RuntimeLiveResourceLease<unknown>` was missing private `ProviderRuntimeLease` fields such as `released` and `manager` in `apps/server/src/modules/chat-runtime/side-chat/create.ts`. The fix was to use a server-local `instanceof ProviderRuntimeLease` guard and reserve a normal side-conversation host lease otherwise.

- Observation: PTY tests need terminal carriage return input, not only newline input.
  Evidence: The first `PtyRegistry` test wrote `exit\n` and timed out waiting for shell output. Changing the test input to end the command with `\r` made `pnpm --filter @cradle/agentd test` pass with PTY output and exit events.

## Decision Log

- Decision: Implement the remote daemon as a new app under `apps/agentd`.
  Rationale: The daemon is deployed on the remote host and owns live remote runtime processes. Making it a new app avoids dragging local `apps/server` database, Elysia routes, server preferences, plugin loader, and recovery jobs onto the remote host.
  Date/Author: 2026-06-22 / Codex

- Decision: Extract shared runtime contracts into `packages/chat-runtime-contracts`.
  Rationale: Both `apps/server` and `apps/agentd` must compile against the same `ChatRuntime` shape, `RuntimeSession`, `StreamTurnInput`, provider-thread, UI-slot, background-terminal, runtime settings, and provider error types. The contract package is the owner for these shared types and must not import server modules.
  Date/Author: 2026-06-22 / Codex

- Decision: Extract daemon wire protocol into `packages/remote-agent-protocol`.
  Rationale: The daemon protocol is not the same thing as the Chat Runtime provider contract. The wire protocol owns JSON-RPC frame shape, stream multiplexing, host control methods, PTY methods, agent methods, and zod validation. It can import `packages/chat-runtime-contracts`, but it must not import `apps/server` or `apps/agentd`.
  Date/Author: 2026-06-22 / Codex

- Decision: Use system OpenSSH for tunnels instead of adding a JavaScript SSH client library.
  Rationale: OpenSSH is the mature implementation users already configure through `~/.ssh/config`, SSH agents, keys, jump hosts, ControlMaster, ProxyJump, and known_hosts. Cradle should spawn `ssh` for tunnel lifecycle and use the daemon socket through the tunnel. This avoids reimplementing SSH feature compatibility in Node.
  Date/Author: 2026-06-22 / Codex

- Decision: Make structured SSH profiles the primary server API for remote host registry rows.
  Rationale: The frontend should send user-facing fields such as display name, host name, optional user, optional port, and auth mode instead of constructing raw OpenSSH argument arrays. The `remote-runtime-hosts` module owns this shape, stores it in Cradle's `remote_runtime_hosts.connection_config_json`, derives the legacy `ssh_target` display/search column from the profile, and turns the profile into OpenSSH argv only inside the SSH tunnel launcher path. This keeps host identity out of provider target namespace and keeps raw `sshArgs` as an advanced/internal escape hatch rather than the product API.
  Date/Author: 2026-06-22 / Codex

- Decision: Use WebSocket over Unix domain sockets plus JSON-RPC-style frames for the daemon protocol.
  Rationale: WebSocket provides mature message framing and is already a familiar stream transport in this codebase. JSON-RPC-style request/response frames are easy to validate with `zod`, debug with logs, and multiplex with stream frames. A custom binary framing protocol is unnecessary for the first implementation.
  Date/Author: 2026-06-22 / Codex

- Decision: Keep daemon state realtime for the first implementation.
  Rationale: If the daemon process is down, the remote host is offline from Cradle's perspective and live agents are gone. The first implementation should not invent daemon authoritative durable state. Provider-native files and live processes are the real remote state. Persist only daemon config, optional workspace roots, and lightweight recent metadata needed for display or debugging.
  Date/Author: 2026-06-22 / Codex

- Decision: Exclude local-to-remote and remote-to-local handoff from this plan.
  Rationale: Handoff needs git branch/worktree semantics and a separate acceptance story. It should not block proving the fundamental remote host daemon, protocol, and remote ChatRuntime transport.
  Date/Author: 2026-06-22 / Codex

- Decision: Prove the transport with a mock remote runtime before extracting Codex and Claude Agent provider adapters.
  Rationale: Provider extraction is large because the current provider adapters import server-local secrets, logging, observability, skill path, MCP, and approval/user-input dependencies. A mock runtime lets the team validate daemon packaging, protocol, stream multiplexing, server connection management, and Chat Runtime projection before moving provider core code.
  Date/Author: 2026-06-22 / Codex

- Decision: Store the remote host registry in Cradle's local SQLite database through new Drizzle tables owned by `remote-runtime-hosts`.
  Rationale: Host registry entries are Cradle-owned application data, not provider target data, not daemon-owned data, and not process memory. Use a new `remote_runtime_hosts` table for configured hosts and a new `remote_runtime_session_links` table for the local chat-session-to-remote-agent link. This gives reconnect and route code a concrete owner and avoids overloading `backend_session_bindings` or `providerTargets`.
  Date/Author: 2026-06-22 / Codex

- Decision: Treat connection-level failures and stream-level failures differently.
  Rationale: A daemon `stream.error` means the remote method or runtime failed while the connection is still usable. An SSH process exit, WebSocket close, malformed frame, or heartbeat timeout means transport failed and all pending RPCs and streams must reject with `remote_connection_lost` or `remote_host_offline`. The first implementation should not replay a half-finished stream after reconnect because that risks duplicate or missing chunks. A later attach can discover a still-live daemon agent, but the current Chat Runtime run should finish as failed on transport loss.
  Date/Author: 2026-06-22 / Codex

- Decision: Define `ProviderContext` explicitly in `packages/chat-runtime-contracts`.
  Rationale: Provider extraction depends on a clear dependency-injection boundary. The contract must include secret reads/writes, skill path resolution, runtime settings updates, user-input and tool-approval callbacks, observability recording, and logging as optional or required fields with concrete request/response types.
  Date/Author: 2026-06-22 / Codex

- Decision: Define `agent/turn` as a streaming remote turn method that receives a serializable subset of `StreamTurnInput` and emits typed turn events.
  Rationale: The daemon cannot receive callbacks such as `reportSessionTitle` directly. The method must receive the user message, transcript/history, model/runtime settings, run id, local chat session id, remote agent id, and workspace context. It emits `{ kind: 'chunk', chunk }`, `{ kind: 'sessionTitle', title }`, and `{ kind: 'providerThreadEvent', event }` stream values. `RemoteChatRuntime.streamTurn` maps those events back into yielded `UIMessageChunk`s and local callbacks.
  Date/Author: 2026-06-22 / Codex

- Decision: Put the first `RemoteChatRuntime` implementation under `apps/server/src/modules/chat-runtime-providers/remote-mock/provider.ts`.
  Rationale: A `ChatRuntime` implementation is a provider adapter and must register through the existing runtime registry. `remote-runtime-hosts` owns host connections and daemon RPC, but it should not own Chat Runtime provider registration or masquerade as a provider. The remote-mock provider depends on the remote-runtime-hosts service for transport.
  Date/Author: 2026-06-22 / Codex

- Decision: Keep daemon PTY sessions independent from daemon agents in the first implementation.
  Rationale: `pty/*` is a host control-plane feature for manually opened shells, parallel to `agent/*`. It is not an attach path into a provider-owned terminal and agents cannot open or claim PTYs through this protocol in the first version. Provider-owned background terminals remain provider-thread/UI-slot capabilities exposed through `ChatRuntime` when a provider supports them.
  Date/Author: 2026-06-22 / Codex

- Decision: Allow an explicit `connectionConfig.localSocketPath` for remote host records.
  Rationale: The production default remains OpenSSH with `ssh -N -L <localSocketPath>:<remoteSocketPath> <sshTarget>`, but tests and local smoke need a mature, non-SSH direct Unix-socket path to a locally started daemon or fake daemon. This is explicit Cradle-owned host connection config, not provider target state and not heuristic discovery.
  Date/Author: 2026-06-22 / Codex

- Decision: Test server-to-daemon behavior with a protocol-level fake daemon in server tests, not by importing `apps/agentd`.
  Rationale: The server must depend only on `@cradle/remote-agent-protocol`, not daemon app internals. The fake daemon speaks the same frames over a Unix socket and proves the server route/client/provider behavior while preserving dependency direction.
  Date/Author: 2026-06-22 / Codex

- Decision: Register `remote-mock` as a real Chat Runtime provider adapter, gated by `CRADLE_REMOTE_AGENT_DEV=1`.
  Rationale: The remote mock runtime must flow through the existing provider registry and Chat Runtime session/run/message projection. Gating avoids showing a development-only runtime in normal catalogs when no remote daemon host is configured.
  Date/Author: 2026-06-22 / Codex

## Outcomes & Retrospective

The first implementation is complete for the mock remote transport proof. `apps/agentd` runs independently of `apps/server`, the shared contract and protocol packages compile without server imports, the server owns a DB-backed remote host registry and session link namespace, and `remote-mock` can stream a daemon turn through the normal Chat Runtime response route into persisted assistant messages.

The focused proof uses `apps/server/tests/remote-runtime-hosts.test.ts`. It creates a remote host row with explicit `connectionConfig.localSocketPath`, verifies no `providerTargets` row is written by host registry CRUD, connects to a protocol-level fake daemon over a Unix socket, lists remote runtimes and agents, starts a fake remote agent, sends a normal `/chat/sessions/:sessionId/response` turn with runtime `remote-mock`, and asserts the assistant message contains `Remote mock response: Ping remote daemon`. It also asserts `remote_runtime_session_links` stores the authoritative `remoteHostId` and remote runtime kind.

Real Codex and Claude Agent provider adapter extraction was not performed in this implementation. The dependency-injection boundary is now defined by `ProviderContext` in `packages/chat-runtime-contracts`, but moving those real adapters out of server-local dependencies should be a follow-up migration with its own verification around secrets, MCP, approvals, user input, observability, and native provider state.

## Context and Orientation

Cradle currently has a local server app in `apps/server`. Its Chat Runtime module lives in `apps/server/src/modules/chat-runtime`. Chat Runtime owns Cradle chat sessions, persisted messages, backend run rows, durable queue rows, runtime settings, server-sent event streams, and UI projections. Concrete provider adapters live under `apps/server/src/modules/chat-runtime-providers`. Examples are Codex in `apps/server/src/modules/chat-runtime-providers/codex` and Claude Agent in `apps/server/src/modules/chat-runtime-providers/claude-agent`.

A provider adapter is the code that talks to one upstream runtime, such as Codex app-server or the Claude Agent SDK. A runtime process is the actual native program or SDK query running on a machine. A daemon is a long-running process. In this plan, `cradle-agentd` is the daemon running on the remote host. A remote host is a user's machine or server reached through SSH that contains the repository/workspace and provider credentials used by the runtime.

The current provider contract is `ChatRuntime` in `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`. It contains methods such as `startChatSession`, `resumeChatSession`, `streamTurn`, `steerTurn`, `cancelTurn`, `getUiSlotStates`, `listProviderThreads`, and `listBackgroundTerminals`. This shape should remain the logical provider boundary, but the type definitions must move to a package that both `apps/server` and `apps/agentd` can import.

`apps/server/src/modules/provider-runtime` owns local provider runtime binding and resource lifetime. Its `service.ts` resolves a chat session request into one of three sources: a live side conversation, a durable binding, or a new provider session. Its `host-manager.ts` is a local process resource lease manager, not a remote host registry. Do not overload it to mean SSH host.

`apps/server/src/modules/pty` owns local PTY sessions using `node-pty`. A PTY is a pseudo-terminal, the operating-system object that makes an interactive shell behave like a terminal. The remote daemon will also use `node-pty`, but that PTY process lives on the remote host and is controlled through daemon protocol methods such as `pty/open`, `pty/write`, and `pty/resize`.

The database table `backend_session_bindings` is defined in `packages/db/src/schema/backend-control-plane.ts`. It stores the provider session id and provider snapshot for a Cradle chat session. It does not store remote host identity. A robust remote implementation needs a separate remote host registry and remote session reference instead of pretending that `providerTargetId` or `runtimeKind` identifies a host.

The remote host registry for this plan is local Cradle data. It lives in new Drizzle tables under `packages/db/src/schema/remote-runtime-host.ts` and is served by `apps/server/src/modules/remote-runtime-hosts`. The table `remote_runtime_hosts` stores configured SSH targets, daemon socket paths, and structured connection profile JSON. Structured SSH profile JSON contains the host name, optional SSH user, optional port, auth mode, and optional identity file path. The service derives the legacy `sshTarget` column from that profile as `user@hostName` or `hostName`, while `port` and identity file become OpenSSH argv entries at connect time. The table `remote_runtime_session_links` stores the link from a Cradle chat session to a specific remote host and remote agent id. The daemon does not own this registry; it only reports live state when connected.

The monorepo uses pnpm workspaces. `pnpm-workspace.yaml` includes `packages/*` and `apps/*`, so new packages and apps added in those directories are automatically part of the workspace. Shared packages should export TypeScript sources through their `package.json`, following the pattern in `packages/ipc/package.json`.

## Plan of Work

First create `packages/chat-runtime-contracts`. This package owns only shared TypeScript contract types and minimal helper schemas. Move or copy the provider contract shape out of `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`, but remove server-only imports. Replace `ProviderRuntimeLease` with a small contract-level interface named `RuntimeLiveResourceLease` that exposes only `refresh(ttlMs?: number): void` and `release(): void`. Move `CradleTurnTranscript` into this package as a plain data shape containing `history`, `omittedMessageCount`, `truncated`, and `fallbackMessageCount`. Define contract-level `RuntimeLogger`, `RuntimeObservabilityEventInput`, `SecretValueWithMetadata`, `RuntimeUserInputRequest`, `RuntimeUserInputResolution`, `RuntimeToolApprovalRequest`, `RuntimeToolApprovalResolution`, and `ProviderContext` rather than importing the server logger, observability, pending-input, pending-approval, or secret service. Then update `apps/server` imports so server code consumes the package while server-owned implementations still live where they are.

Second create `packages/remote-agent-protocol`. This package owns the wire protocol between the local server and `cradle-agentd`. It defines zod schemas and TypeScript types for request, response, error, stream, and notification frames. The wire protocol should be JSON over WebSocket. The first frame after opening a connection is `host/hello`; it returns protocol version, daemon version, host id, platform, supported runtime ids, and server compatibility. Control methods include `host/health`, `runtime/list`, `workspace/list`, `agent/list`, `agent/start`, `agent/attach`, `agent/cancel`, `agent/steer`, `pty/open`, `pty/write`, `pty/resize`, and `pty/close`. Streaming methods use a `streamId` and send `stream.next`, `stream.error`, and `stream.close` frames. The package must not include any network socket code; it only owns schemas and type-safe encode/decode helpers.

Third create `apps/agentd`. The app should expose a binary named `cradle-agentd`. It starts a Node HTTP server bound to a Unix socket path, then attaches a `ws` WebSocket server. Default socket path is `~/.cradle/agentd/agent.sock`, overridable through `--socket` or `CRADLE_AGENTD_SOCKET`. The app must start without `apps/server` and without a Cradle Server database. It should implement `host/hello`, `host/health`, `runtime/list`, `workspace/list`, `agent/list`, and a mock `agent/start` plus `agent/turn` stream. It should also implement PTY open/write/resize/close using `node-pty`. The mock runtime is temporary but important: it streams a small deterministic assistant response as `RemoteAgentTurnEvent` values containing AI SDK `UIMessageChunk` chunks so the server can prove remote stream projection before provider extraction.

Fourth add `apps/server/src/modules/remote-runtime-hosts`. This module owns Cradle-local knowledge of remote host configuration and live connections. It reads and writes `remote_runtime_hosts` and `remote_runtime_session_links`, starts and stops OpenSSH tunnel processes, opens a WebSocket client to the tunneled Unix socket, performs `host/hello`, and exposes a typed daemon client. Host registry records are Cradle-owned database rows; do not write into `providerTargets` for host identity. The module should define a `RemoteRuntimeHostConnection` that can run unary RPC calls and streaming RPC calls against daemon methods. It should be observable and recoverable: if the SSH process exits, hello fails, WebSocket closes, or heartbeat times out, the host connection becomes offline and active streams fail with explicit transport errors.

Fifth add a `RemoteChatRuntime` adapter in `apps/server/src/modules/chat-runtime-providers/remote-mock/provider.ts`. This adapter implements the shared `ChatRuntime` contract but forwards work to the remote daemon through `remote-runtime-hosts`. The first adapter targets a daemon mock runtime and reads the selected `remoteHostId` from explicit remote runtime configuration. It should not pretend that each host is a new `runtimeKind`. The first proof registers a clearly named development runtime `remote-mock` so the catalog can select it without changing real Codex or Claude Agent behavior. Real remote Codex or Claude runtime selection is a later design step after the transport is proven.

Sixth integrate server routes for remote host operations. Add a small route surface under a Cradle-owned namespace such as `/remote-runtime-hosts`. The first routes should list configured hosts, read host health, list remote runtimes, list remote workspaces, list live remote agents, start a mock agent, and open a remote PTY. These routes are for remote host management and debugging. Chat turns still flow through normal `/chat/sessions/:sessionId/response` once `RemoteChatRuntime` is registered.

Seventh migrate real providers after the mock transport is proven. This is likely a follow-up phase inside the same plan unless it becomes too large and needs a second plan. Codex and Claude Agent provider code currently lives under `apps/server/src/modules/chat-runtime-providers`. Extract provider core gradually into a package such as `packages/chat-runtime-providers` or separate packages if that fits better. The extracted provider code must receive dependencies through `ProviderContext` from `packages/chat-runtime-contracts`. Server and daemon supply different implementations of those dependencies. Server implementations read Cradle DB-backed secrets, skill paths, MCP registry, user input, approvals, observability, and preferences. Daemon implementations read remote host environment/config and forward user-input or approval requests to the connected controller when needed. This plan does not make daemon PTYs available to providers; provider terminal capabilities remain separate provider-owned hooks.

## Concrete Steps

1. Start by checking the worktree. Run this from the repository root:

        cd /Users/wibus/dev/Cradle
        git status --short

   There may be unrelated local changes. Do not revert them. Keep edits scoped to new packages, `apps/agentd`, server imports needed for contract extraction, and remote host client integration.

2. Create `packages/chat-runtime-contracts/package.json` with name `@cradle/chat-runtime-contracts`, `"type": "module"`, `"private": true`, and exports for `"."`. Add `ai` and `zod` as dependencies only if runtime schemas need them; use type-only imports from `ai` where possible. Create `packages/chat-runtime-contracts/src/index.ts`.

3. Move shared contract types from `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` into `packages/chat-runtime-contracts/src/index.ts`. Preserve stable names where possible: `ChatRuntime`, `RuntimeSession`, `StartChatSessionInput`, `ResumeChatSessionInput`, `StreamTurnInput`, `CancelTurnInput`, `SteerTurnInput`, `RuntimeUiSlot`, `RuntimeUiSlotState`, `RuntimeContextUsage`, `ProviderThread`, `ProviderThreadEvent`, `RuntimeBackgroundTerminal`, `RuntimeProviderTargetProfile`, `ChatRuntimeSettings`, and `ProviderRuntimeError`. Replace server-only imports with package-owned minimal interfaces:

        export interface RuntimeLiveResourceLease<Resource = unknown> {
          readonly resource?: Resource
          refresh(ttlMs?: number): void
          release(): void
        }

        export interface RuntimeLogger {
          debug(input: unknown, message?: string): void
          info(input: unknown, message?: string): void
          warn(input: unknown, message?: string): void
          error(input: unknown, message?: string): void
        }

        export interface RuntimeObservabilityEventInput {
          source: string
          code: string
          severity: string
          category: string
          message: string
          attrs?: Record<string, unknown>
          chatSessionId?: string
          runId?: string
          messageId?: string
          traceId?: string
          dedupeKey?: string
          occurredAt?: number
          recordedAt?: number
        }

        export interface ProviderContext {
          readSecret: (credentialRef: string) => string
          readSecretValueWithMetadata?: (credentialRef: string) => SecretValueWithMetadata
          updateSecret?: (credentialRef: string, value: string) => void
          resolveSkillPaths?: (workspacePath: string) => string[]
          updateSessionRuntimeSettings?: (input: {
            sessionId: string
            patch: ChatRuntimeSettingsPatch
          }) => Promise<void>
          requestUserInput?: (input: RuntimeUserInputRequest) => Promise<RuntimeUserInputResolution>
          requestToolApproval?: (input: RuntimeToolApprovalRequest) => Promise<RuntimeToolApprovalResolution>
          recordObservability?: (input: RuntimeObservabilityEventInput) => void
          logger?: RuntimeLogger
        }

   Do not use `unknown` as a workaround for every type. Use concrete contract types when the shape is known. Use `unknown` only for intentionally provider-native payloads such as raw protocol notifications.

4. Update `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`. Prefer turning it into a compatibility re-export:

        export type {
          ChatRuntime,
          RuntimeSession,
          ...
        } from '@cradle/chat-runtime-contracts'

   If some types are still server-only, leave those types in the server file temporarily with a comment explaining why they are not part of the shared contract. Run:

        pnpm --filter @cradle/server exec tsc --noEmit --pretty false

   Expected result: type errors identify any contract imports that still point at server-local types. Fix them without adding compatibility shims that hide ownership.

5. Add Cradle-owned DB schema for remote host registry and remote session links. Create `packages/db/src/schema/remote-runtime-host.ts` and export it from `packages/db/src/index.ts`. Define `remoteRuntimeHosts` and `remoteRuntimeSessionLinks` with Drizzle. Use a migration generated by the existing drizzle workflow. The schema must be explicit:

        export const remoteRuntimeHosts = sqliteTable('remote_runtime_hosts', {
          id: textPk(),
          displayName: text('display_name').notNull(),
          sshTarget: text('ssh_target').notNull(),
          remoteSocketPath: text('remote_socket_path').notNull(),
          enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
          lastDaemonHostId: text('last_daemon_host_id'),
          lastDaemonVersion: text('last_daemon_version'),
          lastPlatform: text('last_platform'),
          lastArch: text('last_arch'),
          lastSeenAt: int('last_seen_at'),
          connectionConfigJson: text('connection_config_json').notNull().default('{}'),
          createdAt: int('created_at').notNull(),
          updatedAt: int('updated_at').notNull(),
        })

        export const remoteRuntimeSessionLinks = sqliteTable('remote_runtime_session_links', {
          id: textPk(),
          chatSessionId: text('chat_session_id').notNull().unique().references(() => sessions.id, { onDelete: 'cascade' }),
          remoteHostId: text('remote_host_id').notNull().references(() => remoteRuntimeHosts.id, { onDelete: 'cascade' }),
          remoteAgentId: text('remote_agent_id').notNull(),
          remoteRuntimeKind: text('remote_runtime_kind').notNull(),
          daemonHostId: text('daemon_host_id'),
          providerSessionId: text('provider_session_id'),
          stateSnapshotJson: text('state_snapshot_json').notNull().default('{}'),
          createdAt: int('created_at').notNull(),
          updatedAt: int('updated_at').notNull(),
        })

   `remoteRuntimeHosts` is the host registry. `remoteRuntimeSessionLinks` is the first-class replacement for storing remote host identity inside `backend_session_bindings`. `backend_session_bindings.backendSessionId` may still store a provider-visible id for Chat Runtime compatibility, but remote host identity must be read from `remote_runtime_session_links`.

6. Create `packages/remote-agent-protocol/package.json` with name `@cradle/remote-agent-protocol`, dependency on `zod`, and dependency on `@cradle/chat-runtime-contracts`. Create `packages/remote-agent-protocol/src/index.ts`, `src/frames.ts`, `src/methods.ts`, and `src/validation.ts`.

7. Define protocol frames. Use JSON object frames only. The required frame kinds are:

        rpc.request
        rpc.response
        rpc.error
        stream.open
        stream.next
        stream.error
        stream.close
        notification

   Each frame has `protocolVersion: 1`, `id` for unary RPC requests/responses, or `streamId` for streaming calls. Define `RemoteAgentProtocolError` with `code`, `message`, and optional `details`. Use zod to parse every inbound frame. Add unit tests in `packages/remote-agent-protocol/src/frames.test.ts` for valid frames, invalid missing ids, invalid stream ids, and unknown method names.

8. Define method parameter/result types. The initial methods are:

        host/hello
        host/health
        runtime/list
        workspace/list
        agent/list
        agent/start
        agent/attach
        agent/cancel
        agent/steer
        agent/turn
        pty/open
        pty/write
        pty/resize
        pty/close

   `agent/turn` is a streaming method. Its params are a serializable remote form of `StreamTurnInput`, not the full server callback object:

        export interface RemoteAgentTurnParams {
          remoteAgentId: string
          chatSessionId: string
          runId: string
          responseMessageId?: string
          message: UIMessage
          transcript?: CradleTurnTranscript
          originalMessages?: UIMessage[]
          modelId?: string | null
          workspaceId?: string | null
          workspacePath?: string
          cradleAgentId?: string | null
          providerOptions?: {
            thinkingEffort?: ChatThinkingEffort
            runtimeSettings?: ChatRuntimeSettings
          }
          systemPrompt?: string
          history?: UIMessage[]
        }

   Its stream values are:

        export type RemoteAgentTurnEvent =
          | { kind: 'chunk', chunk: UIMessageChunk }
          | { kind: 'sessionTitle', title: string }
          | { kind: 'providerThreadEvent', event: ProviderThreadEvent }

   `RemoteChatRuntime.streamTurn` yields only `chunk` events, calls `reportSessionTitle` for `sessionTitle`, and calls `onProviderThreadEvent` for `providerThreadEvent`. The mock daemon must use `RemoteAgentTurnParams.message` to produce output, for example by echoing the user text in a deterministic response. That proves input-to-output mapping instead of only streaming a hard-coded paragraph.

9. Create `apps/agentd/package.json` with name `@cradle/agentd`, `"type": "module"`, a `bin` entry for `cradle-agentd`, scripts for `dev`, `build`, `start`, `typecheck`, and `test`, and dependencies on `@cradle/chat-runtime-contracts`, `@cradle/remote-agent-protocol`, `ai`, `node-pty`, `ws`, and `zod`. Add `@types/ws` only if TypeScript needs it. Do not depend on `@cradle/server`.

10. Implement `apps/agentd/src/main.ts` and `apps/agentd/src/server.ts`. Use Node `http.createServer()` listening on a Unix socket path and `ws.WebSocketServer` attached to that server. On startup, ensure the socket directory exists, remove a stale socket only if no process is listening, and set permissions to owner-only where supported. The process should log the socket path and daemon version. It should exit with a clear error if the socket is already owned by a live daemon.

11. Implement daemon method dispatch in `apps/agentd/src/daemon.ts`. Keep it small and explicit. `host/hello` returns:

        {
          protocolVersion: 1,
          daemonVersion: "<package version>",
          hostId: "<stable machine-local id>",
          platform: process.platform,
          arch: process.arch,
          supportedMethods: [...]
        }

   Use a stable host id stored under `~/.cradle/agentd/host-id` or a path under `CRADLE_AGENTD_HOME`; create it once with `crypto.randomUUID()`.

12. Implement the daemon mock agent registry in `apps/agentd/src/agents.ts`. The registry is process-local realtime state. `agent/list` returns live agents only. `agent/start` with runtime id `mock-remote` creates a live agent record with `agentId`, `runtimeKind`, `workspacePath`, `status`, `createdAt`, and optional `providerSessionId`. `agent/turn` accepts `RemoteAgentTurnParams` and streams deterministic `RemoteAgentTurnEvent` values: assistant start, text start, text deltas that include text extracted from `params.message`, text end, and finish. Use actual AI SDK `UIMessageChunk` shapes already accepted by Chat Runtime tests. Add tests for agent start/list/turn stream using the protocol client without the server.

13. Implement daemon workspace listing in `apps/agentd/src/workspaces.ts`. First version reads configured roots from `CRADLE_AGENTD_WORKSPACE_ROOTS`, a colon-separated list on Unix. If unset, return an empty list with a helpful message; do not scan the entire home directory heuristically. For each root, list immediate child directories that contain `.git`, `package.json`, or `pnpm-workspace.yaml`. This is a bounded, explicit discovery rule tied to configured roots, not a broad heuristic. If broader discovery is desired later, stop and discuss it.

14. Implement daemon PTY registry in `apps/agentd/src/pty.ts` using `node-pty`. It should mirror the shape of `apps/server/src/modules/pty/pty.runtime.ts` without importing it. `pty/open` creates a shell with cwd under the requested workspace path, `pty/write` writes input, `pty/resize` resizes, and `pty/close` terminates. PTY output is a stream with `stream.next` values containing `{ data }`, and exit sends `stream.close` after an exit notification. These PTYs are independent host-level shells. They are not attached to daemon agents, not visible as provider background terminals, and not available for agents to claim in the first implementation. Add tests for protocol-level open/write/close if possible; if CI cannot run PTY reliably, keep a manual smoke command in this plan and mark automated PTY coverage as limited.

15. Add `apps/server/src/modules/remote-runtime-hosts`. Create a README first to state ownership: this module owns Cradle-local remote host registry, remote session links, SSH tunnel lifecycle, daemon client, and remote host HTTP routes. It does not own provider-native semantics and does not write provider-target namespace data. Add `model.ts` for Elysia TypeBox schemas, `service.ts` for DB-backed host registry and tunnel lifecycle, `daemon-client.ts` for WebSocket protocol client, `ssh-tunnel.ts` for OpenSSH spawning, `session-links.ts` for `remote_runtime_session_links`, and `index.ts` for routes.

16. Implement OpenSSH tunnel lifecycle in `ssh-tunnel.ts` using `node:child_process.spawn`. Prefer system `ssh` and allow users to rely on `~/.ssh/config`. The command shape for Unix sockets is:

        ssh -N -L <localSocketPath>:<remoteSocketPath> <sshTarget>

   Use a generated local socket path under the Cradle data directory, such as `<CRADLE_DATA_DIR>/remote-runtime-hosts/<hostId>.sock`. Do not expose TCP ports by default. Capture stderr for diagnostics and treat process exit as host offline. Do not add `ssh2` unless a later spike proves system OpenSSH is insufficient.

17. Implement daemon WebSocket client in `daemon-client.ts` using `ws`. Connect to the local forwarded Unix socket using `ws` with a `createConnection` option that returns `net.createConnection(localSocketPath)`, or use the most direct documented `ws` Unix socket connection form after verifying it in a small test. All inbound frames go through `@cradle/remote-agent-protocol` validation. Provide:

        call<TMethod>(method, params): Promise<Result>
        openStream<TMethod>(method, params): AsyncGenerator<Value>
        close(): Promise<void>

   Keep request id and stream id generation local to the client. The client has a small state machine: `idle`, `connecting`, `connected`, `disconnected`, and `offline`. `ensureConnected()` may open a tunnel and perform `host/hello` for a new control call. It must not reconnect inside an active stream. If the daemon sends `stream.error`, reject only that stream and leave the connection usable. If the WebSocket closes, SSH exits, heartbeat times out, or a malformed frame is received, mark the connection disconnected/offline, reject every pending call and stream with a transport error, and let Chat Runtime mark the active run failed. A later user action may reconnect and attach to whatever daemon agents are still live.

18. Add server routes under `/remote-runtime-hosts`. The first routes are `GET /remote-runtime-hosts`, `POST /remote-runtime-hosts`, `PATCH /remote-runtime-hosts/:hostId`, `DELETE /remote-runtime-hosts/:hostId`, `POST /remote-runtime-hosts/:hostId/connect`, `POST /remote-runtime-hosts/:hostId/disconnect`, `GET /remote-runtime-hosts/:hostId/health`, `GET /remote-runtime-hosts/:hostId/runtimes`, `GET /remote-runtime-hosts/:hostId/workspaces`, `GET /remote-runtime-hosts/:hostId/agents`, and a development-only mock stream route if useful for validating the daemon before Chat Runtime integration. Include `x-cradle-cli` metadata if this repository's route conventions require generated CLI commands for non-streaming routes. Create/patch routes write only `remote_runtime_hosts`; they never write `providerTargets`.

19. Register the new server module in `apps/server/src/app.ts`. Import and `app.use(remoteRuntimeHosts)` alongside other server modules. Ensure `createServerContractApp()` can build OpenAPI route contracts without starting SSH tunnels or connecting to daemons. Runtime connections must start only on explicit route calls or background-task startup when a future preference enables it.

20. Implement `RemoteChatRuntime` for `remote-mock`. Create `apps/server/src/modules/chat-runtime-providers/remote-mock/provider.ts`. It implements `ChatRuntime` from `@cradle/chat-runtime-contracts` and forwards `streamTurn` to daemon `agent/turn`. It calls `remote-runtime-hosts` service functions to resolve the selected host, ensure a daemon connection, start or attach a remote mock agent, and write the `remote_runtime_session_links` row. It stores a redundant readable snapshot in `RuntimeSession.providerStateSnapshot`, with a clear JSON shape:

        {
          "remote": {
            "hostId": "...",
            "agentId": "...",
            "runtimeKind": "mock-remote",
            "updatedAt": 1780000000000
          },
          "models": { "currentModelId": null }
        }

   Do not store remote host identity only in `backendSessionId`. `backendSessionId` may store the remote agent id for Provider Runtime compatibility, but the authoritative host link is `remote_runtime_session_links.remoteHostId`.

21. Register `remote-mock` in `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts` behind an environment flag such as `CRADLE_REMOTE_AGENT_DEV=1` or after a configured remote host exists. Do not pollute normal runtime selectors with a broken option when no daemon is configured. Add a focused test that uses a fake daemon client rather than opening SSH.

22. Prove Chat Runtime projection. Create or adapt a server test that starts a chat session with runtime `remote-mock`, sends a response through the normal Chat Runtime service, and asserts the final persisted assistant message contains deterministic mock daemon text derived from the user's input message. This proves the remote transport maps input through daemon protocol and back into existing session/message/run storage.

23. Run validation:

        pnpm --filter @cradle/chat-runtime-contracts exec tsc --noEmit --pretty false
        pnpm --filter @cradle/remote-agent-protocol test
        pnpm --filter @cradle/agentd test
        pnpm --filter @cradle/agentd exec tsc --noEmit --pretty false
        pnpm --filter @cradle/server exec vitest run tests/remote-runtime-hosts.test.ts
        pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts --testNamePattern "remote"
        pnpm --filter @cradle/server exec tsc --noEmit --pretty false

   Adjust exact test filenames after implementation. The expected result is that contract/protocol/agentd tests pass, server focused tests pass, and server typecheck passes.

   The implemented validation commands and observed results are:

        pnpm --filter @cradle/chat-runtime-contracts exec tsc --noEmit --pretty false
        # passed

        pnpm --filter @cradle/remote-agent-protocol exec tsc --noEmit --pretty false
        # passed

        pnpm --filter @cradle/remote-agent-protocol test
        # 1 test file passed, 5 tests passed

        pnpm --filter @cradle/agentd exec tsc --noEmit --pretty false
        # passed

        pnpm --filter @cradle/agentd test
        # 2 test files passed, 2 tests passed

        pnpm --filter @cradle/server exec vitest run tests/remote-runtime-hosts.test.ts
        # 1 test file passed, 3 tests passed

        pnpm --filter @cradle/server exec tsc --noEmit --pretty false
        # passed

        rg -n "@cradle/server|apps/server|\\.\\./\\.\\./server|src/modules" apps/agentd packages/chat-runtime-contracts packages/remote-agent-protocol
        # no matches; ripgrep exits 1 for no matches

24. Perform a manual local smoke without SSH. Start agentd on a local socket:

        pnpm --filter @cradle/agentd dev -- --socket /tmp/cradle-agentd.sock

   In another terminal, use a small server-side script or route call to connect to that socket directly and call `host/hello`, `runtime/list`, `agent/start`, and `agent/turn`. Expected output includes protocol version `1`, runtime `mock-remote`, and streamed text from the mock turn.

25. Perform a manual SSH tunnel smoke if a reachable host is available. Install or copy the built agentd app onto the remote host, start it with a remote socket, then from local run:

        ssh -N -L /tmp/cradle-agentd-local.sock:/home/<user>/.cradle/agentd/agent.sock <ssh-target>

   Connect the server daemon client to `/tmp/cradle-agentd-local.sock` and call `host/hello`. Expected result: the local server receives the remote daemon's host id and platform. If no remote host is available, record that this smoke was skipped and keep local Unix socket smoke as the completed proof.

## Validation and Acceptance

Acceptance is behavior-first. A developer can run `cradle-agentd` as an independent app without starting `apps/server`. The daemon prints a Unix socket path and answers `host/hello` with protocol version, daemon version, host id, platform, and supported methods.

The protocol package must reject malformed frames. A test should send frames with missing `id`, missing `streamId`, unknown method names, and invalid protocol version, and should observe typed validation errors rather than uncaught exceptions.

The server can create, update, list, and delete remote host registry rows in `remote_runtime_hosts`. Creating a host row with `sshTarget` and `remoteSocketPath` should not create or mutate any `providerTargets` row. A test should insert a host, list it through `/remote-runtime-hosts`, patch its display name or socket path, and delete it. The DB row should be gone after delete, and no provider target should have been written.

The server can connect to the daemon through a typed client and list remote runtimes, workspaces, and agents. If the daemon is stopped, server routes return an explicit offline error and do not start local provider runtimes as a fallback. If the daemon sends `stream.error`, only that stream fails and the connection can still answer `host/health`. If the WebSocket closes or the SSH process exits during an active `agent/turn`, the Chat Runtime run becomes failed with a transport error, and a later reconnect is an explicit new operation rather than an automatic replay of the old stream.

The mock remote chat runtime can be selected in a controlled development path and can stream a deterministic assistant response into a normal Cradle chat session. The response must include text derived from the user's input message, not only a hard-coded phrase. The resulting assistant message is persisted in `messages`, linked to a `backend_runs` row, linked to a `remote_runtime_session_links` row, and visible through the existing chat message hydration route. This proves the local Chat Runtime remains the projection owner while remote host identity is stored in its own namespace.

The daemon PTY can open a shell, receive input, stream output, resize, and close. Manual acceptance is enough for the first PTY proof if automated PTY tests are unreliable on CI, but the behavior must be documented with a command transcript in `Artifacts and Notes`. The same acceptance must show that PTY sessions are listed and closed through `pty/*` methods, not through `agent/*`, and that starting or stopping a PTY does not create, attach, or mutate a daemon agent.

The dependency boundary is an acceptance criterion. Running this command must not find an import from `apps/agentd` into server internals:

        rg -n "@cradle/server|apps/server|\\.\\./\\.\\./server|src/modules" apps/agentd packages/chat-runtime-contracts packages/remote-agent-protocol

Expected result: no matches that represent runtime imports. Test fixtures or comments may mention paths only if they are explaining forbidden dependencies; prefer no matches at all.

The extraction boundary is also an acceptance criterion. `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` should either be deleted or be a thin re-export/compatibility file. The source of truth for shared provider contract types is `packages/chat-runtime-contracts`.

## Idempotence and Recovery

Creating the new packages and app is additive. Re-running `pnpm install` after adding package manifests is safe. Re-running TypeScript and Vitest commands is safe.

Remote host registry writes are durable local DB writes. Re-running host create with the same `id` should upsert only the `remote_runtime_hosts` row for that id; connection failures must not delete registry rows. Deleting a host should cascade its `remote_runtime_session_links` rows by foreign key and should not delete chat sessions or messages.

The daemon socket startup must be idempotent. If the socket path exists but no daemon listens on it, startup may remove the stale socket and continue. If another live daemon responds on that socket, startup must fail with a clear message instead of replacing it.

SSH tunnel startup must be explicit and recoverable. If the spawned `ssh` command exits, mark the host offline, close outstanding daemon streams, and retain the host registry entry. If WebSocket closes while SSH remains alive, mark the daemon client disconnected, reject pending calls and streams, and allow the next explicit operation to create a new WebSocket and run `host/hello`. The user can reconnect by calling the connect route again. Do not delete host registry entries on connection failure.

Agent state in daemon is realtime. If `cradle-agentd` restarts, `agent/list` returns only agents started after restart. The local server must treat old remote agent attachments as unavailable and return `remote_agent_not_found` or `remote_host_offline`; it must not silently create a new agent for an attach request.

Remote session identity is stored in `remote_runtime_session_links` and mirrored in `providerStateSnapshot.remote` for debugging and compatibility. If this shape changes during implementation, update all plan sections and add a Decision Log entry explaining the migration path. Do not write remote host identity into provider target configuration.

If provider contract extraction causes too many compile failures, stop after `packages/chat-runtime-contracts` is introduced and update this plan with a narrower migration sequence. Do not paper over the problem by adding compatibility `unknown` fields or importing `apps/server` types into the contract package.

## Artifacts and Notes

The intended architecture after the package split is:

        apps/server
          imports @cradle/chat-runtime-contracts
          imports @cradle/remote-agent-protocol
          owns local DB, sessions, messages, runs, queue, projections
          owns SSH tunnel lifecycle and daemon client

        apps/agentd
          imports @cradle/chat-runtime-contracts
          imports @cradle/remote-agent-protocol
          owns remote live agents, runtime processes, PTYs, workspace discovery
          does not import @cradle/server

        packages/chat-runtime-contracts
          owns ChatRuntime and provider-facing shared types
          imports no server module

        packages/remote-agent-protocol
          owns daemon wire frames and zod validation
          imports chat-runtime-contracts where needed
          imports no server module

The intended runtime flow for a mock remote chat turn is:

        User sends message in Cradle
        apps/server Chat Runtime creates local user message and backend run
        RemoteChatRuntime.streamTurn reads or creates remote_runtime_session_links
        RemoteChatRuntime.streamTurn opens daemon stream agent/turn with RemoteAgentTurnParams
        apps/agentd mock agent emits RemoteAgentTurnEvent values derived from the input message
        apps/server Chat Runtime persists assistant message and run terminal state
        Renderer hydrates the result through existing chat APIs

The intended host control flow is:

        local server POST /remote-runtime-hosts/:hostId/connect
        server spawns ssh -N -L local.sock:remote.sock host
        server WebSocket client connects to local.sock
        daemon receives WebSocket on remote Unix socket
        server sends host/hello
        daemon returns protocolVersion and host identity

The intended failure mapping is:

        daemon sends stream.error
          -> only that stream fails
          -> WebSocket remains connected
          -> Chat Runtime run fails with remote method/runtime error

        WebSocket closes, SSH exits, heartbeat times out, or frame validation fails
          -> all pending calls and streams fail with transport error
          -> host connection becomes disconnected/offline
          -> active Chat Runtime run fails with remote_connection_lost or remote_host_offline
          -> no automatic stream replay occurs

The intended PTY relationship is:

        pty/open creates a host-level shell
        pty/write, pty/resize, and pty/close target that shell id
        agent/list does not include PTY ids
        agent/turn cannot read or write PTY sessions in the first implementation

Do not implement a file synchronization or handoff mechanism in this plan. Handoff means moving a native provider thread and git worktree state between hosts. That requires separate git/worktree ownership decisions and should be planned after remote runtime attachment works.

## Interfaces and Dependencies

Use these dependencies and avoid inventing replacement protocols:

System OpenSSH owns SSH authentication, encryption, host key verification, SSH config, ProxyJump, and tunnel setup. The server starts it with `node:child_process.spawn` and observes process exit. Do not add `ssh2` in the first implementation.

`ws` owns WebSocket server/client framing for the daemon protocol. Add it as a runtime dependency where used, not only a dev dependency. For Unix socket client connections, verify the supported `ws` connection option in a small test before relying on it.

`zod` owns wire frame validation in `packages/remote-agent-protocol`. Use zod at the process boundary. Inside already-typed server or daemon code, trust TypeScript types instead of converting everything to `unknown` and revalidating repeatedly.

`node-pty` owns PTY creation on the daemon side. Do not route remote shell sessions through provider background terminal APIs. Remote PTY is a host-level control-plane capability, parallel to agents.

`ai` owns `UIMessage` and `UIMessageChunk` shapes. The contract package can import these types. Do not create a Cradle-specific clone of AI SDK message internals.

The required package interfaces are:

        packages/chat-runtime-contracts/src/index.ts
          export interface ChatRuntime
          export interface RuntimeSession
          export interface RuntimeLiveResourceLease<Resource = unknown>
          export interface StartChatSessionInput
          export interface ResumeChatSessionInput
          export interface StreamTurnInput
          export interface CancelTurnInput
          export interface SteerTurnInput
          export interface ProviderContext
          export interface RuntimeUserInputRequest
          export interface RuntimeUserInputResolution
          export interface RuntimeToolApprovalRequest
          export interface RuntimeToolApprovalResolution
          export interface RuntimeObservabilityEventInput
          export interface SecretValueWithMetadata
          export interface RuntimeLogger
          export interface CradleTurnTranscript
          export class ProviderRuntimeError
          export const ProviderErrors

        packages/chat-runtime-contracts/src/index.ts ProviderContext fields
          readSecret: (credentialRef: string) => string
          readSecretValueWithMetadata?: (credentialRef: string) => SecretValueWithMetadata
          updateSecret?: (credentialRef: string, value: string) => void
          resolveSkillPaths?: (workspacePath: string) => string[]
          updateSessionRuntimeSettings?: (input: { sessionId: string, patch: ChatRuntimeSettingsPatch }) => Promise<void>
          requestUserInput?: (input: RuntimeUserInputRequest) => Promise<RuntimeUserInputResolution>
          requestToolApproval?: (input: RuntimeToolApprovalRequest) => Promise<RuntimeToolApprovalResolution>
          recordObservability?: (input: RuntimeObservabilityEventInput) => void
          logger?: RuntimeLogger

        packages/remote-agent-protocol/src/index.ts
          export type RemoteAgentFrame
          export type RemoteAgentRequestFrame
          export type RemoteAgentResponseFrame
          export type RemoteAgentStreamFrame
          export type RemoteAgentMethod
          export interface RemoteAgentTurnParams
          export type RemoteAgentTurnEvent
          export function parseRemoteAgentFrame(input: unknown): RemoteAgentFrame
          export function encodeRemoteAgentFrame(frame: RemoteAgentFrame): string
          export const REMOTE_AGENT_PROTOCOL_VERSION: 1

        packages/db/src/schema/remote-runtime-host.ts
          export const remoteRuntimeHosts
          export const remoteRuntimeSessionLinks
          export type RemoteRuntimeHost
          export type NewRemoteRuntimeHost
          export type RemoteRuntimeSessionLink
          export type NewRemoteRuntimeSessionLink

        apps/agentd/src/server.ts
          export interface AgentdServerOptions {
            socketPath: string
            homeDir: string
          }
          export function startAgentdServer(options: AgentdServerOptions): Promise<AgentdServer>

        apps/server/src/modules/remote-runtime-hosts/daemon-client.ts
          export type RemoteRuntimeHostConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'offline'
          export interface RemoteAgentDaemonClient {
            call<M extends RemoteAgentUnaryMethod>(method: M, params: RemoteAgentParams<M>): Promise<RemoteAgentResult<M>>
            openStream<M extends RemoteAgentStreamMethod>(method: M, params: RemoteAgentParams<M>): AsyncGenerator<RemoteAgentStreamValue<M>>
            close(): Promise<void>
          }

        apps/server/src/modules/remote-runtime-hosts/ssh-tunnel.ts
          export interface SshTunnelOptions {
            hostId: string
            sshTarget: string
            localSocketPath: string
            remoteSocketPath: string
          }
          export function startSshTunnel(options: SshTunnelOptions): Promise<SshTunnelHandle>

        apps/server/src/modules/remote-runtime-hosts/service.ts
          export function createRemoteRuntimeHost(input: CreateRemoteRuntimeHostInput): RemoteRuntimeHostView
          export function updateRemoteRuntimeHost(hostId: string, patch: UpdateRemoteRuntimeHostInput): RemoteRuntimeHostView
          export function deleteRemoteRuntimeHost(hostId: string): void
          export function connectRemoteRuntimeHost(hostId: string): Promise<RemoteRuntimeHostConnectionView>
          export function disconnectRemoteRuntimeHost(hostId: string): Promise<void>
          export function listRemoteRuntimeHosts(): RemoteRuntimeHostView[]
          export function readRemoteRuntimeHostHealth(hostId: string): Promise<RemoteRuntimeHostHealthView>
          export function readRemoteRuntimeSessionLink(chatSessionId: string): RemoteRuntimeSessionLink | null
          export function upsertRemoteRuntimeSessionLink(input: UpsertRemoteRuntimeSessionLinkInput): RemoteRuntimeSessionLink
          export function buildSshProfileLaunchConfig(profile: RemoteRuntimeHostSshProfile): SshProfileLaunchConfig

        Structured SSH create/update inputs accepted by this service include:
          transport?: 'ssh' | 'direct-socket'
          sshProfile?: { hostName: string; user?: string | null; port?: number | null; auth?: 'default' | 'identityFile'; identityFilePath?: string | null }
          localSocketPath?: string
          connectTimeoutMs?: number

The long-term provider extraction interface is the existing `ProviderContext`, moved into `packages/chat-runtime-contracts`. It must stay dependency-injected. Server and daemon provide implementations; provider adapters must not reach sideways into server modules.

Revision note, 2026-06-22: Initial plan created after deciding that the remote daemon is a new app, shared Chat Runtime contract/protocol must be extracted into packages, daemon state is realtime for the first implementation, system OpenSSH is the tunnel layer, WebSocket plus JSON-RPC frames are the app protocol, and handoff is out of scope.

Revision note, 2026-06-22: Revised after design review to remove six ambiguities. Host registry and remote session links are now DB-backed tables; transport disconnects and stream errors have separate semantics; ProviderContext fields are explicit; `agent/turn` has concrete params and stream event types; `RemoteChatRuntime` lives under `chat-runtime-providers/remote-mock`; and daemon PTY sessions are independent host-level shells for the first implementation.

Revision note, 2026-06-22: Updated after implementation. The mock remote daemon path, shared packages, DB schema, server host module, remote-mock provider, route registration, focused tests, PTY tests, and validation results are now recorded. Real Codex and Claude Agent provider extraction remains a documented follow-up phase rather than part of the completed mock transport proof.

Revision note, 2026-06-22: Added the structured SSH profile backend decision and implementation details. The server route contract now exposes user-facing SSH profile fields, while connection-time OpenSSH argv generation remains owned by `remote-runtime-hosts`.
