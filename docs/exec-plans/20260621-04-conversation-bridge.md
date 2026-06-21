# Integrate Conversation Bridge Core and Slack Adapter

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The plan is self-contained so a contributor can resume from this file without prior conversation history.

## Purpose / Big Picture

After this change, Cradle Server owns a generic conversation bridge for connecting external chat channels to Cradle sessions. The first supported platform is Slack, but Slack is implemented as a plugin adapter rather than as a standalone app. A Slack channel can be bound to a Cradle workspace and default runtime; a Slack thread can create or continue one Cradle session; assistant responses are delivered back to the same Slack thread. Platform credentials are stored in the existing Cradle secrets module, and bridge tables store only secret references.

The visible outcome is that `apps/slack-channel-bridge` is no longer the architectural owner of this behavior. The server has a `conversation-bridge` module, the plugin SDK exposes a conversation adapter registration point, and a bundled Slack adapter can register that capability and hand normalized events to the server-owned bridge core.

## Progress

- [x] (2026-06-21 06:11Z) Read ExecPlan and server module rules; confirmed this is complex enough to require a new ExecPlan.
- [x] (2026-06-21 06:11Z) Chose `docs/exec-plans/20260621-04-conversation-bridge.md` as the next plan filename for the day.
- [x] (2026-06-21 06:36Z) Added Cradle DB schema and migration for server-owned bridge persistence in `packages/db/src/schema/conversation-bridge.ts` and `packages/db/drizzle/0009_conversation_bridge.sql`.
- [x] (2026-06-21 06:36Z) Extended `@cradle/plugin-sdk` and server plugin context with `conversation.adapters.register(...)`, backed by `apps/server/src/plugins/conversation-adapter-registry.ts`.
- [x] (2026-06-21 06:36Z) Implemented `apps/server/src/modules/conversation-bridge` with service, model, HTTP routes, README, runtime supervisor, and focused service tests.
- [x] (2026-06-21 06:36Z) Added bundled Slack adapter plugin at `plugins/slack-conversation-bridge`, including Socket Mode adapter runtime, Slack event normalization, Slack Block Kit delivery formatting, fake-client unit tests, and built `dist/server.mjs`.
- [x] (2026-06-21 06:36Z) Wired the module into `apps/server/src/app.ts` and plugin startup/shutdown paths, including bridge runtime stop before plugin deactivation/reset and enabled-connection startup during server background task startup.
- [x] (2026-06-21 06:36Z) Ran focused verification: plugin SDK typecheck, server typecheck, Slack plugin typecheck/test/build, and focused server Vitest coverage for bridge service and plugin context.

## Surprises & Discoveries

- Observation: The current `apps/slack-channel-bridge` schema stores Slack-specific names such as `teamId`, `channelId`, `threadTs`, and `slackTs`. The integrated design must not copy those names into Cradle-owned generic tables.
  Evidence: `apps/slack-channel-bridge/src/db/schema.ts` defines `workspace_bindings`, `thread_bindings`, `inbound_events`, and `delivery_attempts` with Slack-specific columns.
- Observation: Cradle already has a secrets module backed by `agentCredentials`; it exposes `readSecret(id)` and requires `CRADLE_CREDENTIAL_SECRET`.
  Evidence: `apps/server/src/modules/secrets/service.ts` decrypts secrets by id and returns plaintext only through server code.
- Observation: The partial implementation already had schema, SDK types, and some service logic, but it lacked `index.ts`, `runtime-supervisor.ts`, README, app mounting, and bundled Slack plugin files.
  Evidence: Before implementation, `find apps/server/src/modules/conversation-bridge -maxdepth 3 -type f` returned only `model.ts` and `service.ts`.
- Observation: `@slack/bolt`'s `App.start()` returns a Node server object, while the bridge adapter runtime contract expects `Promise<void>`.
  Evidence: `pnpm --filter @cradle/slack-conversation-bridge typecheck` initially failed with `TS2352 ... Type 'Promise<Server<...>>' is not comparable to type 'Promise<void>'`; the final adapter wraps Bolt rather than casting it directly.
- Observation: Running the Drizzle generator after hand-writing `0009_conversation_bridge.sql` produced a duplicate `0010_unique_ikaris.sql` because the matching snapshot was missing.
  Evidence: The duplicate SQL recreated only conversation bridge tables. The generated snapshot was retained as `packages/db/drizzle/meta/0009_snapshot.json`, the duplicate SQL and journal entry were removed, and `pnpm --filter @cradle/db generate` then reported `No schema changes, nothing to migrate`.

## Decision Log

- Decision: The bridge core is an internal server module named `conversation-bridge`; Slack is the first adapter and registers through plugin SDK.
  Rationale: Cradle should own session binding, persistence, retries, and API semantics, while the platform adapter should own platform protocol details such as WebSocket/socket-mode handling.
  Date/Author: 2026-06-21 / Codex, based on user direction.
- Decision: Scope excludes `apps/zhi-slack-bridge` and Chronicle Slack ingestion.
  Rationale: Channel/thread to session bridging and human elicitation are different workflows; Chronicle already has Slack source behavior that should not be entangled with this feature.
  Date/Author: 2026-06-21 / Codex, based on user direction.
- Decision: Adapter live WebSocket connections live in adapter/plugin runtime, while server core supervises when a connection should be started or stopped.
  Rationale: Slack and Discord connection protocols differ; SQL should store durable facts and health projections, not live socket state machines.
  Date/Author: 2026-06-21 / Codex, based on user direction.
- Decision: Bridge connection rows store secret refs only; plaintext secrets are read by the server core and passed to adapter runtime at start time.
  Rationale: This follows the existing Cradle secrets ownership boundary and avoids storing platform tokens in bridge-owned tables.
  Date/Author: 2026-06-21 / Codex, based on user direction.
- Decision: Conversation bridge HTTP routes do not expose `x-cradle-cli` metadata in this milestone.
  Rationale: The management surface includes live connection start/stop operations and secret-backed platform runtime behavior; the API should stabilize before it is projected as Agent-facing shell commands.
  Date/Author: 2026-06-21 / Codex.
- Decision: The Slack adapter plugin implements Socket Mode event normalization and message delivery, but channel binding and runtime default selection are managed through server conversation-bridge APIs rather than Slack slash commands in this milestone.
  Rationale: This keeps Slack as a plugin-owned protocol adapter and leaves Cradle-owned binding/session semantics in the server namespace. The old slash command UX can be rebuilt later as adapter-provided interactive controls without reintroducing Slack-owned persistence.
  Date/Author: 2026-06-21 / Codex.
- Decision: The runtime supervisor stops active bridge connections before plugin deactivation or registry reset, and server shutdown stops all bridge runtimes before deactivating plugins.
  Rationale: Adapter runtime objects hold live platform handles such as Slack Socket Mode clients; those handles must be closed before the adapter registration disappears.
  Date/Author: 2026-06-21 / Codex.

## Outcomes & Retrospective

The full implementation milestone is complete. Cradle Server now owns generic conversation bridge persistence, management routes, runtime supervision, inbound event idempotency, session/thread binding, chat-runtime forwarding, delivery attempts, and retry handling. The plugin SDK exposes a conversation adapter registry, and the bundled Slack plugin registers a Slack adapter that owns Slack Socket Mode, event normalization, mention cleanup, and Slack message posting without writing Cradle bridge tables or calling Cradle HTTP APIs.

The most important simplification is that Slack slash-command binding UX was not carried into the first plugin adapter. Binding is available through the server API, while Slack interactive controls can be added later as adapter capabilities after the core bridge behavior is stable. This keeps namespace ownership clean: Cradle owns binding and session semantics; Slack owns Slack protocol details.

## Context and Orientation

Cradle Server modules live under `apps/server/src/modules/{domain}`. Each module typically contains `index.ts` for Elysia routes, `model.ts` for TypeBox schemas, `service.ts` for business behavior, and `README.md` for module inventory. Server modules use the Drizzle database exported by `db()` from `apps/server/src/infra.ts`, and shared tables live in `packages/db/src/schema`.

The current standalone bridge is under `apps/slack-channel-bridge`. It uses Slack Bolt Socket Mode, a private SQLite database, and a generated Cradle OpenAPI client. Important files are `src/slack/app.ts` for Slack connection and command wiring, `src/slack/events.ts` for message event handling, `src/slack/commands.ts` for slash command and block action handling, `src/slack/format.ts` for Slack message rendering, and `src/store.ts` for private persistence. This implementation is useful as behavior reference, but persistence and Cradle API calls must move into the server-owned bridge core.

The plugin SDK is in `packages/plugin-sdk/src/server.ts`. Server plugin context is constructed in `apps/server/src/plugins/context.ts`. Similar existing plugin-owned capability registries include external provider sources in `apps/server/src/plugins/external-provider-source-registry.ts` and external issue sources in `apps/server/src/plugins/external-issue-source-registry.ts`.

A conversation adapter is a plugin-provided platform driver. It knows how to connect to Slack, parse Slack events, render Slack blocks, and post Slack messages. It must not write Cradle database tables. It receives a host interface from the server bridge core and reports normalized inbound messages to the host.

## Plan of Work

First, add generic bridge persistence to `packages/db/src/schema`. The schema should use platform-neutral column names: connection, external workspace, external channel, external thread, external message, external actor. Slack-specific payloads belong in JSON columns, not first-class generic columns. Add a Drizzle migration under `packages/db/drizzle` and export the schema from `packages/db/src/schema/index.ts`.

Second, extend the plugin SDK and plugin host with a conversation adapter registry. Add public types to `packages/plugin-sdk/src/server.ts`, add `conversation.adapters.register(...)` to `ServerPluginContext`, create `apps/server/src/plugins/conversation-adapter-registry.ts`, and wire it into `apps/server/src/plugins/context.ts` and plugin reset logic. Adapter registration should be a runtime capability type such as `conversation-adapter`.

Third, implement `apps/server/src/modules/conversation-bridge`. The service owns connection CRUD, channel bindings, thread bindings, inbound event idempotency, delivery attempt recording, and session creation/message forwarding. The adapter registry provides registered platform adapters. A runtime supervisor starts enabled connections for registered adapters and stops them on shutdown or when disabled. The module exposes management routes for listing connections, creating/updating/deleting connections, channel binding, default runtime selection, recent threads, and retrying failed deliveries.

Fourth, add a bundled Slack adapter plugin. The adapter should be small and should live where bundled plugins are already discovered. It should register a Slack conversation adapter, use Slack Bolt Socket Mode for the WebSocket connection, normalize message events into the bridge host format, and implement `sendMessage` using Slack `chat.postMessage`. It can reuse the current Slack formatting behavior by moving or copying focused formatter utilities into the plugin. It should not create a private SQLite database or use the generated Cradle OpenAPI client.

Fifth, wire startup and tests. The server app should mount the new module. Plugin loader reset should also reset conversation adapter registrations. Tests should cover core service idempotency and registry behavior without real Slack credentials. The Slack adapter should have unit tests for normalization and delivery behavior with fake Slack clients where practical.

The implemented files are `apps/server/src/modules/conversation-bridge/index.ts`, `model.ts`, `runtime-supervisor.ts`, `service.ts`, `service.test.ts`, and `README.md`; `apps/server/src/plugins/conversation-adapter-registry.ts`; edits in `apps/server/src/plugins/context.ts`, `apps/server/src/plugins/loader.ts`, `apps/server/src/app.ts`, and `packages/plugin-sdk/src/server.ts`; DB additions in `packages/db/src/schema/conversation-bridge.ts` and `packages/db/drizzle/0009_conversation_bridge.sql`; and bundled plugin files under `plugins/slack-conversation-bridge`.

## Concrete Steps

All commands are run from `/Users/wibus/dev/Cradle`.

1. Inspect current package scripts before running generators:

    pnpm --filter @cradle/db --help
    pnpm --filter @cradle/server --help

2. Add and export DB schema. Generate or hand-write the migration according to the existing `packages/db` pattern, then inspect the generated SQL before proceeding.

3. Add plugin SDK types and server registry. Run:

    pnpm --filter @cradle/plugin-sdk typecheck

4. Add server module and routes. Run:

    pnpm --filter @cradle/server typecheck

5. Add focused tests and run:

    pnpm --filter @cradle/server exec vitest run src/modules/conversation-bridge

6. If `x-cradle-cli` metadata is added for management routes, regenerate the CLI and typecheck it:

    pnpm gen:cli
    pnpm --filter @cradle/cli typecheck

Final commands run for this implementation:

    pnpm install --filter @cradle/slack-conversation-bridge...
    pnpm --filter @cradle/db generate
    pnpm --filter @cradle/plugin-sdk typecheck
    pnpm --filter @cradle/slack-conversation-bridge typecheck
    pnpm --filter @cradle/slack-conversation-bridge test
    pnpm --filter @cradle/slack-conversation-bridge build
    pnpm --filter @cradle/server typecheck
    pnpm --filter @cradle/server exec vitest run src/modules/conversation-bridge src/plugins/context.test.ts

The final `pnpm --filter @cradle/db generate` run is expected to report `No schema changes, nothing to migrate`; this proves the `0009` SQL migration and `0009_snapshot.json` metadata are aligned.

## Validation and Acceptance

The implementation is accepted when the server typechecks, focused conversation bridge tests pass, and a fake adapter test demonstrates that an inbound normalized message can create or continue a Cradle session binding without any Slack-specific columns in bridge core logic.

Acceptance behavior:

When a registered adapter reports an inbound event for an unbound channel, the core records the event as ignored with a clear reason. When the channel is bound to a Cradle workspace and default runtime, a first mentioned message creates a Cradle session with `origin: conversation-bridge`, creates a thread binding, sends the normalized text to the chat runtime, and asks the adapter to deliver the assistant response to the same external thread. A duplicate external event id is ignored without creating a second session or sending a second message. A failed adapter delivery creates a retryable delivery attempt.

The schema is accepted when bridge tables contain generic `external_*` identifiers and `metadata_json`/`payload_json` fields for platform detail, and no generic bridge table has a Slack-named column such as `team_id`, `slack_ts`, or `thread_ts`.

Current evidence satisfies these checks. `pnpm --filter @cradle/server typecheck` passes. `pnpm --filter @cradle/server exec vitest run src/modules/conversation-bridge src/plugins/context.test.ts` passes with 2 files and 12 tests. `pnpm --filter @cradle/slack-conversation-bridge test` passes with 1 file and 2 tests. `rg -n "team_id|slack_ts|thread_ts|teamId|slackTs|threadTs|Slack" packages/db/src/schema/conversation-bridge.ts apps/server/src/modules/conversation-bridge` finds only explanatory README text, not schema or service identifiers.

## Idempotence and Recovery

All schema additions are additive. Re-running typechecks and tests is safe. If migration generation produces unwanted unrelated changes, discard only the generated migration attempt and regenerate after inspecting current schema exports. Do not revert unrelated working tree changes.

The runtime supervisor must be idempotent: starting an already running connection should be a no-op or restart through an explicit stop/start path; stopping a missing connection should be a no-op. Adapter registration reset during plugin reload must stop or orphan no live connection handles; server shutdown should call supervisor stop for all active connections.

## Artifacts and Notes

Initial repository facts:

    apps/slack-channel-bridge/src/db/schema.ts contains private Slack-specific bridge tables.
    packages/db/src/schema/index.ts exports all server-owned schema modules.
    packages/plugin-sdk/src/server.ts currently exposes routes, mcp, skills, providers, issues, runtimes, hooks, events, storage, logger, and sharedConfig, but no conversation adapter registry.
    apps/server/src/plugins/context.ts constructs the server plugin context and is the right place to add ctx.conversation.adapters.register.

Focused verification transcript:

    pnpm --filter @cradle/plugin-sdk typecheck
    $ tsc --noEmit -p tsconfig.json

    pnpm --filter @cradle/db generate
    No schema changes, nothing to migrate

    pnpm --filter @cradle/slack-conversation-bridge typecheck
    $ tsc --noEmit

    pnpm --filter @cradle/slack-conversation-bridge test
    Test Files  1 passed (1)
    Tests  2 passed (2)

    pnpm --filter @cradle/slack-conversation-bridge build
    dist/server.mjs  2,053.08 kB | gzip: 509.95 kB
    built in 164ms

    pnpm --filter @cradle/server typecheck
    $ tsc --noEmit

    pnpm --filter @cradle/server exec vitest run src/modules/conversation-bridge src/plugins/context.test.ts
    Test Files  2 passed (2)
    Tests  12 passed (12)

## Interfaces and Dependencies

In `packages/plugin-sdk/src/server.ts`, define platform-neutral adapter types. The final names should remain stable:

    export type ConversationBridgePlatform = string

    export interface ConversationBridgeAdapterRegistration {
      platform: ConversationBridgePlatform
      label: string
      description?: string
      capabilities?: ConversationBridgeAdapterCapabilities
      createRuntime: (ctx: ConversationBridgeAdapterRuntimeContext) => ConversationBridgeAdapterRuntime
    }

    export interface ConversationBridgeAdapterRuntime {
      start(connection: ConversationBridgeConnectionRuntimeConfig, host: ConversationBridgeHost): Promise<void>
      stop(connectionId: string): Promise<void>
      sendMessage(input: ConversationBridgeDeliveryInput): Promise<ConversationBridgeDeliveryResult>
    }

    export interface ConversationBridgeHost {
      handleInboundMessage(event: NormalizedConversationInboundMessage): Promise<void>
      reportConnectionHealth(input: ConversationBridgeConnectionHealth): void
    }

In `apps/server/src/modules/conversation-bridge`, implement service functions for connection CRUD, binding CRUD, inbound handling, delivery handling, and supervisor start/stop. The service may call the existing session and chat-runtime services; it must not call Slack APIs directly.

In the Slack adapter plugin, use `@slack/bolt` because the current standalone bridge already uses it successfully for Socket Mode. The adapter owns the live Slack WebSocket connection handle, while the server supervisor owns the decision that a connection should be running.

Revision note 2026-06-21 06:11Z: Created the initial self-contained ExecPlan from the agreed design and current repository inspection.

Revision note 2026-06-21 06:36Z: Updated the plan after implementation. Recorded completed server module, plugin SDK, DB migration, Slack adapter plugin, lifecycle wiring, focused tests, validation commands, and decisions made while keeping Slack protocol ownership separate from Cradle bridge core ownership.
