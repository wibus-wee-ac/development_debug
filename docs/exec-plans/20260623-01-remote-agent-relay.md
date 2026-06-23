# Build Remote Agent Relay Service

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The file itself is the plan, so it intentionally omits an outer Markdown code fence. A future implementer must be able to start from only this file and complete the change without relying on chat history.

This plan builds on `docs/exec-plans/20260622-01-remote-agent-daemon.md`, which introduced `apps/agentd`, `packages/remote-agent-protocol`, and `apps/server/src/modules/remote-runtime-hosts` for an SSH or local Unix-socket daemon proof. This plan adds a public WebSocket relay path for cases where SSH is unavailable or the user wants pairing-based remote access.

## Purpose / Big Picture

Cradle should let a remote `cradle-agentd` connect outward to a public relay over WSS, show a short pairing code to the user, and allow the local Cradle Server to claim that code and control the remote daemon through the same remote-agent protocol already used by the SSH proof. This lets users reach remote hosts behind NAT, locked-down networks, or environments where inbound SSH is not usable.

After this plan is implemented, a developer can start a Go relay service, start `cradle-agentd` in relay mode, claim a short pairing code from Cradle Server, and run the existing remote mock chat turn through the normal Chat Runtime projection path. The relay service only owns pairing, short-lived connection state, heartbeats, backpressure, and envelope forwarding. It does not own Cradle users, chat sessions, agent runs, workspaces, provider semantics, provider-native logs, or resume history.

## Progress

- [x] (2026-06-23 00:00 +0800) Read the existing remote-agent daemon ExecPlan and confirmed it already completed a local SSH/Unix-socket mock transport proof.
- [x] (2026-06-23 00:00 +0800) Confirmed the repository has no Go module or Go source today, so the relay plan must include first Go module setup under `apps/relayd`.
- [x] (2026-06-23 00:00 +0800) Decided to add this as a new ExecPlan rather than rewriting the completed daemon proof, because relay is a second transport path with its own deployment and operational semantics.
- [x] (2026-06-23 00:00 +0800) Drafted this self-contained plan for a Go relay service, Cradle Server token minting, agentd outbound relay mode, and server-side controller relay mode.
- [x] (2026-06-23 00:16 +0800) Rechecked the plan against the available Go skills: `golang-how-to`, `golang-design-patterns`, `golang-error-handling`, `golang-security`, `golang-code-style`, `golang-safety`, and `golang-modernize`. Updated the plan to target the installed Go 1.25 toolchain and to call out Go 1.25-era style, safety, and validation requirements.
- [x] (2026-06-23 00:44 +0800) Created the standalone `apps/relayd` Go module with `go 1.25`, `net/http`, `github.com/coder/websocket`, health/readiness routes, pairing routes, host/controller WebSocket routes, in-memory rooms, heartbeat, bounded queues, metrics counters, and optional pprof.
- [x] (2026-06-23 00:44 +0800) Added `packages/remote-relay-protocol` with TypeScript relay envelope schemas, JSON encode/parse helpers, relay control payload schemas, and fixtures mirrored under `apps/relayd/testdata` for Go fixture tests.
- [x] (2026-06-23 00:44 +0800) Added `apps/agentd` outbound relay mode through `apps/agentd/src/relay-client.ts`, reused `AgentdDaemon` dispatch through `apps/agentd/src/protocol-dispatch.ts`, and kept the existing Unix-socket server mode intact.
- [x] (2026-06-23 00:44 +0800) Added Cradle Server relay integration under `apps/server/src/modules/remote-runtime-hosts`: HMAC relay token minting, `/relay/pairing-token`, `/relay/claim`, relay transport config, and a controller WebSocket daemon client.
- [x] (2026-06-23 00:54 +0800) Fixed an agentd relay first-frame race by registering relay socket message/close/error handlers before awaiting the WebSocket `open` event.
- [x] (2026-06-23 00:57 +0800) Hardened the Go pairing and HTTP boundary after Go skills audit: pairing code hash comparison now uses `crypto/subtle.ConstantTimeCompare`, pairing codes use a non-confusing 32-character alphabet, and JSON request bodies are capped with `http.MaxBytesReader`.
- [x] (2026-06-23 01:00 +0800) Added an automated server-side relay Chat Runtime test: a fake relay accepts `/ws/controller`, unwraps relay envelopes, simulates the daemon `host/hello` and `agent/turn` methods, wraps responses back into relay envelopes, and proves a remote mock assistant message is persisted through the normal projection path.
- [x] (2026-06-23 01:00 +0800) Ran validation: `go vet ./...`, `go test ./...`, `go test -race ./...`, relay protocol typecheck/test, agentd typecheck/test, server remote-runtime-hosts test, and server typecheck all pass.
- [x] (2026-06-23 01:11 +0800) Ran a real local process smoke with `go run ./cmd/relayd` and `pnpm --filter @cradle/agentd exec tsx src/main.ts relay`. The first attempt exposed a relay heartbeat bug: successful ping/pong did not refresh connection activity, so an otherwise healthy host was closed after idle timeout.
- [x] (2026-06-23 01:12 +0800) Fixed relay heartbeat semantics by updating connection activity after successful `Ping`, added a regression test proving ping/pong keeps an idle-but-healthy WebSocket open, and serialized WebSocket data writes and pings with a per-connection write mutex.
- [x] (2026-06-23 01:14 +0800) Fixed `agentd` relay host handling for relay control envelopes so `relay_peer_closed` and `relay_error` are not treated as malformed daemon frames and sent back to relay as remote-agent errors.
- [x] (2026-06-23 01:16 +0800) Re-ran the live smoke after fixes. The controller claimed the displayed pairing code, connected to `/ws/controller`, sent `host/hello` through a relay envelope, and received a remote-agent `rpc.response` from the real `agentd` process through the Go relay.
- [x] (2026-06-23 01:16 +0800) Re-ran final validation: Go `gofmt`, `go mod tidy`, `go vet`, `go test`, `go test -race`, relay protocol typecheck/test, agentd typecheck/test, server remote-runtime-hosts test, and server typecheck all pass.
- [x] (2026-06-23 01:44 +0800) Reworked Cradle Server relay signing from env-only to Cradle-managed secret storage: when no explicit relay HMAC env override is set, Server now creates `system:remote-relay-hmac:v1` as an encrypted `agent_credentials` row and hides system-owned secrets from the public `/secrets` list.

## Surprises & Discoveries

- Observation: The current repository has TypeScript apps and packages but no Go module, no `go.work`, and no existing Go service layout.
  Evidence: Running `find . -maxdepth 3 -name 'go.mod' -o -name 'go.work' -o -name '*.go'` from `/Users/wibus/dev/Cradle` returned no files.

- Observation: The existing `apps/agentd` app already has a clean daemon dispatch boundary that can be reused by a relay client.
  Evidence: `apps/agentd/src/daemon.ts` exposes `AgentdDaemon.handleUnary()` and `AgentdDaemon.handleStream()` for remote-agent protocol methods, while `apps/agentd/src/server.ts` is only the Unix-socket WebSocket transport wrapper.

- Observation: The current daemon plan keeps server projection ownership local, which is exactly the right boundary for relay.
  Evidence: `docs/exec-plans/20260622-01-remote-agent-daemon.md` says `apps/server` owns local DB, sessions, messages, runs, queue, projections, SSH lifecycle, and daemon client; `apps/agentd` owns remote live agents, runtime processes, PTYs, and workspace discovery.

- Observation: The `ws` package type shape differs under this repository's TypeScript bundler resolution from the Node runtime shape needed by `apps/agentd`.
  Evidence: `apps/agentd/src/relay-client.ts` isolates the cast to a narrow local `RelayWebSocket` interface so the rest of the relay client can stay typed without importing browser-shaped WebSocket APIs.

- Observation: Waiting for WebSocket `open` before binding the agentd relay message handler can drop an immediate first envelope from a fast relay peer.
  Evidence: `pnpm --filter @cradle/agentd test` first timed out in `src/relay-client.test.ts`; after moving handler registration before awaiting `open`, the same command passed with 3 tests.

- Observation: Cradle Server needs the room id before it can mint the final controller WebSocket token, but the relay must still make pairing claim one-time.
  Evidence: `apps/relayd/internal/httpapi/server.go` treats `/pairing/claim` without `controllerToken` as a non-consuming discovery preflight and consumes the code only when a validated `controllerToken` is supplied.

- Observation: Applying the Go security and safety skills turned up two hardening fixes after the first implementation already passed tests.
  Evidence: `apps/relayd/internal/pairing/store.go` now compares pairing code hashes with `crypto/subtle.ConstantTimeCompare` and generates codes from an alphabet without `I`, `O`, `0`, or `1`; `apps/relayd/internal/httpapi/server.go` caps JSON bodies with `http.MaxBytesReader`.

- Observation: The relay server projection can be tested without starting a real Go relay process by making a fake relay speak the outer relay envelope and the existing fake daemon speak the inner remote-agent protocol.
  Evidence: `apps/server/tests/remote-runtime-hosts.test.ts` now includes `streams remote-mock output through relay transport projection`, and `pnpm --filter @cradle/server exec vitest run tests/remote-runtime-hosts.test.ts` passed with 8 tests.

- Observation: A live relay process exposed a heartbeat bug not covered by the first fake-relay tests.
  Evidence: The first real process smoke connected `agentd relay`, printed a pairing code, and successfully claimed the code, but the controller timed out waiting for `host/hello`. `relayd` logged that the host WebSocket closed with `heartbeat timeout` before the controller connected. The fix updates `lastSeenUnix` after successful `Ping`.

- Observation: Heartbeat pings and data envelope writes must be serialized per WebSocket connection.
  Evidence: A new Go regression test, `TestWebSocketHeartbeatKeepsIdleConnectionOpen`, initially failed with EOF while pings and forwarded data could overlap. Adding `connState.writeMu` around both `conn.Write` and `conn.Ping` made the test pass and `go test -race ./...` stayed clean.

- Observation: Relay control envelopes are not daemon frames and must not be fed into `packages/remote-agent-protocol`.
  Evidence: After the first successful smoke, closing the controller caused relay to send `relay_peer_closed` to agentd. Agentd parsed it as a daemon frame failure and wrote an invalid-frame response back to relay, producing a `peer not connected` relay log. `apps/agentd/src/relay-client.ts` now ignores non-`remote_agent_frame` envelopes on the host side.

## Decision Log

- Decision: Implement relay as a Go service under `apps/relayd`, not Rust and not a TypeScript server module.
  Rationale: The relay is network infrastructure: public WSS, pairing codes, token validation, connection routing, heartbeats, bounded queues, short TTL state, and JSON envelope forwarding. Go gives straightforward concurrency, simple deployment, mature standard library HTTP support, and enough performance without adding Rust async and ownership overhead to a product-protocol problem.
  Date/Author: 2026-06-23 / Codex

- Decision: Use a standalone Go module at `apps/relayd/go.mod` for the first version.
  Rationale: The repository has no Go modules today. A single module keeps the service buildable with ordinary `go test ./...` and `go run ./cmd/relayd` commands without forcing a repo-wide `go.work` before there is more than one Go module. The local toolchain is `go version go1.25.8 darwin/arm64`, so the first `go.mod` should use `go 1.25` and the implementation should use Go 1.25-standard-library idioms where they materially improve clarity or safety.
  Date/Author: 2026-06-23 / Codex

- Decision: Apply the available Go skills as implementation constraints, not only as broad design guidance.
  Rationale: The relay design should follow the Go skills that were read for this plan. That means explicit constructors instead of `init()`, context-first APIs, early returns for errors, wrapped lowercase errors, slog at process boundaries, no log-and-return duplication, no unbounded resources, no nil map writes, defensive copies for exported slice/map accessors, no unchecked type assertions, bounded numeric conversions, initialized empty slices/maps for JSON responses, `crypto/rand` for codes, constant-time comparison for secrets, and Go 1.25 testing/concurrency helpers such as `t.Context()` and `sync.WaitGroup.Go` where they fit.
  Date/Author: 2026-06-23 / Codex

- Decision: Use `net/http` with `http.ServeMux` first, and introduce `chi` only if route composition becomes awkward.
  Rationale: The first relay route surface is small: `/pairing/start`, `/pairing/claim`, `/ws/host`, `/ws/controller`, `/healthz`, `/readyz`, `/metrics`, and pprof when enabled. The standard library is sufficient and avoids one more dependency until the service proves it needs richer middleware.
  Date/Author: 2026-06-23 / Codex

- Decision: Use `github.com/coder/websocket` for WebSocket handling.
  Rationale: It is a maintained Go WebSocket library with context-aware read/write APIs and good ergonomics for service code. It fits the relay's need for cancellable connection loops, ping/pong deadlines, and explicit close handling.
  Date/Author: 2026-06-23 / Codex

- Decision: Make Cradle Server the controller for the first relay version, not the browser UI.
  Rationale: Cradle Server already owns user auth, host registry, chat sessions, and Chat Runtime projection. Keeping the controller connection server-side lets Cradle Server set normal Authorization headers, keep tokens out of browser logs, and preserve the existing UI-to-server streaming path. A direct browser controller can be a later mode if product needs it.
  Date/Author: 2026-06-23 / Codex

- Decision: Relay validates short-lived relay tokens minted by Cradle Server but does not call Cradle Server for every envelope.
  Rationale: The relay needs to be horizontally deployable and should not add a synchronous auth dependency to every forwarded message. Cradle Server signs short-lived tokens with role, room id, expiry, and nonce claims. Relay validates signature, audience, expiry, role, and room before accepting pairing or WebSocket upgrades.
  Date/Author: 2026-06-23 / Codex

- Decision: Keep first-version pairing and rooms in memory with TTL, behind sticky routing if multiple relay instances are deployed.
  Rationale: The first useful relay can be single-instance and operationally simple. Redis should be added when multi-instance pairing and room lookup are required. Even with Redis, open WebSockets still need either sticky sessions by room or a pub/sub forwarding layer; this plan does not pretend Redis alone makes active connections portable.
  Date/Author: 2026-06-23 / Codex

- Decision: Relay forwards only a generic relay envelope; existing remote-agent JSON-RPC frames remain the payload.
  Rationale: `packages/remote-agent-protocol` already owns daemon method names, stream frames, and validation. The Go relay should not understand `agent/turn`, `pty/open`, `workspace/list`, chat runs, provider threads, or `UIMessageChunk`. It only validates the outer relay envelope and forwards the payload bytes to the peer in the same room.
  Date/Author: 2026-06-23 / Codex

- Decision: Relay does not provide durable resume or message replay.
  Rationale: Resume belongs to the daemon/runtime attach path and Cradle Server's local projection. Relay may track last seen sequence and ack for observability and diagnostics, but it must not become a log system or source of truth for stream recovery. If a connection breaks during a turn, Chat Runtime should fail the active run with a transport error, and a later operation may attach/resume through daemon/runtime semantics.
  Date/Author: 2026-06-23 / Codex

- Decision: Use bounded per-connection queues and close slow peers instead of unbounded buffering.
  Rationale: Relay is public network infrastructure. A slow controller or host must not consume unbounded memory. Each connection has a fixed envelope count and byte budget; when the writer queue is full, relay records a slow-consumer metric, sends a close reason when possible, and closes the connection.
  Date/Author: 2026-06-23 / Codex

- Decision: Keep Cradle Server as the relay token issuer in the first implementation; relay validates tokens but does not mint user/session credentials.
  Rationale: Cradle Server owns user auth, host registry rows, and session projection. Letting relay mint durable credentials would blur ownership and force relay to understand Cradle users. Server-managed HMAC signing material is encrypted in Cradle DB for the bundled/local path, while explicit env overrides remain available for development or external relay deployments. The Go service accepts HMAC tokens now through a validator interface that can later be backed by Ed25519 verification or another server-issued token format.
  Date/Author: 2026-06-23 / Codex

- Decision: Make `/pairing/claim` support a non-consuming room discovery preflight when `controllerToken` is omitted, and consume the pairing only when a valid `controllerToken` is supplied.
  Rationale: Cradle Server needs the room id before it can mint a room-scoped controller WebSocket token. Consuming the code before that token exists creates a two-phase failure window. The preflight returns only room metadata; the second call validates and stores the controller token and marks the code claimed.
  Date/Author: 2026-06-23 / Codex

- Decision: Use `seq: 0` for relay-generated control envelopes such as `relay_peer_closed`.
  Rationale: Client and daemon request sequencing belongs to the endpoint roles. Relay-generated control messages are transport events, not daemon frames, so `seq: 0` keeps them in a separate namespace without forcing relay to allocate role-specific daemon sequence numbers.
  Date/Author: 2026-06-23 / Codex

- Decision: Register agentd relay message handlers before awaiting WebSocket `open`.
  Rationale: A relay or fake relay can send the first envelope immediately after accepting the WebSocket. Binding handlers only after `open` resolves can drop that frame in Node's event emitter path. The revised client constructs the connection, binds handlers, then awaits the open promise.
  Date/Author: 2026-06-23 / Codex

- Decision: Treat pairing codes as short-lived secrets for comparison and display.
  Rationale: Even though pairing codes expire quickly, they authorize connecting a host to a controller. The store now hashes codes with a process key and per-code salt, compares hashes in constant time, and generates display codes from a 32-character alphabet that avoids common transcription mistakes.
  Date/Author: 2026-06-23 / Codex

- Decision: A successful WebSocket ping/pong refreshes relay connection activity.
  Rationale: Idle timeout should close dead connections, not healthy connections with no data frames. The relay now treats a successful `Ping` call as proof of peer activity by updating `lastSeenUnix`, matching the plan's acceptance rule that active ping/pong traffic keeps a connection open.
  Date/Author: 2026-06-23 / Codex

- Decision: Serialize WebSocket data writes and heartbeat pings with a per-connection mutex.
  Rationale: The relay has one reader loop, one writer loop, and one heartbeat loop per connection. Data writes and pings both write to the WebSocket. Serializing them avoids write interleaving and satisfies the Go safety requirement to protect shared connection state accessed by multiple goroutines.
  Date/Author: 2026-06-23 / Codex

- Decision: Agentd relay host ignores relay control envelopes instead of converting them into daemon protocol errors.
  Rationale: `relay_peer_closed` and `relay_error` describe transport state. They are not `@cradle/remote-agent-protocol` frames and should not be sent back as `protocol/error` daemon notifications, especially when the peer has already disconnected.
  Date/Author: 2026-06-23 / Codex

## Outcomes & Retrospective

The first relay implementation is complete for development validation. `apps/relayd` is a standalone Go 1.25 service that owns pairing, short-lived room state, WSS host/controller routing, heartbeat, bounded outbound queues, envelope validation, metrics, and optional pprof. `packages/remote-relay-protocol` owns the TypeScript envelope contract and fixtures. `apps/agentd` can run as a relay host client, print the displayed pairing code, and reuse the same `AgentdDaemon` method dispatch as the Unix-socket transport. `apps/server/src/modules/remote-runtime-hosts` can mint relay tokens, claim a pairing, store relay transport config, connect as a relay controller, and drive a remote mock chat turn through the normal Chat Runtime projection path.

The strongest automated acceptance proof is `apps/server/tests/remote-runtime-hosts.test.ts`. It now includes both the original local fake-daemon chat projection test and a relay-specific fake WebSocket relay test. The relay test sends Cradle Server daemon requests inside relay envelopes, has the fake relay respond with remote-agent protocol frames inside relay envelopes, and verifies that the assistant message is persisted with `Remote mock response: Ping relay daemon`.

The live process smoke now proves the real Go relay and real agentd relay client work together across HTTP pairing, WebSocket host/controller routing, displayed pairing code claim, and a `host/hello` daemon round trip. The automated server test proves Cradle Server's relay transport and Chat Runtime projection. Remaining production work is outside this first implementation: TLS/load-balancer deployment, process supervision, UI for entering the pairing code, production key rotation, and multi-instance Redis/sticky-routing behavior.

## Context and Orientation

Cradle is a TypeScript monorepo rooted at `/Users/wibus/dev/Cradle`. The local Cradle Server app lives in `apps/server`. The remote daemon app lives in `apps/agentd`. Shared daemon wire protocol types live in `packages/remote-agent-protocol`. The daemon proof in `docs/exec-plans/20260622-01-remote-agent-daemon.md` added a local Unix-socket WebSocket server in `apps/agentd/src/server.ts` and server-side remote host code in `apps/server/src/modules/remote-runtime-hosts`.

In this plan, relay means a public internet-facing service that accepts WSS connections from two roles: a host and a controller. The host is `cradle-agentd` running on the remote machine. The controller is Cradle Server, which has authenticated the user and owns the local chat/session projection. A room is a short-lived relay routing namespace. First version rooms contain exactly one host connection and one controller connection. An envelope is the outer JSON object relay understands enough to route and apply limits. The payload inside the envelope is opaque JSON, normally an encoded `@cradle/remote-agent-protocol` frame.

Cradle Server owns user authentication, host registry rows, chat sessions, run rows, message persistence, UI projection, and relay token minting. The relay does not own users or Cradle DB state. The relay only validates that a token was minted by Cradle Server and has claims that permit the requested role and room. `apps/agentd` owns remote runtime processes, remote workspace discovery, remote credentials, daemon PTYs, and native provider sessions. If SSH is available, the existing SSH/Unix-socket transport remains valid; relay is an additional transport.

The repository guidance in `AGENTS.md` emphasizes ownership and namespace. Applying that here: `apps/relayd` owns relay transport state and observability; `apps/server/src/modules/remote-runtime-hosts` owns server-side remote host configuration and relay token minting; `apps/agentd` owns host-side relay connection behavior; `packages/remote-agent-protocol` owns daemon RPC payloads; a new shared relay envelope package owns TypeScript envelope types and fixtures used by Go tests.

## Plan of Work

First add the Go relay service. Create `apps/relayd` with its own `go.mod`, `cmd/relayd/main.go`, and internal packages. The command reads configuration from flags and environment variables, constructs a service with explicit dependencies, starts an HTTP server with timeouts, and shuts down through `context.Context` on SIGINT or SIGTERM. Use `net/http` for routes, `github.com/coder/websocket` for WebSocket upgrades, `log/slog` for structured logs, and the Go testing package for unit tests. Keep global mutable state out of package scope except constants and compiled configuration defaults. Use Go 1.25 as the baseline: tests should use `t.Context()` where a test-scoped context is needed, goroutine groups may use `sync.WaitGroup.Go` when a plain wait group is sufficient, and code should avoid experimental `encoding/json/v2` unless the project explicitly opts into that experiment.

Second define relay token validation and pairing. Cradle Server mints short-lived relay tokens and pairing-start tokens. The first implementation can use HMAC-SHA256 with a shared secret loaded from environment for local development, but the interfaces must allow Ed25519 public-key verification later. Tokens contain at least issuer, audience, subject, role, room id when applicable, expiry, issued-at, token id, and a nonce. Relay validates tokens at `/pairing/start`, `/pairing/claim`, `/ws/host`, and `/ws/controller`. Pairing codes are generated with `crypto/rand`, stored only as hashes in memory, expire quickly, and are rate-limited by remote address and token subject.

Third define the pairing flow. Host-side `agentd` receives a user-provided pairing start token or relay bootstrap token from Cradle Server. It calls `POST /pairing/start`, receives a human-enterable code, a room id, and a short-lived host WebSocket token. Cradle Server receives the code from the user and calls `POST /pairing/claim` with its own server-authenticated token. Relay validates the code, marks it claimed, and returns a controller WebSocket token plus the room id. Host then connects to `/ws/host`, controller connects to `/ws/controller`, and relay starts routing envelopes between them. The code expires whether or not both sockets connect; established sockets are governed by their own token expiry and heartbeat timeouts.

Fourth add the relay envelope contract. Create a small TypeScript package or source area such as `packages/remote-relay-protocol` with zod schemas for the outer envelope and JSON fixtures in a `fixtures/` directory. The Go service mirrors the same envelope struct and has tests that load those JSON fixtures. This avoids relying on prose-only protocol sync between Go and TypeScript. The envelope starts as:

    {
      "version": 1,
      "roomId": "room_x",
      "seq": 42,
      "ack": 41,
      "kind": "remote_agent_frame",
      "streamId": "optional_stream_id",
      "payload": {}
    }

The relay validates `version`, `roomId`, `seq`, optional `ack`, `kind`, optional `streamId`, and total encoded byte size. The relay does not inspect `payload` beyond JSON size limits. For normal daemon traffic, `payload` is a remote-agent protocol frame from `packages/remote-agent-protocol`.

Fifth implement room and routing state. Add an in-memory store with TTL for pairing records and active rooms. The room object tracks room id, host connection, controller connection, expiry, last activity, last sequence per role, last ack per role, byte counters, and close reason. The first version rejects a second live host or controller for the same room unless the existing connection is already closed or heartbeat-expired. Add explicit room cleanup on timer and on connection close.

Sixth implement WebSocket connection loops. Each accepted connection gets a parent context, a reader goroutine, a writer goroutine, and a bounded outbound queue. The reader sets a maximum frame size, decodes one envelope at a time, validates the room and role, updates activity and sequence diagnostics, and enqueues the envelope to the peer's outbound queue. The writer serializes envelopes with a write deadline and exits on context cancellation. Heartbeats use WebSocket ping/pong plus optional relay control envelopes. If the peer is absent, relay can either queue a very small number of envelopes until the peer arrives or reject data frames with a `peer_not_connected` close/error. The first version should prefer fail-fast for data frames after a short grace period so relay does not become a buffer.

Seventh add backpressure and limits. Define defaults in configuration: max frame bytes, max queued envelopes, max queued bytes, pairing TTL, room TTL, idle timeout, write timeout, read timeout, heartbeat interval, and max rooms. When a queue is full or byte budget is exceeded, close the slow consumer side and notify the peer with a relay error envelope if possible. Record Prometheus counters for slow consumer closes, frame validation failures, auth failures, room created/closed, and forwarded envelopes. Never log full payloads.

Eighth integrate Cradle Server. Add relay transport fields to the remote host registry shape in `apps/server/src/modules/remote-runtime-hosts`, or add a closely named submodule such as `relay-transport.ts` under that module. The server module mints pairing-start and controller tokens, calls relay `/pairing/claim`, opens the controller WebSocket, and exposes the same typed daemon client interface currently used by SSH transport. This keeps Chat Runtime provider code independent of whether the daemon path is SSH or relay. Server routes should let a user create a relay pairing, claim a code, view connection status, and disconnect.

Ninth integrate `apps/agentd`. Add an outbound relay client mode, for example `cradle-agentd relay --relay-url wss://... --pairing-token ...`. This mode reuses `AgentdDaemon` dispatch from `apps/agentd/src/daemon.ts` instead of duplicating daemon logic. It connects as host, unwraps relay envelopes, parses the inner remote-agent protocol frame with `packages/remote-agent-protocol`, calls `handleUnary()` or `handleStream()`, and wraps responses/stream events back into relay envelopes. The existing Unix-socket server mode remains available for SSH and local smoke tests.

Tenth validate end to end. Start `apps/relayd` locally, start `apps/agentd` in relay mode, claim the pairing from Cradle Server or a focused test harness, and run the existing remote mock chat runtime through the normal `/chat/sessions/:sessionId/response` flow. The acceptance proof is not merely that sockets connect; it must show a user message goes through Cradle Server, through relay envelopes, into `AgentdDaemon.handleStream('agent/turn')`, and back into persisted Cradle assistant messages.

## Concrete Steps

1. Check the worktree from the repository root:

        cd /Users/wibus/dev/Cradle
        git status --short

   There may be unrelated local changes. Do not revert them. Keep relay edits scoped to new `apps/relayd`, a new relay envelope contract area, `apps/agentd` relay client code, and server relay transport integration.

2. Create `apps/relayd/go.mod`:

        module github.com/cradle/relayd

        go 1.25

        require github.com/coder/websocket v1.8.14

   The current development machine reports `go version go1.25.8 darwin/arm64`. If another machine has an older Go toolchain, upgrade that toolchain instead of lowering the module directive without a Decision Log entry.

3. Create the Go service layout:

        apps/relayd/cmd/relayd/main.go
        apps/relayd/internal/config/config.go
        apps/relayd/internal/httpapi/server.go
        apps/relayd/internal/pairing/store.go
        apps/relayd/internal/relay/envelope.go
        apps/relayd/internal/relay/hub.go
        apps/relayd/internal/relay/connection.go
        apps/relayd/internal/token/validator.go
        apps/relayd/internal/metrics/metrics.go

   Keep packages small. `httpapi` owns route wiring, `pairing` owns pairing TTL records, `relay` owns room routing and WebSocket loops, `token` owns token validation, and `metrics` owns Prometheus registration.

4. Implement configuration with flags and environment variables. Required settings are listen address, public relay URL, token issuer, token audience, token verification secret or public key path, pairing TTL, room TTL, max frame bytes, max queued envelopes, max queued bytes, heartbeat interval, read timeout, write timeout, idle timeout, metrics enabled, and pprof enabled. Validate settings at startup and return errors with lowercase messages and useful context.

5. Implement `/healthz` and `/readyz`. `/healthz` returns HTTP 200 and body `ok` when the process is alive. `/readyz` returns HTTP 200 only after configuration is valid and the pairing/room store is initialized. These endpoints must not require relay auth.

6. Implement token validation behind an interface:

        type Validator interface {
            Validate(ctx context.Context, raw string, expected ExpectedClaims) (Claims, error)
        }

   `ExpectedClaims` includes audience, role, optional room id, and optional pairing purpose. `Claims` includes subject, role, room id, expiry, issued-at, token id, and nonce. For HMAC development tokens, compare MACs in constant time using `crypto/subtle`. Do not log raw tokens.

7. Implement pairing store with in-memory TTL. Generate pairing codes with `crypto/rand`, encode them in an alphabet that avoids confusing characters, and store only a hash of the code. The store supports create, claim, consume, expire, and lookup by room id for diagnostics. Claims must be one-time. Expired pairings must not be claimable.

8. Implement `POST /pairing/start`. It accepts a bearer token from agentd with purpose `pairing_start`. On success it creates a room, stores a pairing code hash, and returns:

        {
          "roomId": "room_...",
          "pairingCode": "ABCD-1234",
          "hostToken": "short-lived-token-or-relay-issued-token",
          "expiresAt": "2026-06-23T00:05:00Z"
        }

   If relay does not mint tokens itself in the first version, return a nonce that Cradle Server can exchange for a host token. Be explicit in code and tests about which service is the token issuer. The preferred first version is that Cradle Server mints role tokens and relay only validates them.

9. Implement `POST /pairing/claim`. It accepts a Cradle Server bearer token with purpose `pairing_claim` and a JSON body containing `pairingCode`. On success it marks the pairing claimed and returns `roomId` plus a controller WebSocket token or token nonce, depending on the final token issuance choice. Wrong, expired, or already claimed codes return generic errors that do not reveal which property was wrong.

10. Implement relay envelope parsing in Go. Define:

        type Envelope struct {
            Version  int             `json:"version"`
            RoomID   string          `json:"roomId"`
            Seq      uint64          `json:"seq"`
            Ack      *uint64         `json:"ack,omitempty"`
            Kind     string          `json:"kind"`
            StreamID string          `json:"streamId,omitempty"`
            Payload  json.RawMessage `json:"payload"`
        }

   Validate `Version == 1`, non-empty room id, monotonic sequence per connection where practical, known `Kind`, and encoded size. Use `json.Decoder.DisallowUnknownFields()` for control request bodies, but allow envelope payload to remain opaque.

11. Add TypeScript relay envelope schemas and fixtures. Create `packages/remote-relay-protocol/package.json`, `packages/remote-relay-protocol/src/index.ts`, and fixtures under `packages/remote-relay-protocol/fixtures`. The fixtures include valid host data envelope, valid controller data envelope, missing room id, invalid version, and oversized payload metadata if practical. Go tests load the valid fixtures by relative path or copy equivalent fixtures under `apps/relayd/testdata`.

12. Implement `/ws/host` and `/ws/controller`. Both endpoints validate bearer tokens, verify role, verify room id, upgrade to WebSocket, register the connection, and start reader/writer loops. Use `context.Context` to stop all goroutines for a connection when any loop exits. `context.Context` is always the first parameter for APIs that can block or perform I/O. For reader/writer goroutines, use `sync.WaitGroup.Go` when the function only needs wait-group lifecycle and context cancellation; if error collection is needed, use a small explicit error channel or `errgroup` only after deciding the dependency is worth it. Reject duplicate live roles with an explicit close reason. On close, mark the role disconnected and notify the peer if present.

13. Implement room routing. A host envelope is forwarded only to the controller in the same room. A controller envelope is forwarded only to the host in the same room. Relay must reject envelopes whose `roomId` does not match the authenticated connection room. Relay must not forward between rooms and must not broadcast.

14. Implement heartbeat and idle timeout. Send WebSocket pings on a configured interval. If pong or any valid data frame is not observed within idle timeout, close the connection. Record heartbeat timeout metrics. If a peer closes, the other side receives a relay control envelope such as:

        {
          "version": 1,
          "roomId": "room_x",
          "seq": 0,
          "kind": "relay_peer_closed",
          "payload": { "role": "host", "reason": "heartbeat_timeout" }
        }

   The sequence for relay-generated control envelopes can use a separate relay sequence namespace or `seq: 0`; document the final choice in `packages/remote-relay-protocol`.

15. Implement backpressure. Each connection has an outbound queue with both envelope count and byte budget. When enqueue fails because the queue is full, close the slow side with a close code and notify the other side if possible. Add tests where one peer stops reading and the relay closes it rather than growing memory.

16. Add metrics and pprof. Expose `/metrics` for Prometheus when enabled. Metrics include active rooms, active host sockets, active controller sockets, pairing starts, pairing claims, auth failures, forwarded envelopes, forwarded bytes, validation failures, slow consumer closes, heartbeat closes, and room expirations. Expose `net/http/pprof` only when explicitly enabled, and document that production deployments should protect it behind internal routing or disable it.

17. Add Go tests. Unit tests cover token validation, pairing TTL and one-time claim, room duplicate role rejection, room routing, room mismatch rejection, malformed envelope rejection, heartbeat or idle close, and slow consumer close. Integration tests can use `httptest.Server` with WebSocket clients from `github.com/coder/websocket`. Use `t.Context()` for test contexts, table tests with initialized slices/maps, and assertions that check returned errors instead of panics. Run race tests because room maps and connection maps are shared across goroutines.

18. Add TypeScript server token minting. Under `apps/server/src/modules/remote-runtime-hosts`, add a relay token service that can mint short-lived tokens for pairing start, pairing claim, host role, and controller role. It should prefer an explicit relay HMAC environment override for development or external deployments, but the normal Cradle path must use an encrypted, server-owned signing secret in Cradle DB so users do not manage relay signing material. The token shape and expiry must match relay validation. Production key rotation can be a later milestone, but the interface should not bake in only HMAC.

19. Add server relay transport. Extend the remote runtime host connection config with a transport discriminator such as `{ type: 'relay', relayUrl, roomId?, pairedAt? }` alongside existing SSH/local socket config. Implement a daemon client transport that sends and receives existing `@cradle/remote-agent-protocol` frames by wrapping them in relay envelopes. Its public interface should match the existing daemon client: unary call, stream call, close, and connection status.

20. Add agentd relay mode. Introduce a command or flag path in `apps/agentd/src/main.ts` for relay connection. Reuse `AgentdDaemon` for method dispatch. The relay client unwraps envelope payloads, parses remote-agent protocol frames, dispatches through `handleUnary()` or `handleStream()`, wraps responses as relay envelopes, and preserves stream ids from the inner remote-agent protocol where needed. It must not import `apps/server`.

21. Add focused server tests. Use a local relay test server or a fake relay transport to prove the server can claim a pairing, connect as controller, send a daemon `host/hello`, list runtimes, start a mock remote agent, and run a mock `agent/turn` through the normal Chat Runtime response path. The test should assert a `remote_runtime_session_links` row still owns remote host identity and the assistant message contains text derived from the user input.

22. Run validation from the repository root:

        cd /Users/wibus/dev/Cradle
        cd apps/relayd
        gofmt -w .
        go mod tidy
        go vet ./...
        go test ./...
        go test -race ./...
        cd ../..
        pnpm --filter @cradle/remote-relay-protocol exec tsc --noEmit --pretty false
        pnpm --filter @cradle/remote-relay-protocol test
        pnpm --filter @cradle/agentd exec tsc --noEmit --pretty false
        pnpm --filter @cradle/agentd test
        pnpm --filter @cradle/server exec vitest run tests/remote-runtime-hosts.test.ts
        pnpm --filter @cradle/server exec tsc --noEmit --pretty false

   The Go commands are run from `apps/relayd` because the first version is a standalone Go module. If a later plan adds a root `go.work`, update this section with the new root-level commands. As of 2026-06-23 01:00 +0800, the expected test counts are: relay protocol 4 tests passed, agentd 3 tests passed, and server `remote-runtime-hosts.test.ts` 8 tests passed.

23. Perform a manual smoke. Start relay locally:

        cd /Users/wibus/dev/Cradle/apps/relayd
        go run ./cmd/relayd --listen 127.0.0.1:8787

   Start agentd in relay mode from another terminal with a development pairing token. Claim the displayed pairing code through a Cradle Server route or a small test CLI. Expected observation: relay logs one room with host and controller connected, the controller receives `host/hello`, and the automated Cradle Server relay transport test proves a remote mock chat turn persists an assistant message through the normal Chat Runtime flow. As of 2026-06-23 01:16 +0800, this live relay/agentd smoke has passed with a small controller CLI, and the server projection is covered by `apps/server/tests/remote-runtime-hosts.test.ts`.

## Validation and Acceptance

The relay service is acceptable when it can be started independently with `go run ./cmd/relayd` without local secret configuration, answers `/healthz` with HTTP 200 body `ok`, exposes `/readyz`, and shuts down cleanly on SIGINT or SIGTERM without leaking goroutines in tests.

The Go implementation is acceptable when it follows the Go skills constraints used for this plan: `gofmt` produces no diff, `go vet ./...` passes, `go test -race ./...` passes, every returned error is checked or intentionally handled, errors are wrapped with context and lowercase messages, expected failures return errors rather than panics, maps and slices exposed in JSON responses are initialized rather than nil, exported accessors return defensive copies for mutable slices/maps, and slow or external operations are bounded by context deadlines or explicit timeouts.

Pairing is acceptable when `POST /pairing/start` creates a short-lived code from a valid token, `POST /pairing/claim` claims it exactly once from a valid Cradle Server token, expired codes fail, repeated claims fail, and wrong codes return generic failures. Pairing records must expire automatically and must store only code hashes, not plaintext codes.

WebSocket routing is acceptable when a host connected to room A can send an envelope only to the controller in room A, a controller connected to room A can send only to that host, room mismatch envelopes are rejected, duplicate live host/controller connections are rejected, and relay never broadcasts across rooms.

Backpressure is acceptable when a slow peer with a full outbound queue is closed and metrics record the close. Memory use must not grow without bound when one side writes faster than the other side reads. Tests should simulate an unread peer or a deliberately tiny queue.

Heartbeat is acceptable when idle connections close after the configured timeout and active connections remain open while pings/pongs or valid data frames continue. Peer disconnect must surface to the other side as a relay-level close/control event, not as a fabricated daemon `agent/turn` error.

Security is acceptable when relay validates all tokens, token comparisons are constant-time where applicable, pair codes are generated with `crypto/rand`, tokens and payloads are redacted from logs, frame size limits are enforced before forwarding, and pprof is disabled unless explicitly enabled.

Cradle integration is acceptable when relay is an alternate transport under `remote-runtime-hosts`, not a provider target namespace. Creating or pairing a relay host must not write `providerTargets`. Chat Runtime provider code should call the same daemon client abstraction whether the host uses SSH/local socket or relay.

End-to-end acceptance is a mock remote chat turn through relay. A user message sent through the existing Chat Runtime response path is wrapped by Cradle Server into a remote-agent protocol frame, wrapped into a relay envelope, forwarded by relay to agentd, handled by `AgentdDaemon.handleStream('agent/turn')`, returned through relay, and persisted as an assistant message visible through existing chat hydration. Relay itself must not persist the transcript.

## Idempotence and Recovery

Creating `apps/relayd` is additive. Re-running `go mod tidy`, `go test`, and TypeScript typechecks is safe. If Go dependency versions change, commit the resulting `go.mod` and `go.sum` updates together with the relay code.

Pairing start and claim are safe to retry only with new codes. A claimed or expired code stays unusable. Retrying after a failed claim with the same wrong code must not reveal whether the code ever existed.

Relay room state is short-lived. If `relayd` restarts, all pairings and active rooms are gone. Host and controller clients must reconnect and pair again, or Cradle Server must initiate a new relay connection. Relay restart must not delete Cradle host registry rows, chat sessions, messages, or daemon runtime state.

If a WebSocket closes during an active remote-agent stream, relay rejects pending writes and notifies the peer if possible. Cradle Server should treat that as a transport failure for the active run. It should not replay buffered envelopes because relay does not own durable message logs.

If the first deployment needs more than one relay instance, use sticky sessions by room id at the load balancer or defer multi-instance until Redis and pub/sub routing are added. Redis can store pairing records and room leases, but open WebSocket forwarding still needs sticky routing or a cross-instance forwarding design.

If direct browser-to-relay control is required later, add a separate design pass. The first version keeps controller connections in Cradle Server so user auth, tokens, and chat projection stay server-owned.

## Artifacts and Notes

Validation evidence from 2026-06-23 01:16 +0800:

        cd /Users/wibus/dev/Cradle/apps/relayd
        gofmt -w .
        go mod tidy
        go vet ./...
        go test ./...
        go test -race ./...

   Result: `go vet` exited 0; `go test` and `go test -race` passed for `internal/httpapi`, `internal/pairing`, `internal/relay`, and `internal/token`. `internal/httpapi` includes `TestWebSocketHeartbeatKeepsIdleConnectionOpen`, which proves ping/pong activity keeps an otherwise idle connection open and that pings/data writes are serialized safely.

        cd /Users/wibus/dev/Cradle
        pnpm --filter @cradle/remote-relay-protocol exec tsc --noEmit --pretty false
        pnpm --filter @cradle/remote-relay-protocol test
        pnpm --filter @cradle/agentd exec tsc --noEmit --pretty false
        pnpm --filter @cradle/agentd test
        pnpm --filter @cradle/server exec vitest run tests/remote-runtime-hosts.test.ts
        pnpm --filter @cradle/server exec tsc --noEmit --pretty false

   Result: relay protocol tests passed with 4 tests, agentd tests passed with 3 tests, server remote-runtime-hosts tests passed with 8 tests, and both server and package typechecks exited 0. The server test command prints plugin activation logs during app startup; those logs are expected and do not indicate a relay failure.

Live relay/agentd smoke evidence from 2026-06-23 01:16 +0800:

        go run ./cmd/relayd --listen 127.0.0.1:18789 --public-url http://127.0.0.1:18789 --dev-hmac-secret relay-smoke-secret --heartbeat-interval 1s --idle-timeout 5s
        pnpm --filter @cradle/agentd exec tsx src/main.ts relay --relay-url http://127.0.0.1:18789 --room-id room_smoke_... --pairing-token ... --host-token ...

   The controller CLI used the printed pairing code to call `/pairing/claim`, connected to `/ws/controller`, sent a relay envelope containing a remote-agent `host/hello` request, and received:

        claim 200 {"roomId":"room_smoke_e36e5b6d-6f90-4b90-880a-bc98a5cf4fd3", ...}
        host hello daemonVersion=0.1.0 protocolVersion=1 methods=14

   Agentd printed:

        [agentd] relay pairing code Z2GX-3XQ6 expires at 2026-06-23T01:20:18.106847+08:00
        [agentd] relay host connected for room room_smoke_e36e5b6d-6f90-4b90-880a-bc98a5cf4fd3

   Relay printed startup and a normal controller close after the controller CLI finished. It did not close the host for heartbeat timeout and did not log a host-side `peer not connected` error after the agentd relay control-envelope fix.

The intended ownership after this plan is:

        apps/server
          owns user auth, host registry, relay token minting, Chat Runtime projection
          connects to relay as controller
          wraps existing remote-agent protocol frames into relay envelopes

        apps/agentd
          owns remote runtime processes, workspaces, credentials, PTYs
          connects to relay as host when SSH is unavailable
          reuses AgentdDaemon dispatch for relay and Unix-socket transports

        apps/relayd
          owns public WSS upgrades, pairing codes, short TTL rooms, heartbeats
          forwards versioned relay envelopes between host and controller
          does not know users, chat sessions, runs, workspaces, providers, or agent logs

        packages/remote-agent-protocol
          owns daemon JSON-RPC method frames such as host/hello and agent/turn
          remains opaque payload to relay

        packages/remote-relay-protocol
          owns outer relay envelope schemas and JSON fixtures for TS and Go tests

The intended runtime flow is:

        User creates relay pairing in Cradle UI
        Cradle Server authenticates the user and mints a pairing-start token
        User starts cradle-agentd relay mode on the remote host with that token
        agentd calls relay /pairing/start and shows a short code
        User enters the code in Cradle
        Cradle Server calls relay /pairing/claim and receives controller room credentials
        agentd connects to /ws/host
        Cradle Server connects to /ws/controller
        Cradle Server sends remote-agent protocol frames inside relay envelopes
        relay forwards envelopes without inspecting payload semantics
        agentd dispatches frames to AgentdDaemon
        responses stream back through relay
        Cradle Server persists messages and run state locally

The first deployment can be single instance:

        internet clients
          -> TLS/load balancer
          -> apps/relayd Go process with in-memory rooms

For multi-instance later:

        internet clients
          -> TLS/load balancer with sticky routing by room id
          -> apps/relayd instances
          -> Redis for pairing records and short TTL room leases

Redis is not required for the first version. Adding Redis before single-instance semantics are proven would add operational weight without solving the harder active-WebSocket routing question.

## Interfaces and Dependencies

The Go service lives in `apps/relayd` and depends on:

        github.com/coder/websocket
        net/http
        context
        crypto/rand
        crypto/hmac or crypto/ed25519 depending on token mode
        crypto/subtle
        encoding/json
        log/slog
        runtime/pprof through net/http/pprof when enabled

If Prometheus is implemented with the standard Prometheus client, add:

        github.com/prometheus/client_golang/prometheus
        github.com/prometheus/client_golang/prometheus/promhttp

Core Go interfaces:

        type TokenValidator interface {
            Validate(ctx context.Context, raw string, expected token.ExpectedClaims) (token.Claims, error)
        }

        type PairingStore interface {
            Start(ctx context.Context, input pairing.StartInput) (pairing.Record, error)
            FindPending(ctx context.Context, code string) (pairing.Record, error)
            Claim(ctx context.Context, input pairing.ClaimInput) (pairing.Record, error)
            Expire(ctx context.Context, now time.Time) int
        }

        type Hub interface {
            CreateRoom(ctx context.Context, roomID string, expiresAt time.Time) error
            HandleConnection(ctx context.Context, role token.Role, claims token.Claims, conn *websocket.Conn) error
            CloseRoom(ctx context.Context, roomID string, reason string) error
        }

        type Envelope struct {
            Version  int             `json:"version"`
            RoomID   string          `json:"roomId"`
            Seq      uint64          `json:"seq"`
            Ack      *uint64         `json:"ack,omitempty"`
            Kind     string          `json:"kind"`
            StreamID string          `json:"streamId,omitempty"`
            Payload  json.RawMessage `json:"payload"`
        }

TypeScript additions:

        packages/remote-relay-protocol/src/index.ts
          exports REMOTE_RELAY_PROTOCOL_VERSION, relayEnvelopeSchema, RelayEnvelope,
          RelayEnvelopeKind, RelayRole, parseRelayEnvelope, encodeRelayEnvelope,
          relayPeerClosedPayloadSchema, and relayErrorPayloadSchema

        apps/server/src/modules/remote-runtime-hosts/relay-token-service.ts
          exports createRelayRoomId() and mintRelayToken(input)

        apps/server/src/modules/remote-runtime-hosts/relay-transport.ts
          exports createRelayRemoteAgentDaemonClient(options), implementing daemon
          client transport over relay envelopes

        apps/agentd/src/relay-client.ts
          exports startAgentdRelayClient(options), connects to relay as host, and
          dispatches payload frames through AgentdDaemon

Revision note 2026-06-23: Initial relay plan created after deciding that public WSS pairing should be a separate Go network service rather than part of the TypeScript daemon proof.

Revision note 2026-06-23: Updated after Go skills review and local toolchain confirmation (`go version go1.25.8 darwin/arm64`); changed the planned module directive to `go 1.25` and added explicit Go style, safety, modernization, vet, gofmt, and race-test requirements.

Revision note 2026-06-23: Updated after implementation. Recorded the completed Go relay service, shared relay protocol package, agentd relay host client, Cradle Server relay controller/token path, automated fake-relay Chat Runtime acceptance test, Go skills hardening changes, and validation results.

Revision note 2026-06-23: Updated after live process smoke. Recorded and fixed the heartbeat activity bug, serialized WebSocket writes/pings, made agentd ignore relay control envelopes, added a heartbeat regression test, recorded the successful live relayd plus agentd relay `host/hello` smoke, and refreshed final validation evidence.
