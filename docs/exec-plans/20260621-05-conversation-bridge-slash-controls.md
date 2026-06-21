# Complete Conversation Bridge Slack Controls

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained so a contributor can resume the work from this file and the current repository only.

## Purpose / Big Picture

Cradle already has a server-owned `conversation-bridge` module and a bundled Slack adapter plugin, but the migration from the old standalone `apps/slack-channel-bridge` app is not complete. The old app owned `/cradle bind workspace`, `/cradle status`, `/cradle unbind`, and Slack Block Kit selectors for choosing the default Cradle runtime and model. The new integrated Slack adapter currently handles Slack message events only, so Slack slash commands time out with "application did not respond."

After this change, the bundled Slack adapter acknowledges `/cradle` and Slack block actions in Socket Mode, while Cradle Server continues to own binding state, runtime default selection, session/thread semantics, and persistence. A user can run `/cradle status`, `/cradle bind workspace <workspace-id>`, and `/cradle unbind` in Slack against the integrated connection without starting `apps/slack-channel-bridge`.

## Progress

- [x] (2026-06-21 10:53Z) Confirmed the active integrated Slack plugin and connection are running, and that the missing behavior is slash command/action handling rather than Socket Mode startup.
- [x] (2026-06-21 10:53Z) Read server module and ExecPlan rules, the existing conversation bridge plan, the old standalone command handlers, current plugin SDK conversation adapter types, and server bridge service/model files.
- [x] (2026-06-21 11:04Z) Added server-owned control handling APIs to `conversation-bridge` so adapters can submit normalized command/action requests without writing bridge tables directly.
- [x] (2026-06-21 11:04Z) Added Slack adapter command/action registration, ACK handling, and Block Kit rendering that calls the server-owned control host.
- [x] (2026-06-21 11:04Z) Added focused tests covering slash bind/status/unbind and runtime/model selectors through the integrated adapter path, plus Slack ACK/respond behavior.
- [x] (2026-06-21 11:05Z) Ran focused typecheck/test/build commands for plugin SDK, server, and Slack plugin; all passed.

## Surprises & Discoveries

- Observation: The first integrated conversation bridge plan explicitly chose not to migrate Slack slash-command binding UX.
  Evidence: `docs/exec-plans/20260621-04-conversation-bridge.md` decision log says "Slack slash-command binding UX was not carried into the first plugin adapter."
- Observation: The running server already has `@cradle/slack-conversation-bridge` active and a Slack connection in `healthStatus: running`, but the adapter only registers Slack Events API handlers.
  Evidence: `plugins/slack-conversation-bridge/src/adapter.ts` registers `app.event('app_mention', ...)` and `app.event('message', ...)`, and no `app.command('/cradle')` or `app.action(...)` exists.
- Observation: Current integrated connection `988d38bb-9e4f-41a6-b599-d0c2ce1a9e4e` has no channel bindings, so message events are ignored until binding exists.
  Evidence: `GET /conversation-bridge/connections/988d38bb-9e4f-41a6-b599-d0c2ce1a9e4e/channel-bindings` returned `[]`.
- Observation: Toggling plugin activation alone is not enough to live-apply this change to an already running server process.
  Evidence: The patch changes `apps/server/src/modules/conversation-bridge/runtime-supervisor.ts` and `service.ts` as well as `plugins/slack-conversation-bridge/dist/server.mjs`; an already running Node process has already loaded the old server modules and should be restarted for reliable live Slack verification.

## Decision Log

- Decision: Add a platform-neutral control host contract to the plugin SDK instead of letting the Slack plugin import server service modules or write database tables.
  Rationale: Slack owns protocol mechanics such as ACK, command payload shape, and Block Kit rendering. Cradle Server owns binding semantics and default runtime state. A host callback preserves that boundary.
  Date/Author: 2026-06-21 / Codex.
- Decision: Keep `/cradle` as a Slack adapter control surface, not a new server HTTP webhook route.
  Rationale: The connection already uses Slack Socket Mode, so commands and actions can arrive over the same running Bolt app and do not require a public Request URL. The Slack adapter can acknowledge Slack immediately and then ask the server core for the semantic response.
  Date/Author: 2026-06-21 / Codex.
- Decision: Do not touch `apps/web` for this fix.
  Rationale: The missing `/cradle` behavior is a Slack Socket Mode control path, not a frontend settings bug. If future work changes the web integrations UI, it must use `apps/web/src/api-gen/` generated clients rather than raw HTTP calls.
  Date/Author: 2026-06-21 / Codex, after user reminder.

## Outcomes & Retrospective

The migration gap is closed in source. `packages/plugin-sdk/src/server.ts` now exposes a normalized conversation control host API. `apps/server/src/modules/conversation-bridge/service.ts` owns `/cradle` command semantics, channel binding state, status rendering data, runtime target listing, and model selection. `plugins/slack-conversation-bridge/src/adapter.ts` registers `/cradle` plus status/unbind/runtime/model actions with immediate Slack ACKs and converts server-owned generic blocks into Slack Block Kit.

The old standalone app is no longer required for `/cradle` once the server process is restarted with these changes. Live Slack verification still requires restarting the currently running server/desktop server process so the updated server modules and rebuilt Slack plugin dist are loaded.

## Context and Orientation

The server bridge core lives in `apps/server/src/modules/conversation-bridge`. Its `service.ts` file owns persistence and semantics, `model.ts` owns HTTP schemas, `index.ts` owns Elysia routes, and `runtime-supervisor.ts` starts plugin adapter runtimes and provides host callbacks. The current Slack adapter plugin lives in `plugins/slack-conversation-bridge/src/adapter.ts` and `src/server.ts`. Plugin SDK types live in `packages/plugin-sdk/src/server.ts`.

The old standalone reference implementation lives under `apps/slack-channel-bridge`. Its `src/slack/commands.ts` and `src/slack/session-targets.ts` contain the command and selector behavior that must be migrated. Its private SQLite store must not be reused; integrated behavior must call server-owned `conversation-bridge` service methods.

## Plan of Work

First, extend the plugin SDK `ConversationBridgeHost` with a method for external controls. A control is a normalized request from an adapter, such as a slash command or selected option action. The host returns a platform-neutral response containing text, visibility, replacement intent, and a generic block/action payload that the Slack adapter can render.

Second, implement the server control semantics in `apps/server/src/modules/conversation-bridge/service.ts`. This includes parsing `/cradle` command text, verifying workspaces through the workspace module, creating/removing channel bindings, listing recent thread bindings, listing session targets from agents/provider targets/chat runtimes, and updating the selected runtime/model on an existing binding.

Third, implement Slack-specific rendering and wiring in `plugins/slack-conversation-bridge/src/adapter.ts`. The adapter registers `app.command('/cradle')`, status/unbind actions, and runtime/model select actions. Each handler calls `ack()` before doing work, then calls the host and passes the returned text/blocks to Slack's `respond`.

Fourth, add tests. Server tests should cover command semantics with a fake connection and seeded workspace/runtime target. Slack plugin tests should use fake Slack app and fake host to prove command/action handlers are registered, ACK is called, and semantic responses are sent.

## Concrete Steps

Run all commands from `/Users/wibus/dev/Cradle`.

1. Edit `packages/plugin-sdk/src/server.ts`, `apps/server/src/modules/conversation-bridge/runtime-supervisor.ts`, and `apps/server/src/modules/conversation-bridge/service.ts` to add host control handling.

2. Edit `plugins/slack-conversation-bridge/src/adapter.ts` and add any small helper module needed for Slack Block Kit rendering. Keep plugin-owned code limited to Slack protocol shapes and presentation.

3. Add or update tests:

    pnpm --filter @cradle/server exec vitest run src/modules/conversation-bridge
    pnpm --filter @cradle/slack-conversation-bridge test

4. Run typechecks/builds:

    pnpm --filter @cradle/plugin-sdk typecheck
    pnpm --filter @cradle/server typecheck
    pnpm --filter @cradle/slack-conversation-bridge typecheck
    pnpm --filter @cradle/slack-conversation-bridge build

Commands completed successfully:

    pnpm --filter @cradle/plugin-sdk typecheck
    pnpm --filter @cradle/slack-conversation-bridge typecheck
    pnpm --filter @cradle/server exec vitest run src/modules/conversation-bridge
    pnpm --filter @cradle/slack-conversation-bridge test
    pnpm --filter @cradle/slack-conversation-bridge build
    pnpm --filter @cradle/server typecheck

## Validation and Acceptance

Acceptance requires these observable behaviors:

Running `/cradle status` in Slack against the integrated plugin receives a Slack response instead of "application did not respond." Running `/cradle bind workspace <workspace-id>` creates or updates a `conversation_bridge_channel_bindings` row for the active connection, Slack workspace, and Slack channel. Running `/cradle unbind` removes that channel binding. The runtime and model selectors update the same channel binding defaults used by message events to create new Cradle sessions.

Programmatic validation should prove the same behaviors without real Slack credentials. A server unit test should create a conversation bridge connection, seed a workspace and runtime target, call the new control handler for bind/status/unbind and selector actions, and assert channel binding state changes. A Slack adapter test should assert slash command and action handlers call `ack()` and then `respond(...)`.

## Idempotence and Recovery

The control handlers are idempotent. Binding the same channel repeatedly updates the existing channel binding. Unbinding a missing binding is treated as success and returns a status response showing the channel disconnected. Starting an already running connection remains a no-op in the runtime supervisor. If Slack rendering changes fail tests, revert only the plugin rendering edits and keep server-owned semantic methods intact.

## Artifacts and Notes

Relevant old standalone files:

    apps/slack-channel-bridge/src/slack/commands.ts
    apps/slack-channel-bridge/src/slack/session-targets.ts

Relevant integrated files:

    packages/plugin-sdk/src/server.ts
    apps/server/src/modules/conversation-bridge/service.ts
    apps/server/src/modules/conversation-bridge/runtime-supervisor.ts
    plugins/slack-conversation-bridge/src/adapter.ts

## Interfaces and Dependencies

In `packages/plugin-sdk/src/server.ts`, extend `ConversationBridgeHost` with a callback for normalized controls. The final names may be adjusted during implementation, but the contract must preserve the ownership boundary: adapters submit control input and render the returned presentation; server core owns binding/session semantics.

The Slack adapter continues to use `@slack/bolt` because the integrated adapter already uses it successfully for Socket Mode. Server-side runtime target listing should use existing Cradle service/module APIs rather than inventing new projections.

Revision note 2026-06-21 10:53Z: Created this plan after discovering that the integrated bridge intentionally omitted the old Slack slash command UX and that the running Slack adapter currently handles message events only.

Revision note 2026-06-21 11:05Z: Updated the plan after implementation. Recorded completed server control host, Slack command/action handlers, tests, validation commands, the frontend API generation constraint, and the need to restart the server process for live Slack verification.
