# Build an Independent Slack Channel Bridge App for Cradle Sessions

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not currently check in a root-level `PLANS.md`. This document is authored and must be maintained in accordance with `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained so a contributor can resume the work with only this file and the repository checkout.

## Purpose / Big Picture

Cradle currently has an experimental `apps/zhi-slack-bridge` that routes one MCP human-in-the-loop prompt to one fresh Slack thread. That is useful, but it is not an external channel bridge: it does not keep a stable Slack thread to Cradle session binding, and it does not let a user continue a Cradle session from Slack while away from the desktop UI.

This plan builds a separate app, `apps/slack-channel-bridge`, that uses Slack as an external session surface without making Slack a core Cradle module. After this change, a user can bind a Slack channel to a Cradle workspace, mention the Slack bot in a thread, have the bridge create or reuse a Cradle chat session through the public OpenAPI client, and keep talking in the same Slack thread while replies are streamed back from Cradle. The app stores its own Slack installation, channel binding, thread/session mapping, inbound event audit, and delivery attempts in its own SQLite database. It does not import Cradle server internals and does not write to the Cradle server database.

## Progress

- [x] (2026-06-08 02:12 CST) Read the ExecPlan skill and `/Users/wibus/.agents/skills/execplan/references/PLANS.md`; confirmed this plan must be self-contained, living, outcome-focused, and stored under `docs/exec-plans/`.
- [x] (2026-06-08 02:12 CST) Inspected `apps/zhi-slack-bridge` to reuse the independent app pattern, Slack Bolt usage, tests, and build scripts without inheriting its one-thread-per-tool-call semantics.
- [x] (2026-06-08 02:12 CST) Inspected current Cradle OpenAPI generation in `apps/web/openapi-ts.config.ts` and confirmed the repo already uses `@hey-api/openapi-ts` with `@hey-api/client-fetch`.
- [x] (2026-06-08 02:12 CST) Inspected existing server routes for `/workspaces`, `/sessions`, and `/chat/sessions/:sessionId/response` to ground the bridge in available public APIs.
- [x] (2026-06-08 02:12 CST) Created this ExecPlan for an independent Slack bridge app using SQLite through Drizzle and a generated OpenAPI client.
- [x] (2026-06-08 02:20 CST) Implemented Milestone 1: scaffolded `apps/slack-channel-bridge` with TypeScript, Slack Bolt, dotenv, zod config, Drizzle-backed SQLite schema/store, tests, generated-client config, and build scripts.
- [x] (2026-06-08 02:21 CST) Implemented Milestone 2: generated a bridge-local Cradle OpenAPI client under `apps/slack-channel-bridge/src/generated/cradle-api` and added `src/cradle/service.ts` wrapper over `getWorkspaces`, `postSessions`, `getSessionsByIdMessages`, and `postChatSessionsBySessionIdResponse`.
- [x] (2026-06-08 02:24 CST) Implemented Milestone 3: added `/cradle bind workspace <workspace-id>`, `/cradle unbind`, and `/cradle status` handlers with fake-service tests.
- [x] (2026-06-08 02:26 CST) Implemented Milestone 4: added Slack event ingestion with inbound dedupe, thread-to-session binding, Cradle session creation/reuse, SSE collection, and Slack thread response delivery.
- [x] (2026-06-08 02:26 CST) Implemented Milestone 5: added Slack message chunking, delivery attempt records, failed delivery retry on startup, and simple no-guess recovery semantics.
- [x] (2026-06-08 02:28 CST) Implemented Milestone 6: added focused unit/integration tests, generated-client validation, README setup instructions, and ran typecheck/test/build successfully.
- [x] (2026-06-08 02:33 CST) Completion audit found and fixed a real runtime gap: Cradle session creation requires an agent or provider target, so the bridge now fails fast unless `CRADLE_SLACK_AGENT_ID` or `CRADLE_SLACK_PROVIDER_TARGET_ID` is configured and passes that runtime config into `POST /sessions`.
- [x] (2026-06-08 02:35 CST) Added and ran `pnpm --filter @cradle/slack-channel-bridge verify`, which runs typecheck, tests, and build as a single local verification command.

## Surprises & Discoveries

- Observation: The existing `zhi-slack-bridge` is intentionally a bridge app, but its current runtime model is not stable session continuation.
  Evidence: `apps/zhi-slack-bridge/README.md` says every zhi tool call creates a brand new Slack thread and that only the bound channel is persistent.

- Observation: The original `docs/draft-solutions/done/zhi-in-slack.md` described stable session-to-thread binding, but the implemented zhi app deliberately simplified away that part.
  Evidence: The draft says future zhi calls in the same session reuse the same Slack thread, while the current README says the bridge forgets the mapping once a reply resolves the pending call.

- Observation: Cradle already has a public OpenAPI snapshot export and generated client workflow.
  Evidence: `apps/web/package.json` has `generate: pnpm --filter @cradle/server exec vite-node scripts/export-openapi.ts && openapi-ts`, and `apps/web/openapi-ts.config.ts` outputs generated files under `apps/web/src/api-gen`.

- Observation: Existing public APIs are enough for a first end-to-end bridge, but they do not yet encode external-channel provenance.
  Evidence: `/sessions` can create sessions, `/sessions/:id/messages` can read messages, and `/chat/sessions/:sessionId/response` streams a response. None of these currently record Slack `team_id`, `channel_id`, `thread_ts`, or external user identity as first-class Cradle metadata.

- Observation: `@hey-api/openapi-ts` generated extensionless relative imports, so `moduleResolution: NodeNext` failed for the bridge package.
  Evidence: `pnpm --filter @cradle/slack-channel-bridge typecheck` initially failed with TS2834/TS2835 in generated files. Switching the app to the same `module: ESNext` and `moduleResolution: bundler` pattern used by `apps/zhi-slack-bridge` fixed the generated-client typecheck.

- Observation: Node 22 has fetch and stream APIs at runtime, but the generated client still needs DOM library types for TypeScript.
  Evidence: typecheck failed on missing `BodyInit` until `DOM` was added to the bridge `tsconfig.json` `lib` array.

- Observation: The first `generate` command failed before install because the new workspace package had no local `node_modules` bin for `openapi-ts`.
  Evidence: `pnpm --filter @cradle/slack-channel-bridge generate` failed with `sh: openapi-ts: command not found`; `pnpm install --filter @cradle/slack-channel-bridge...` fixed it and updated `pnpm-lock.yaml`.

- Observation: Cradle's real session creation path rejects sessions that do not specify an agent or provider target.
  Evidence: `apps/server/src/modules/session/service.ts` throws `Session requires a provider target or an agent` when neither `agentId` nor `providerTargetId` is provided. The bridge now requires `CRADLE_SLACK_AGENT_ID` or `CRADLE_SLACK_PROVIDER_TARGET_ID` and includes that configuration in the generated `postSessions` call.

## Decision Log

- Decision: Build `apps/slack-channel-bridge` as a separate app instead of adding a `channels` server module in this plan.
  Rationale: The user explicitly asked not to bind this to Cradle core yet. An independent app can validate Slack conversation mechanics, thread/session mapping, command UX, and OpenAPI client boundaries before deciding whether any canonical `channels` module is worth promoting.
  Date/Author: 2026-06-08 / Codex.

- Decision: Use SQLite owned by the bridge app and access it through Drizzle, not raw SQL and not the Cradle server database.
  Rationale: The bridge needs durable local mappings and audit records, but repository rules require Drizzle for database interactions. Keeping the SQLite file under the bridge app's data directory preserves namespace ownership: the bridge owns external Slack mapping state; Cradle owns sessions and chat runtime state.
  Date/Author: 2026-06-08 / Codex.

- Decision: Use `@hey-api/openapi-ts` to generate a bridge-local Cradle client from `apps/server/openapi.json`.
  Rationale: The repo already uses this generator for `apps/web`. The bridge should call Cradle public API contracts instead of importing server modules or hand-writing endpoint types.
  Date/Author: 2026-06-08 / Codex.

- Decision: Bind Slack threads to Cradle sessions, not entire Slack channels.
  Rationale: A Slack channel can contain many independent tasks. A Slack thread is the smallest stable conversation unit that maps cleanly to one Cradle chat session. The channel binding only supplies defaults such as the Cradle workspace id.
  Date/Author: 2026-06-08 / Codex.

- Decision: Treat Slack connector state as external mapping state, not canonical chat state.
  Rationale: Slack messages are ingress and delivery evidence. The authoritative chat transcript remains in Cradle through `/sessions` and `/chat`. This prevents the bridge from becoming a second chat runtime.
  Date/Author: 2026-06-08 / Codex.

- Decision: Defer Slack OAuth installation management for the first implementation and support Socket Mode app tokens configured by environment variables.
  Rationale: `apps/zhi-slack-bridge` already uses Socket Mode, which is enough for a personal or private workspace bridge. OAuth installation tables are still included in the SQLite schema because the design should not paint itself into a single-workspace corner, but the first milestone does not need a public OAuth distribution flow.
  Date/Author: 2026-06-08 / Codex.

- Decision: Require the bridge runtime configuration to specify either `CRADLE_SLACK_AGENT_ID` or `CRADLE_SLACK_PROVIDER_TARGET_ID`.
  Rationale: The plan's first draft described creating sessions with only workspace and title, but current Cradle server semantics require an agent or provider target. Failing fast at bridge startup is clearer than letting the first Slack message fail after a thread is already active. Agent id is preferred because it carries the intended runtime/provider setup; provider target id remains available for direct provider-backed sessions.
  Date/Author: 2026-06-08 / Codex.

## Outcomes & Retrospective

Implementation is complete for the first independent bridge version described by this plan. Slack protocol handling and local mapping state live in `apps/slack-channel-bridge`, while Cradle sessions and chat execution remain accessible only through generated OpenAPI client calls. The app compiles, tests pass, and the package builds. Real Slack verification still requires user-provided Slack app tokens, a running Cradle server, and either `CRADLE_SLACK_AGENT_ID` or `CRADLE_SLACK_PROVIDER_TARGET_ID`, but the code path is covered by fake Slack/Cradle integration tests: first mention creates one Cradle session and thread binding, repeated delivery of the same Slack event is deduped, and later replies in the same Slack thread reuse the original session binding. If the spike proves useful, a later plan can promote the stable concepts into a Cradle-owned `channels` module; this plan intentionally does not do that promotion.

## Context and Orientation

The repository root is `/Users/wibus/dev/Cradle`. The existing experimental Slack bridge lives at `apps/zhi-slack-bridge`. It is a TypeScript app with `@slack/bolt`, `dotenv`, `zod`, `tsx`, `tsup`, and `vitest`. It has a `src/main.ts`, `src/slack-bot.ts`, a store, tests, and a README. Use it as a structural reference for a standalone app, not as a semantic model for session continuation.

The Cradle server app lives under `apps/server`. It exposes an OpenAPI document at `/openapi.json`, and `apps/server/scripts/export-openapi.ts` writes that document to `apps/server/openapi.json`. The web app already uses `@hey-api/openapi-ts` to generate a fetch client from that OpenAPI snapshot. The new bridge should add its own OpenAPI generation config instead of importing `apps/web/src/api-gen`, because the bridge is a separate Node app and should not depend on web app module aliases.

The existing workspace API is under `apps/server/src/modules/workspace/index.ts` with prefix `/workspaces`. It can list workspaces and create or import workspaces. The bridge should use `GET /workspaces` for `/cradle status` and for resolving a workspace id or selecting a default binding when the user provides an explicit id.

The existing session API is under `apps/server/src/modules/session/index.ts` with prefix `/sessions`. It can create sessions with a body containing `workspaceId`, `title`, optional `providerTargetId`, optional `modelId`, optional `agentId`, optional `runtimeKind`, and optional `runtimeSettings`. It can read messages using `GET /sessions/:id/messages`.

The existing chat runtime API is under `apps/server/src/modules/chat-runtime/index.ts` with prefix `/chat`. The important route for this plan is `POST /chat/sessions/:sessionId/response`, which sends a user message and returns a server-sent event stream. A server-sent event stream, abbreviated SSE, is an HTTP response whose body sends repeated lines such as `data: {"type":"text-delta","delta":"..."}` until a final `data: [DONE]` line. The bridge must parse this stream, collect the assistant text, and post it back to the Slack thread.

Slack's basic units are as follows. A Slack workspace, also called a team, has a `team_id`. A Slack app installation is the bridge app installed into that workspace and authorized with bot/app tokens. A Slack conversation is a channel, private channel, direct message, or group direct message and has a `channel_id`. A Slack message is located by `team_id`, `channel_id`, and a timestamp string called `ts`. A Slack thread is located by `team_id`, `channel_id`, and `thread_ts`; for a root message, `thread_ts` is the root message `ts`. This bridge maps one Slack thread to one Cradle session.

The bridge app's SQLite database is not the Cradle server database. By default, it should live under a bridge-owned directory such as `~/.cradle/slack-channel-bridge/bridge.sqlite`, overridable by `SLACK_CHANNEL_BRIDGE_DB_PATH`. A "mapping" in this plan means a bridge-owned record that says one external Slack thing corresponds to one Cradle thing. For example, `team_id + channel_id + thread_ts -> cradle_session_id` is a mapping. A mapping is not a copy of the session.

## Plan of Work

Milestone 1 scaffolds the independent app. Create `apps/slack-channel-bridge/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `.env.example`, `README.md`, and source/test directories. The package should be private and named `@cradle/slack-channel-bridge`. Scripts should include `dev`, `build`, `start`, `typecheck`, `test`, `test:watch`, and `generate`. Dependencies should include `@slack/bolt`, `dotenv`, `zod`, `better-sqlite3`, `drizzle-orm`, `@hey-api/client-fetch`, and the minimum generated-client runtime dependencies required by `@hey-api/openapi-ts`. Dev dependencies should include `@hey-api/openapi-ts`, `@types/better-sqlite3`, `@types/node`, `drizzle-kit`, `tsx`, `tsup`, `typescript`, and `vitest`.

Milestone 1 also creates the SQLite/Drizzle storage layer. Add `apps/slack-channel-bridge/src/db/schema.ts`, `src/db/client.ts`, `src/db/migrate.ts`, and `src/store.ts`. The schema should be bridge-owned and should not reuse Cradle server tables. Use Drizzle table definitions for:

    slack_installations: team_id primary key, enterprise_id nullable, bot_user_id nullable, installed_at, revoked_at nullable
    workspace_bindings: id primary key, team_id, channel_id, cradle_workspace_id, bound_by_slack_user_id, created_at, updated_at, unique(team_id, channel_id)
    actor_bindings: id primary key, team_id, slack_user_id, cradle_user_id, created_at, revoked_at nullable, unique(team_id, slack_user_id)
    thread_bindings: id primary key, team_id, channel_id, thread_ts, cradle_session_id, cradle_workspace_id nullable, created_by_slack_user_id nullable, created_at, updated_at, unique(team_id, channel_id, thread_ts)
    inbound_events: event_id primary key, team_id nullable, channel_id nullable, thread_ts nullable, slack_ts nullable, event_type, status, reason nullable, received_at, processed_at nullable
    delivery_attempts: id primary key, team_id, channel_id, thread_ts, cradle_session_id, cradle_message_id nullable, run_id nullable, status, attempt_count, slack_ts nullable, error_text nullable, created_at, updated_at

The storage API should expose ordinary functions such as `getWorkspaceBinding(teamId, channelId)`, `setWorkspaceBinding(...)`, `getThreadBinding(...)`, `createThreadBinding(...)`, `recordInboundEvent(...)`, `markInboundEventProcessed(...)`, `createDeliveryAttempt(...)`, and `markDeliveryAttemptDelivered(...)`. Use Drizzle queries throughout. Do not use raw SQL except where Drizzle migration tooling emits migration SQL files.

Milestone 2 generates the Cradle OpenAPI client. Add `apps/slack-channel-bridge/openapi-ts.config.ts`. Its input should be `../server/openapi.json`, and its output should be `./src/generated/cradle-api`. Use `@hey-api/client-fetch` and `@hey-api/sdk`; omit TanStack React Query because this is a Node bridge, not a React UI. Add a package script:

    "generate": "pnpm --filter @cradle/server exec vite-node scripts/export-openapi.ts && openapi-ts"

Add `src/cradle/client.ts` to configure the generated fetch client with `CRADLE_API_BASE_URL`, defaulting to `http://127.0.0.1:3527` only if that is the server's actual local default. If the server default port is different, use the server config default found during implementation. Add `src/cradle/service.ts` as a small semantic wrapper with functions such as `listWorkspaces()`, `createSlackBackedSession(input)`, `sendMessageAndCollectResponse(input)`, and `getSessionMessages(sessionId)`. This wrapper exists so Slack handlers do not need to know generated operation names. It must still call only generated OpenAPI client functions.

Milestone 3 implements slash commands. In `src/slack/app.ts`, create a Slack Bolt app in Socket Mode. In `src/slack/commands.ts`, implement `/cradle bind`, `/cradle unbind`, and `/cradle status`. The minimum first-version syntax is:

    /cradle bind workspace <workspace-id>
    /cradle unbind
    /cradle status

`bind` stores `team_id + channel_id -> cradle_workspace_id` after verifying the workspace exists through the Cradle client. `unbind` deletes or revokes the channel binding. `status` shows the currently bound workspace id, channel id, and recent thread bindings. Replies should be Slack ephemeral messages for status and errors, and in-channel messages only when a binding is successfully changed. Keep `/zhi` separate; this app owns `/cradle`.

Milestone 4 implements message ingestion and session continuation. In `src/slack/events.ts`, listen for Slack message events and app mentions. Ignore bot messages, message edits/deletes, and messages that do not mention the bot or occur in a thread already bound to a Cradle session. Use the Slack SDK event envelope `event_id` for dedupe when available. If only the inner message is available in tests, compute a fallback dedupe key from `team_id + channel_id + ts + subtype`.

For a root message or first relevant thread reply, compute `thread_ts` as `event.thread_ts ?? event.ts`. Look up `thread_bindings` by `team_id + channel_id + thread_ts`. If no binding exists, require a `workspace_bindings` row for the channel. Create a Cradle session using `POST /sessions` with `workspaceId` from the binding and a title derived from the first Slack message, for example `Slack: <first 60 chars>`. Store the new `thread_bindings` row. Then send the Slack text to `POST /chat/sessions/:sessionId/response`, parse the SSE stream, and post the final assistant response back into the same Slack thread with `chat.postMessage({ channel, thread_ts, text })`.

If a binding already exists, send the new Slack reply text to the bound Cradle session. The bridge should include lightweight provenance in the user text until Cradle has a first-class external provenance API. For example, prepend a short line such as `Slack user <@U123> in channel C123 wrote:` before the user's message. This is a temporary bridge-local representation; do not add Cradle server schema changes in this plan unless the first implementation cannot work without them.

Milestone 5 adds resilience. Slack has message length limits, so create `src/slack/format.ts` with chunking that splits long assistant responses into multiple thread replies. Reuse the idea from `apps/zhi-slack-bridge/src/slack-format.ts`, but do not import that file directly unless it is promoted to a shared package in a separate plan. Add delivery attempts for each outbound response. On failure, record the error and retry with bounded exponential backoff. On bridge restart, the app should query `delivery_attempts` for retryable failed or pending attempts and retry them once the Slack app starts. Do not replay inbound events that have already been marked processed.

Milestone 5 also handles active stream recovery simply. If the bridge crashes while Cradle is streaming, it may miss the response. On restart, it should not guess the missing assistant reply from Slack. Instead, provide `/cradle status` output that shows the bound session id, and implement a manual `/cradle sync thread` command only if needed after the first closed loop works. That command can read `GET /sessions/:id/messages` and post the latest complete assistant message if it has not already been delivered. Do not add automatic transcript sync in the first implementation; it is easy to duplicate messages without a stable Cradle message id to Slack delivery mapping.

Milestone 6 adds tests and docs. Unit tests should cover SQLite store functions, event dedupe, thread binding creation, slash command parsing, SSE parsing, and Slack message chunking. Integration tests should use fake Slack clients and fake Cradle client functions so they do not require a real Slack workspace or a live Cradle server. Add `apps/slack-channel-bridge/README.md` with Slack app setup, environment variables, commands, runtime model, and local verification. Add `.env.example` with `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`, `CRADLE_API_BASE_URL`, and `SLACK_CHANNEL_BRIDGE_DB_PATH`.

## Concrete Steps

Work from `/Users/wibus/dev/Cradle`.

Before editing, inspect the worktree and avoid overwriting unrelated user changes:

    git status --short

Expected output may include unrelated modified files. Do not revert them.

Create the app directory and scaffold files using `apply_patch` for manual edits:

    apps/slack-channel-bridge/package.json
    apps/slack-channel-bridge/tsconfig.json
    apps/slack-channel-bridge/tsup.config.ts
    apps/slack-channel-bridge/vitest.config.ts
    apps/slack-channel-bridge/openapi-ts.config.ts
    apps/slack-channel-bridge/.env.example
    apps/slack-channel-bridge/README.md
    apps/slack-channel-bridge/src/main.ts
    apps/slack-channel-bridge/src/config.ts
    apps/slack-channel-bridge/src/db/schema.ts
    apps/slack-channel-bridge/src/db/client.ts
    apps/slack-channel-bridge/src/db/migrate.ts
    apps/slack-channel-bridge/src/store.ts
    apps/slack-channel-bridge/src/cradle/client.ts
    apps/slack-channel-bridge/src/cradle/service.ts
    apps/slack-channel-bridge/src/slack/app.ts
    apps/slack-channel-bridge/src/slack/commands.ts
    apps/slack-channel-bridge/src/slack/events.ts
    apps/slack-channel-bridge/src/slack/format.ts
    apps/slack-channel-bridge/src/slack/sse.ts

Add the workspace package to the root package manager naturally by editing `apps/slack-channel-bridge/package.json`; no root workspace config change should be necessary if the repo already uses `apps/*`. Verify with:

    pnpm --filter @cradle/slack-channel-bridge typecheck

Install dependencies only through pnpm from the repository root:

    pnpm --filter @cradle/slack-channel-bridge add @slack/bolt @hey-api/client-fetch better-sqlite3 dotenv drizzle-orm zod
    pnpm --filter @cradle/slack-channel-bridge add -D @hey-api/openapi-ts @types/better-sqlite3 @types/node drizzle-kit tsup tsx typescript vitest

Generate the Cradle client after `openapi-ts.config.ts` exists:

    pnpm --filter @cradle/slack-channel-bridge generate

Expected result: `apps/server/openapi.json` is refreshed and `apps/slack-channel-bridge/src/generated/cradle-api` contains generated TypeScript files with comments saying they are auto-generated by `@hey-api/openapi-ts`.

Run focused validation after each milestone:

    pnpm --filter @cradle/slack-channel-bridge typecheck
    pnpm --filter @cradle/slack-channel-bridge test
    pnpm --filter @cradle/slack-channel-bridge build

For local manual verification, start Cradle server in one terminal:

    pnpm dev:server

Start the bridge in another terminal with Socket Mode credentials:

    SLACK_BOT_TOKEN=xoxb-... SLACK_APP_TOKEN=xapp-... SLACK_SIGNING_SECRET=... CRADLE_API_BASE_URL=http://127.0.0.1:<server-port> pnpm --filter @cradle/slack-channel-bridge dev

In Slack, invite the bot to a test channel, bind the channel:

    /cradle bind workspace <workspace-id>

Then mention the bot:

    @Cradle summarize the current workspace risks

Expected behavior: the bridge creates a Cradle session through the public API, stores a `thread_bindings` row, and posts the assistant response back into the same Slack thread. A second reply in that same Slack thread should reuse the same Cradle session id.

## Validation and Acceptance

Acceptance is behavioral. First, the bridge app can be typechecked, tested, and built independently:

    pnpm --filter @cradle/slack-channel-bridge typecheck
    pnpm --filter @cradle/slack-channel-bridge test
    pnpm --filter @cradle/slack-channel-bridge build

Second, `pnpm --filter @cradle/slack-channel-bridge generate` refreshes the generated OpenAPI client without importing `apps/web` and without hand-written endpoint types.

Third, SQLite persistence works. A test should create a temporary SQLite database, set a workspace binding, create a thread binding, record an inbound event, record a delivery attempt, close the database, reopen it, and prove the rows are still present. This test fails if the store is in-memory only.

Fourth, slash commands work against fake Slack command payloads. `/cradle bind workspace workspace_123` stores exactly one binding for `team_id + channel_id`. Re-running the same bind updates the binding idempotently. `/cradle unbind` removes or revokes it. `/cradle status` returns the current binding and recent thread/session mappings.

Fifth, the message ingestion loop works against fake Slack and fake Cradle services. Given a first app mention event in a bound channel, the bridge creates one Cradle session, creates one thread binding, sends one Cradle message, and posts one Slack thread reply. Given a second reply with the same `thread_ts`, the bridge does not create a new Cradle session and sends the message to the existing session.

Sixth, dedupe works. Delivering the same Slack event twice records only one processed inbound event and sends only one Cradle message. This is required because Slack may retry events.

Seventh, manual real-world verification in a Slack workspace shows the same Slack thread continuing the same Cradle session. The bridge logs should print the `team_id`, `channel_id`, `thread_ts`, and `cradle_session_id` for the bound conversation, without logging full Slack tokens.

## Idempotence and Recovery

The plan is designed to be repeatable. Running `generate` repeatedly should overwrite only generated files under `apps/slack-channel-bridge/src/generated/cradle-api` and the server OpenAPI snapshot. Running tests should use temporary SQLite files and clean them up. Running the bridge repeatedly should reuse the same SQLite database and should not create duplicate thread bindings because `team_id + channel_id + thread_ts` is unique.

If a migration fails during development, stop the bridge, back up the bridge-owned SQLite file, fix the Drizzle schema or migration, and rerun the migration. Do not edit the Cradle server database. During tests, use a temporary database path such as `tmpdir()/slack-channel-bridge-test-<pid>.sqlite`.

If Slack sends duplicate events or retries a failed event, `inbound_events.event_id` prevents duplicate Cradle sends. If Slack posting fails, `delivery_attempts` records the failure and allows retry. If Cradle streaming fails, the bridge should post a short failure message into the Slack thread and record the failed delivery or inbound status rather than silently losing the user's message.

If generated client operation names are awkward or change when OpenAPI metadata changes, keep those names contained in `src/cradle/service.ts`. Slack handlers should call semantic wrapper functions only.

## Artifacts and Notes

The current zhi app proves the standalone Slack app pattern:

    apps/zhi-slack-bridge/package.json
    apps/zhi-slack-bridge/src/main.ts
    apps/zhi-slack-bridge/src/slack-bot.ts
    apps/zhi-slack-bridge/tests/*.test.ts

The current web OpenAPI generation pattern is:

    apps/web/package.json script:
      "generate": "pnpm --filter @cradle/server exec vite-node scripts/export-openapi.ts && openapi-ts"

    apps/web/openapi-ts.config.ts:
      input: "../server/openapi.json"
      output.path: "./src/api-gen"
      plugins include "@hey-api/client-fetch", "@tanstack/react-query", "zod", and "@hey-api/sdk"

The bridge should adapt that pattern by excluding React Query and outputting to:

    apps/slack-channel-bridge/src/generated/cradle-api

The existing Cradle APIs used by the first version are:

    GET /workspaces
    POST /sessions
    GET /sessions/:id/messages
    POST /chat/sessions/:sessionId/response

The bridge-owned default SQLite path should be documented as:

    ~/.cradle/slack-channel-bridge/bridge.sqlite

and overridable with:

    SLACK_CHANNEL_BRIDGE_DB_PATH=/absolute/path/to/bridge.sqlite

## Interfaces and Dependencies

In `apps/slack-channel-bridge/src/config.ts`, define a zod-validated configuration object with these environment variables:

    SLACK_BOT_TOKEN: required string
    SLACK_APP_TOKEN: required string for Socket Mode
    SLACK_SIGNING_SECRET: required string
    CRADLE_API_BASE_URL: required or defaulted to the known local Cradle server URL
    SLACK_CHANNEL_BRIDGE_DB_PATH: optional absolute path
    SLACK_CHANNEL_BRIDGE_LOG_LEVEL: optional string, default "info"

In `apps/slack-channel-bridge/src/store.ts`, define a store interface. The exact TypeScript type names may change during implementation, but the behavior must include these methods:

    getWorkspaceBinding(teamId: string, channelId: string): Promise<WorkspaceBinding | null>
    setWorkspaceBinding(input: { teamId: string, channelId: string, cradleWorkspaceId: string, boundBySlackUserId: string }): Promise<WorkspaceBinding>
    removeWorkspaceBinding(teamId: string, channelId: string): Promise<void>
    getThreadBinding(input: { teamId: string, channelId: string, threadTs: string }): Promise<ThreadBinding | null>
    createThreadBinding(input: { teamId: string, channelId: string, threadTs: string, cradleSessionId: string, cradleWorkspaceId: string | null, createdBySlackUserId: string | null }): Promise<ThreadBinding>
    recordInboundEvent(input: { eventId: string, teamId: string | null, channelId: string | null, threadTs: string | null, slackTs: string | null, eventType: string }): Promise<"created" | "duplicate">
    markInboundEventProcessed(eventId: string): Promise<void>
    markInboundEventFailed(eventId: string, reason: string): Promise<void>
    createDeliveryAttempt(input: { teamId: string, channelId: string, threadTs: string, cradleSessionId: string, cradleMessageId?: string | null, runId?: string | null }): Promise<DeliveryAttempt>
    markDeliveryAttemptDelivered(id: string, slackTs: string): Promise<void>
    markDeliveryAttemptFailed(id: string, errorText: string): Promise<void>

In `apps/slack-channel-bridge/src/cradle/service.ts`, define a wrapper over the generated client with these semantic operations:

    listWorkspaces(): Promise<Array<{ id: string, name: string, path: string }>>
    verifyWorkspace(workspaceId: string): Promise<boolean>
    createSlackBackedSession(input: { workspaceId: string, title: string }): Promise<{ id: string }>
    sendMessageAndCollectResponse(input: { sessionId: string, text: string }): Promise<{ text: string, runId: string | null, assistantMessageId: string | null, userMessageId: string | null }>
    getSessionMessages(sessionId: string): Promise<Array<{ id: string, role: "user" | "assistant", status: string, content: string }>>

In `apps/slack-channel-bridge/src/slack/events.ts`, define an ingestion handler that accepts Slack event payloads and injected dependencies for tests. It should not instantiate the Bolt app itself. A test should be able to call the handler with a fake store, fake Cradle service, and fake Slack poster.

In `apps/slack-channel-bridge/src/slack/sse.ts`, define a parser that can consume the Cradle SSE stream and return final assistant text plus header ids. It must tolerate `data: [DONE]`, JSON chunk lines, and unknown chunk types. For text chunks, collect `text-delta` values and any other current AI SDK text chunk shape discovered during implementation.

Revision note 2026-06-08: Initial plan created to capture the user's requested independent External Channel Bridges spike, using Slack, generated OpenAPI client calls, and bridge-owned SQLite/Drizzle persistence.

Revision note 2026-06-08 02:28 CST: Implemented the first version of `apps/slack-channel-bridge`, updated progress/discoveries/outcomes, and recorded successful validation commands: `pnpm --filter @cradle/slack-channel-bridge generate`, `typecheck`, `test`, and `build`.

Revision note 2026-06-08 02:33 CST: Completion audit found that `POST /sessions` requires an agent or provider target. Updated bridge config, README, `.env.example`, session create wrapper, and tests. Re-ran `typecheck`, `test`, and `build`; all passed with 5 test files and 12 tests.

Revision note 2026-06-08 02:35 CST: Added the bridge-local `verify` package script and README instructions. Ran `pnpm --filter @cradle/slack-channel-bridge verify`; it passed typecheck, 5 test files / 12 tests, and build.
