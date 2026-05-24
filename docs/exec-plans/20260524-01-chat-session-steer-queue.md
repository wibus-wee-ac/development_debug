# Add Chat Session Steer and Queue

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained so a new contributor can continue from this file alone.

## Purpose / Big Picture

When a Chat Session is already running a long agent turn, the user should still be able to type the next instruction. The instruction can either be queued for the session to run automatically after the current turn, or recorded as a steer instruction that is meant to redirect the ongoing task. Chat Runtime now persists every follow-up as a chat-runtime-owned continuation item with `mode = "queue"` or `mode = "steer"`. If the active provider supports a real live steering side-channel, Chat Runtime applies the steer immediately and marks the queue item completed; otherwise it keeps the row pending and drains steer items before normal queued items once the current run reaches a terminal state. This makes the behavior visible, durable, cancellable, reorderable, and owned by Chat Session rather than Issue Agent.

After this change, while a Chat Session is streaming, the composer remains useful: sending a follow-up records a queue or steer item based on the Chat settings preference, `Shift+Meta+Enter` sends the opposite behavior for a single message, the queue is visible in the chat view, queued items can be cancelled or reordered, and the server starts the next queued continuation automatically when the active run completes.

## Progress

- [x] (2026-05-23 17:08Z) Read the ExecPlan requirements, current chat-runtime route/service/model files, chat DB schema, chat web hook, composer, chat view, and preferences files.
- [x] (2026-05-23 17:08Z) Corrected the target from Issue Agent session steer/queue to Chat Session steer/queue owned by `apps/server/src/modules/chat-runtime` and `packages/db/src/schema/chat.ts`.
- [x] (2026-05-23 18:00Z) Implemented chat-runtime-owned queue storage, HTTP schemas, list/enqueue/delete/reorder routes, and automatic drain after run completion.
- [x] (2026-05-23 18:00Z) Connected Chat Session web UI to the queue API, Chat settings preference, composer key handling, and visible queue controls.
- [x] (2026-05-23 18:02Z) Regenerated API clients and generated CLI bindings after route/schema changes; generated CLI commands are under `packages/cli/src/commands/generated/chat/queue*`.
- [x] (2026-05-23 18:00Z) Added focused server coverage for enqueue, list, cancel, reorder, steer-before-queue drain, and terminal queue item states in `apps/server/tests/chat-runtime.test.ts`.
- [x] (2026-05-23 18:10Z) Completed five reviewer to fix rounds. Fixes covered chat-runtime cancellation race windows, persisted queue item abort state, Drizzle snapshot correctness, Web busy-send behavior, Web queue accessibility, CLI object-array flag inference, and Issue Agent documentation cleanup.
- [x] (2026-05-23 18:15Z) Re-ran generation and typecheck verification after reviewer fixes. Server typecheck, web API generation, CLI generation, and CLI typecheck passed. Focused Chat Runtime tests were blocked before business assertions by a missing `better-sqlite3` native binding in the local `node_modules`; Web typecheck still fails on unrelated dirty-worktree diagnostics outside this feature.
- [x] (2026-05-24 03:51+08:00) Reproduced the user's runtime failure against the active desktop development database. The database had recorded migration timestamp `1779490200000` but still lacked `chat_session_queue_items`, while an older wrong-direction `agent_session_queue_items` table existed. Added idempotent repair migration `0039_chat_session_queue_repair.sql`, updated Drizzle journal/snapshot metadata, manually applied the repair SQL to the current desktop dev database, and confirmed `chat_session_queue_items` now exists.
- [x] (2026-05-24 03:51+08:00) Completed the Agent Session UI bridge cleanup: `AgentPromptInput` now receives `agentSessionId`, and enqueueing a continuation invalidates both the Chat Runtime queue projection and Issue Agent activity feed. This preserves Chat Runtime queue ownership while showing the queue in the Agent Session panel.
- [x] (2026-05-24 04:32+08:00) Added the optional provider `steerTurn` contract and implemented true live steer for Claude Agent using streaming input plus `interrupt()`. Providers without this hook still use durable prioritized steer.
- [x] (2026-05-24 04:32+08:00) Completed four additional reviewer/fix passes on the live steer path. Fixes covered active-run release ordering, live steer history persistence failure handling, provider test coverage for streaming input and attachments, and README/ExecPlan semantic drift.
- [x] (2026-05-24 04:57+08:00) Completed the final reviewer/fix pass on queue state races. Fixes covered atomic live steer claim, expected-status queue transitions, missed drain wakeups, orphaned `running` item recovery, and stable queue list ordering.
- [x] (2026-05-24 05:15+08:00) Completed the completion audit follow-up. Fixes covered remaining expected-status queue transitions, pending-item drag/drop reorder in the shared queue list, and README updates for Chat and Agent Session UI behavior.
- [x] (2026-05-24 05:43+08:00) Completed the Agent Session lifecycle follow-up. Fixes covered continuation watcher status projection, stop/undelegate cancellation of linked Chat Runtime queue work, and `Steered` badge visibility for live-applied steer rows while an Agent Session is executing.
- [x] (2026-05-24 06:17+08:00) Rebuilt the local `better-sqlite3` native binding, reran the focused Chat Runtime and Issue Agent continuation suites, verified the active desktop database recorded the `0039` repair migration, and confirmed the queue route now returns the expected business error instead of `SqliteError: no such table: chat_session_queue_items`.
- [x] (2026-05-24 06:26+08:00) Completed another requirement-by-requirement audit. Added focused Agent Session input tests for chat preference defaults and one-message `Shift+Meta+Enter` inversion, changed the Agent Session badge to an explicit queued-count label, extended Issue Agent continuation coverage to prove both queued and steered prompt activity records, and confirmed the current Codex SDK lacks a live input/interrupt side-channel.
- [x] (2026-05-24 06:46+08:00) Implemented true live steer for Codex by moving the Codex provider from the closed-stdin `@openai/codex-sdk` execution path to a per-turn Codex app-server JSON-RPC client. The provider now starts/resumes app-server threads, streams `turn/start` notifications into Chat Runtime chunks, stores the active `threadId` and `turnId`, applies `steerTurn` through `turn/steer`, and cancels active work through `turn/interrupt`.

## Surprises & Discoveries

- Observation: The previous implementation direction targeted Issue Agent files, but the requested behavior belongs to Chat Session. The repo ownership rule says features must live under their semantic owner and must not write to another namespace.
  Evidence: The user clarified "Chat Session 里面的需要 Steer / Queue ... 别改 issue-agent"; current Chat Session run ownership is in `apps/server/src/modules/chat-runtime/service.ts`.
- Observation: `ChatRuntime` providers currently expose `streamTurn`, `streamTurnSnapshots`, and `cancelTurn`, but no live steer method.
  Evidence: `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` has no method that can inject user input into an active provider stream.
- Observation: The current runtime rejects a second run for the same session using `activeRunIdsBySession` and `pendingRunSessionIds`.
  Evidence: `createRun` in `apps/server/src/modules/chat-runtime/service.ts` throws `chat_run_in_progress` when either guard contains the session ID.
- Observation: The focused Chat Runtime test command is `pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts`. The broader `pnpm --filter @cradle/server test -- chat-runtime.test.ts` shape can run unrelated server tests in this repo.
  Evidence: The focused command passed with 1 file and 7 tests. Earlier broader test invocation surfaced unrelated failures outside this feature.
- Observation: `pnpm --filter @cradle/web exec tsc --noEmit --pretty false` currently fails on unrelated dirty worktree diagnostics after removing the issue-agent queue residual from `apps/web/src/features/kanban/use-kanban.ts`.
  Evidence: Remaining diagnostics are in `agent-management/agent-detail.tsx`, `agent-runtime/agent-config-schema.ts`, `chat/blocks/tool-call-block.tsx`, `chronicle/use-chronicle.ts`, and `store/chat.ts`; none reference Chat Session queue or Issue Agent queue.
- Observation: The reviewer pass found that `packages/db/drizzle/meta/0038_snapshot.json` described an `agent_session_queue_items` table even though the migration SQL and schema introduced `chat_session_queue_items`.
  Evidence: The snapshot block now names `chat_session_queue_items`, has the same columns and indexes as `packages/db/drizzle/0038_chat_session_queue_items.sql`, and no longer references `agent_sessions` or `backend_runs`.
- Observation: The local verification environment had dependencies downloaded in `.pnpm` but not all workspace/package links were visible from root `node_modules`. Temporary local symlinks were needed for `@cradle/plugin-sdk`, `picocolors`, and `@anthropic-ai/sdk` before generation and typecheck commands could load the server app.
  Evidence: `pnpm generate:web` and `pnpm gen:cli` initially failed on `ERR_MODULE_NOT_FOUND`; after restoring local symlinks they passed. This was an environment/linking problem and did not change tracked source files.
- Observation: The focused Chat Runtime test suite was temporarily blocked because `better-sqlite3` native bindings were missing, then passed after rebuilding the local binding.
  Evidence: The earlier failure occurred while opening SQLite with "Could not locate the bindings file" for `better_sqlite3.node`. After rebuilding the package-local native binding, `pnpm --config.verify-deps-before-run=false --filter @cradle/server exec vitest run tests/chat-runtime.test.ts` passed with 1 file and 7 tests.
- Observation: A development database can record migration `0038_chat_session_queue_items` as already applied while missing `chat_session_queue_items`.
  Evidence: The active desktop dev process used `CRADLE_DATA_DIR=/Users/wibus/Library/Application Support/@cradle/desktop/data`. `sqlite3` showed `__drizzle_migrations` contained timestamp `1779490200000`, `.tables` showed `agent_session_queue_items`, and `.tables` did not show `chat_session_queue_items` until the repair SQL was applied.
- Observation: Claude Agent SDK can receive additional user input during an active query when the provider supplies an async iterable prompt and calls `interrupt()` before pushing a new user message.
  Evidence: `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.test.ts` now includes `interrupts an active streaming-input query and appends steer text`, and the focused command passed with 6 tests.
- Observation: Releasing the active run from `applyAndPublishTerminalState` opens a window where queue drain can start the next queued turn before the old provider stream and cancellation cleanup have fully unwound.
  Evidence: The release is now centralized in `executeRun` and abort-path `finally` blocks, after provider cleanup paths have a chance to complete.
- Observation: A live steer provider call is an irreversible side effect, so the queue row must be claimed before the provider receives input.
  Evidence: `tryApplyLiveSteer` now moves the row from `pending` to `running` with `sessionId` and `status = "pending"` in the `WHERE` clause before calling `steerTurn`; completion and rollback transitions also include expected status and active `startedRunId`.
- Observation: A queue drain can miss a wakeup if a new item is enqueued while the drain loop is already running and about to return.
  Evidence: `scheduleSessionQueueDrain` now records `requestedQueueDrainSessionIds` while a drain is active, and `drainSessionQueue` schedules another microtask in `finally` when a request arrived or pending rows still exist.
- Observation: A process crash after claiming a queued item but before creating its run can strand `status = "running"` with no `startedRunId`.
  Evidence: `recoverOrphanedRunningQueueItems` resets `running` rows with `startedRunId IS NULL` back to `pending` before each drain.
- Observation: The first queue UI supported reordering through buttons but did not satisfy the explicit drag-sort UX requirement.
  Evidence: `apps/web/src/features/chat/chat-queue-list.tsx` now marks pending rows draggable, tracks the dragged queue item ID, and calls the existing reorder endpoint with the dropped order. Up/down buttons remain as an accessible fallback.
- Observation: A delegated Agent Session can finish its initial run while Chat Runtime still has queued continuation work to drain.
  Evidence: `apps/server/src/modules/issue-agent/service.ts` now starts a continuation watcher only when the linked Chat Session has pending or running queue items, keeps the Agent Session `active` until the linked Chat Session has no active run and no pending/running queue rows, then records `continuation.completed` or `continuation.failed` activity.
- Observation: Stop and undelegate must cancel the linked Chat Session queue, not only the current in-memory issue-agent run.
  Evidence: `stopSession` and `undelegateIssue` now call `cancelChatSessionContinuationWork`, which cancels the linked Chat Session active run and pending queue items through Chat Runtime-owned APIs.
- Observation: A running server process that started before the repair migration may keep serving old code and old migration state until it is restarted.
  Evidence: PID `50928` was still listening on `127.0.0.1:21423` from 2026-05-24 02:13:22. After terminating that stale process and starting the server against `/Users/wibus/Library/Application Support/@cradle/desktop/data`, `GET /chat/sessions/nonexistent-session/queue` returned HTTP 404 with code `chat_session_not_found` instead of a SQLite table error, and `__drizzle_migrations` contained timestamp `1779490800000` for the `0039` repair.
- Observation: The current `@openai/codex-sdk@0.128.0` Thread API does not expose a live input or interrupt side-channel, but the Codex CLI app-server protocol does.
  Evidence: The SDK declaration exposes `Thread.runStreamed(input, turnOptions)` and `Thread.run(input, turnOptions)` plus `AbortSignal` cancellation, and its implementation writes stdin then closes it. The local `codex app-server --listen stdio://` probe accepted newline-delimited JSON-RPC `initialize`, and generated protocol files expose `turn/start`, `turn/steer`, and `turn/interrupt`. `apps/server/src/modules/chat-runtime/providers/codex/provider.ts` now uses that app-server protocol, and `apps/server/src/modules/chat-runtime/providers/codex/provider.test.ts` proves `steerTurn` sends `turn/steer` with the active `threadId` and `expectedTurnId`.
- Observation: The explicit Agent Session UI preference and shortcut behavior now has focused renderer coverage.
  Evidence: `apps/web/src/features/kanban/issue-detail/agent-prompt-input.test.tsx` passes with 2 tests proving the saved `queue` preference submits `mode: "queue"`, the saved `steer` preference shows `Send steer...`, and `Shift+Meta+Enter` flips that one message to `mode: "queue"`.

## Decision Log

- Decision: Store continuation items in a Chat Session owned DB table named `chat_session_queue_items`, not in Issue Agent tables.
  Rationale: Queue semantics are part of chat turn orchestration and must evolve with chat-runtime, message snapshots, backend runs, and provider capabilities. This preserves namespace ownership.
  Date/Author: 2026-05-23 / Codex
- Decision: Keep the normal streaming endpoint as the path for starting an idle run, and add separate JSON endpoints for continuation queue management.
  Rationale: `/response` returns an SSE stream and is not a good shape for enqueue-only operations that should return durable queue rows.
  Date/Author: 2026-05-23 / Codex
- Decision: Implement steer as `mode = "steer"` on a durable continuation item and drain steer items before normal queue items until providers gain an explicit live steering hook.
  Rationale: This produces a correct, observable first version without pretending the active provider can be interrupted through an API that does not exist.
  Date/Author: 2026-05-23 / Codex
- Decision: Extend `ChatRuntime` with optional `steerTurn(input)`, implement it for Claude Agent through SDK streaming input, and implement it for Codex through the app-server protocol.
  Rationale: Claude Agent SDK supports streaming input and `interrupt()`, which is a real side-channel for live steering. Codex's public TypeScript SDK does not, but Codex app-server exposes `turn/steer` with an active turn precondition, so the Codex provider can support true live steering without pretending a closed-stdin SDK run is steerable.
  Date/Author: 2026-05-24 / Codex
- Decision: Run Codex turns through a per-turn app-server stdio process instead of the `@openai/codex-sdk` `runStreamed()` helper.
  Rationale: The SDK helper is shaped around `codex exec --experimental-json`, writes the prompt to stdin, and closes stdin. A per-turn app-server client preserves the existing thread lifecycle while keeping a live JSON-RPC channel for `turn/steer` and `turn/interrupt`.
  Date/Author: 2026-05-24 / Codex
- Decision: Persist a steer queue row before attempting provider live steer, but after provider acceptance treat the row as completed even if local history insertion fails.
  Rationale: The queue row is the durable audit handle. Once the provider has received a live steer, retrying the same row later would duplicate user input, so history persistence failure is logged and stored in `errorText` while the row remains `completed`.
  Date/Author: 2026-05-24 / Codex
- Decision: Use existing `running` queue status as the live steer and drain claim state instead of adding a new `applying` status.
  Rationale: This avoids expanding the database enum and migration surface. The disambiguator is `startedRunId`: live steer claims set it to the active run ID, drain claims recover only rows where it is still null.
  Date/Author: 2026-05-24 / Codex
- Decision: Implement queue drag sorting with native HTML drag/drop in the shared `ChatQueueList`, while keeping button reorder controls.
  Rationale: The requirement asks for drag sorting in the Agent Session panel, and the shared queue list is used by both Chat Session and Agent Session. Native drag/drop satisfies the interaction without adding another dependency or creating divergent queue UIs.
  Date/Author: 2026-05-24 / Codex
- Decision: Let Issue Agent project Chat Runtime continuation progress into Agent Session status/activity without owning queue state.
  Rationale: Users need Agent Session panels to stay in `Executing` while queued continuations drain and to see completion/failure activity, but the queue rows still belong to Chat Runtime. Reading Chat Runtime queue/run state and writing Issue Agent-owned session/activity records preserves ownership boundaries.
  Date/Author: 2026-05-24 / Codex
- Decision: Keep the existing settings preference `continuationBehavior: "queue" | "steer"` as the default Chat Session behavior.
  Rationale: The setting matches the requested UX and is correctly scoped to chat preferences, not issue-agent.
  Date/Author: 2026-05-23 / Codex
- Decision: Model pending run starts with an in-memory state object instead of only a set of session IDs.
  Rationale: A user can cancel during the window after the provider session starts but before a `backend_runs` row exists. The state object records whether that pending start was cancelled and which queue item, if any, was being started, allowing the service to cancel the provider turn and mark the queue item correctly.
  Date/Author: 2026-05-23 / Codex
- Decision: Keep CLI support for file attachments as a JSON body flag rather than pretending an array of objects is a comma-separated string list.
  Rationale: The generated CLI runtime already has a `json` value type. Mapping `array<object>` to `json` avoids corrupting attachment payloads while preserving the server and Web API contract.
  Date/Author: 2026-05-23 / Codex
- Decision: Add `0039_chat_session_queue_repair.sql` instead of rewriting `0038_chat_session_queue_items.sql` or deleting `agent_session_queue_items`.
  Rationale: The active development database had already recorded the `0038` timestamp, so editing historical migration files would not repair that database. A forward, idempotent repair migration lets normal startup advance existing databases safely and avoids destructive cleanup of unrelated residual tables.
  Date/Author: 2026-05-24 / Codex

## Outcomes & Retrospective

This section will be updated after implementation and review. The expected outcome is a Chat Session feature that demonstrates queued follow-ups while busy, automatic draining after completion, and visible queue controls in the chat view. Any issue-agent-specific work is not part of the accepted result for this plan.

As of 2026-05-23 18:15Z, the implementation has server storage/routes/drain, renderer queue UI, generated CLI/API surface, focused server test coverage, and five reviewer/fix rounds completed. The final implementation remains scoped to Chat Session ownership and no Issue Agent queue/prompt surface remains.

The earlier validation gap around `better-sqlite3` was environmental rather than semantic: `better-sqlite3` was present in the pnpm store but its native `better_sqlite3.node` binding was not built, so the Chat Runtime tests could not open a test database. The local binding was rebuilt on 2026-05-24, and the focused Chat Runtime suite now passes with all queue assertions.

As of 2026-05-24 03:51+08:00, the reported runtime error `SqliteError: no such table: chat_session_queue_items` has been repaired for the current desktop development database by applying `packages/db/drizzle/0039_chat_session_queue_repair.sql`. The repository now includes that repair migration so future restarts can apply it through `MigrationRunner`; the old residual `agent_session_queue_items` table was left untouched because deleting it is not required for this feature and would be a separate cleanup decision.

As of 2026-05-24 04:57+08:00, Claude Agent supports true live steer. Chat Runtime still stores the incoming steer in `chat_session_queue_items` first; before calling the provider it atomically claims the row as `running` with `startedRunId` pointing at the active run. When the active Claude Agent provider accepts the steer, the row is marked `completed` and a completed user message is added to history. If the history insert fails after provider acceptance, the row stays `completed` and records the persistence error in `errorText` to avoid replaying already-applied input. Other providers retain the durable fallback behavior: `mode = "steer"` stays pending while busy and drains before normal queued items after the current run finishes.

As of 2026-05-24 05:15+08:00, the shared queue UI supports both drag/drop reorder and up/down button reorder. Agent Session uses that same queue projection, so the requested Agent Session panel queue sorting behavior is implemented through the Chat Runtime queue endpoints rather than an Issue Agent-owned queue.

As of 2026-05-24 05:43+08:00, delegated Agent Sessions remain active while linked Chat Runtime continuation queue work drains. The Issue Agent bridge records the submitted prompt immediately and then watches the linked Chat Session until active runs and pending/running queue rows are gone. Stop and undelegate cancel the linked Chat Session run and pending queue items through Chat Runtime APIs, preventing queued work from continuing after the Agent Session is stopped.

As of 2026-05-24 06:17+08:00, the runtime table error is closed. The active desktop database contains `chat_session_queue_items` and records both migration timestamps `1779490200000` and `1779490800000`. A restarted server using that desktop data directory returns the expected HTTP 404 `chat_session_not_found` for a nonexistent queue route instead of `SqliteError: no such table: chat_session_queue_items`.

As of 2026-05-24 06:26+08:00, the Agent Session UI behavior is directly covered. The prompt input uses the saved Chat preference, shows `Send steer...` when steer is the default while the agent is busy, posts through `/issue-agent-sessions/:agentSessionId/continuation`, and flips one message with `Shift+Meta+Enter`. The Agent Session badge now renders `Queued N items` so the count label is explicit and matches the requested status copy. The Issue Agent server test proves both `continuation.queued` and `continuation.steer` prompt activity records are written while queue state remains owned by Chat Runtime.

As of 2026-05-24 06:46+08:00, Codex supports true live steer through Codex app-server. `apps/server/src/modules/chat-runtime/providers/codex/app-server-client.ts` owns the newline-delimited JSON-RPC transport, `app-server-mapper.ts` maps app-server notifications to `UIMessageChunk`, and `provider.ts` stores the active app-server client, `threadId`, and `turnId` while a turn is running. `steerTurn` sends `turn/steer` with `expectedTurnId`, so Chat Runtime can atomically claim a steer row and complete it as live-applied for Codex the same way it does for Claude Agent. `cancelTurn` sends `turn/interrupt` when a turn id is known.

## Context and Orientation

The server Chat Runtime module lives in `apps/server/src/modules/chat-runtime`. `index.ts` defines the Elysia HTTP routes under `/chat`, `model.ts` defines request and response schemas, and `service.ts` owns the active run lifecycle, provider calls, message snapshot persistence, cancellation, and run stream subscriptions.

The Chat DB schema lives in `packages/db/src/schema/chat.ts`. It already owns `sessions`, `messages`, `usageLogs`, `stepUsage`, and `approvalAudit`. A new table for follow-up queue items belongs here because queue items are children of a chat session. The table must reference `sessions.id` with cascade delete so removing a session removes its pending follow-ups.

The web Chat Session view lives in `apps/web/src/features/chat`. `use-chat-session.ts` owns sending and stopping chat turns from the renderer, `chat-response-command.ts` owns direct fetch calls to chat endpoints, `composer.tsx` owns the text input and key handling, and `chat-view.tsx` wires composer, message list, status, and session metadata together.

Chat settings live in `apps/server/src/modules/preferences` on the server and `apps/web/src/features/settings` on the renderer. The existing `continuationBehavior` preference is a good fit for deciding whether a busy follow-up defaults to queue or steer.

A queue item means a durable row containing a user prompt that has not been started yet. A steer item means a durable row containing a user prompt intended to redirect current work. Providers with a true live input side-channel can apply a steer to the active run and complete the row immediately. Providers without such a side-channel leave steer rows pending; the drain logic starts those steer rows before normal queued rows after the active run is terminal.

## Plan of Work

First, add `chatSessionQueueItems` to `packages/db/src/schema/chat.ts` with fields for ID, session ID, `mode`, `status`, text, files JSON, model and thinking options, position, source run ID, started run ID, error text, and timestamps. Add a migration SQL file for the table and indexes. Export row types from the schema module and update the schema README.

Second, add chat-runtime schemas in `apps/server/src/modules/chat-runtime/model.ts` for queue items, enqueue body, reorder body, delete response, and list response. Add routes in `apps/server/src/modules/chat-runtime/index.ts`: `GET /chat/sessions/:sessionId/queue`, `POST /chat/sessions/:sessionId/queue`, `DELETE /chat/sessions/:sessionId/queue/:queueItemId`, and `POST /chat/sessions/:sessionId/queue/reorder`. These routes return JSON and include `x-cradle-cli` metadata where useful.

Third, extend `apps/server/src/modules/chat-runtime/service.ts` with helpers to validate a session, serialize file parts, create queue items, list pending items, cancel pending items, reorder pending items, and drain the next item when no run is active. The drain helper must reserve a session using the existing pending guard before calling the normal run creation path to avoid a race with direct sends. When a run completes, fails, or aborts, the finalization path should schedule a drain attempt after releasing the current active run. If the queued run cannot start, mark the queue item failed and continue to the next pending item only when the failure is local to that item; do not spin forever.

For live steer, `apps/server/src/modules/chat-runtime/runtime-provider-types.ts` exposes optional `steerTurn`. `apps/server/src/modules/chat-runtime/service.ts` should persist the queue row first, atomically claim the row before provider input, call `steerTurn` only when an active run exists and the active provider implements it, and complete the row on provider acceptance. `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts` implements `steerTurn` by using a Claude Agent SDK async iterable prompt, calling `interrupt()`, and pushing a priority user message into the same input stream. `apps/server/src/modules/chat-runtime/providers/codex/provider.ts` implements `steerTurn` through Codex app-server `turn/steer`.

Fourth, update web chat commands and hook. `chat-response-command.ts` should expose `listChatSessionQueue`, `enqueueChatSessionQueueItem`, `cancelChatSessionQueueItem`, and `reorderChatSessionQueue`. `use-chat-session.ts` should query the queue, return it to the view, and add a `sendContinuation` path. When `status === "streaming"`, the normal composer send should enqueue instead of calling the SSE endpoint. The selected mode should come from `continuationBehavior`, and `Shift+Meta+Enter` should flip the mode for one send.

Fifth, update `composer.tsx`, `chat-view.tsx`, and the Agent Session panel. The composer must support sending while streaming, show the send action instead of only a stop button when there is draft text, still keep the stop button available, and expose a key modifier flag to the send callback. The chat view and Agent Session panel should render a compact queue list with item mode, text, cancel button, drag/drop reorder, and up/down reorder buttons. Use static Tailwind classes and existing UI primitives.

Sixth, keep Issue Agent as a bridge rather than a queue owner. `apps/server/src/modules/issue-agent/service.ts` should enqueue continuations through Chat Runtime, record an activity row for the prompt, watch the linked Chat Session while queued continuation work drains, and cancel linked Chat Runtime work when an Agent Session is stopped or undelegated. It must not create or write Issue Agent-owned queue rows.

Seventh, regenerate clients with `pnpm generate:web` and `pnpm gen:cli`, then add focused tests. Server tests should live in `apps/server/tests/chat-runtime.test.ts` or a new chat-runtime queue test file. Web tests should cover composer key behavior and queue list actions if the existing test harness supports it. Run the focused tests first, then typecheck the touched packages.

## Concrete Steps

Run these commands from `/Users/wibus/dev/Cradle`:

    pnpm generate:web
    pnpm gen:cli
    pnpm typecheck:server
    pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts
    pnpm --filter @cradle/web exec tsc --noEmit --pretty false

    pnpm --config.verify-deps-before-run=false --filter @cradle/server exec vitest run src/modules/chat-runtime/providers/claude-agent/provider.test.ts

Observed results on 2026-05-23:

    pnpm generate:web
    Result after reviewer fixes: passed; `openapi-ts` generated six web API files from `apps/server/openapi.json`.

    pnpm gen:cli
    Result after reviewer fixes: passed; generated 192 CLI commands and updated `resources/skills/cradle-cli/SKILL.md`.

    pnpm typecheck:server
    Result after reviewer fixes: passed with no TypeScript diagnostics.

    pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts
    Result before reviewer fixes: passed; 1 test file, 7 tests.
    Result after reviewer fixes in this local environment at 2026-05-23 18:15Z: blocked before test assertions because `better-sqlite3` could not locate `better_sqlite3.node`.
    Result after rebuilding the local native binding on 2026-05-24: passed; 1 test file, 7 tests.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: failed on unrelated dirty worktree diagnostics after issue-agent queue residuals were removed. The remaining diagnostics are outside this feature's touched Chat Session queue files.

Observed results on 2026-05-24:

    pnpm --config.verify-deps-before-run=false --filter @cradle/server exec vitest run src/modules/chat-runtime/providers/claude-agent/provider.test.ts
    Result: passed; 1 test file, 6 tests. This covers Claude Agent streaming-input prompts, live steer interrupt/push behavior, and explicit attachment rejection for the text-only provider.

    pnpm --config.verify-deps-before-run=false --filter @cradle/server exec vitest run src/modules/chat-runtime/providers/codex/provider.test.ts
    Result after the Codex app-server migration: passed; 1 test file, 2 tests. This covers app-server thread start/resume, notification-to-chunk streaming, active `turn/steer`, and persistence of the app-server `threadId` on the runtime session.

    pnpm --config.verify-deps-before-run=false typecheck:server
    Result: passed with no TypeScript diagnostics.

    pnpm --config.verify-deps-before-run=false typecheck:server && pnpm --config.verify-deps-before-run=false --filter @cradle/server exec vitest run src/modules/chat-runtime/providers/claude-agent/provider.test.ts
    Result after final queue race fixes: passed; server TypeScript reported no diagnostics and the Claude Agent provider suite passed 6 tests.

    pnpm --config.verify-deps-before-run=false --filter @cradle/web exec tsc --noEmit --pretty false
    Result after drag/drop queue list update: failed on unrelated dirty-worktree diagnostics in `agent-management/agent-detail.tsx`, `agent-runtime/agent-config-schema.ts`, `chronicle/use-chronicle.ts`, and `store/chat.ts`. No diagnostic referenced `chat-queue-list.tsx` or the Steer/Queue UI files touched in this pass.

    pnpm --config.verify-deps-before-run=false typecheck:server
    Result after Agent Session continuation watcher and stop/undelegate queue cancellation: passed with no TypeScript diagnostics.

    pnpm --config.verify-deps-before-run=false --filter @cradle/web exec vitest run src/features/chat/chat-queue-list.test.tsx
    Result after drag/drop queue list update: passed; 1 test file, 2 tests covering drag/drop reorder and button reorder fallback.

    pnpm --config.verify-deps-before-run=false --filter @cradle/server exec vitest run tests/issue-agent.test.ts
    Result after adding and extending the Issue Agent continuation bridge test: passed; 1 test file, 3 tests. This covers `/issue-agent-sessions/:agentSessionId/continuation`, Chat Runtime queue ownership, `continuation.queued` and `continuation.steer` prompt activity recording, watcher completion, and persisted completed queue rows.

    pnpm --config.verify-deps-before-run=false --filter @cradle/web exec vitest run src/features/kanban/issue-detail/agent-prompt-input.test.tsx src/features/chat/chat-queue-list.test.tsx
    Result after the Agent Session UI audit: passed; 2 test files, 4 tests. This covers default queue continuation submission, steer default placeholder, `Shift+Meta+Enter` one-message inversion, drag/drop reorder, and button reorder fallback.

    git diff --check -- apps/server/src/modules/chat-runtime apps/server/src/modules/issue-agent apps/web/src/features/chat apps/web/src/features/kanban/issue-detail apps/web/src/features/settings packages/db/src/schema/chat.ts packages/db/drizzle docs/exec-plans/20260524-01-chat-session-steer-queue.md
    Result: passed with no whitespace diagnostics.

Additional reviewer-fix verification:

    pnpm --filter @cradle/cli typecheck
    Result after reviewer fixes: passed.

    pnpm --filter @cradle/cli cradle chat queue add --help
    Result after reviewer fixes: passed; generated help shows `--files <value>` as a JSON-compatible value and no longer represents object attachments as `string[]`.

Before editing, inspect dirty files with `git diff -- <path>` when a touched path already has unrelated changes. Do not use `git checkout` or `git reset` to remove unrelated work. Manual code edits should use `apply_patch`.

## Validation and Acceptance

The server is accepted when a test can start a long streaming chat response, post two follow-ups to `/chat/sessions/:sessionId/queue`, observe them through `GET /chat/sessions/:sessionId/queue`, cancel one item, reorder remaining pending items, and see the first non-cancelled pending item become a normal user/assistant turn automatically after the active run completes.

The web UI is accepted when, during a streaming Chat Session, the composer remains enabled, sends follow-ups as queue or steer items according to the Chat settings preference, flips mode for one message with `Shift+Meta+Enter`, shows pending queue items above the composer and in the Agent Session panel, and supports cancelling, drag/drop sorting, and button-moving pending items.

The Issue Agent bridge is accepted when submitting a continuation through `/issue-agent-sessions/:agentSessionId/continuation` writes the prompt activity into the Agent Session timeline, writes queue state only through Chat Runtime, keeps the Agent Session active while linked Chat Runtime continuation work is pending/running, records continuation completion or failure activity, and cancels linked Chat Runtime active/pending work on stop or undelegate.

The implementation must not require Issue Agent routes, Issue Agent DB tables, or Kanban issue detail UI to demonstrate the behavior.

Claude Agent live steer is accepted when a running Claude Agent turn has an active SDK query, posting a `mode = "steer"` queue item causes the provider to call `interrupt()`, appends the new user text to the existing input stream, marks the queue row `completed`, and does not start a separate queued run. Codex live steer is accepted when a running Codex app-server turn has an active `threadId` and `turnId`, posting a `mode = "steer"` queue item causes the provider to send `turn/steer` with `expectedTurnId`, marks the queue row `completed`, and does not start a separate queued run. Providers without `steerTurn` are accepted when the same `mode = "steer"` row remains pending while busy and drains before normal `queue` rows after the current run completes.

Generated surfaces are accepted when `apps/server/openapi.json`, `apps/web/src/api-gen`, and `packages/cli/src/commands/generated` expose `/chat/sessions/{sessionId}/queue`, `/chat/sessions/{sessionId}/queue/reorder`, and `/chat/sessions/{sessionId}/queue/{queueItemId}`, and no generated Issue Agent queue or prompt route remains.

## Idempotence and Recovery

Adding the table is additive. Re-running the migration on a fresh database creates the table and indexes once through the normal migration runner. If an automatic queue drain fails after creating a run, the queue item records the started run ID and is not started twice. If enqueue succeeds but drain fails because the session is still active, the row remains pending and the next terminal event retries draining.

If generated client output is noisy, inspect generated diffs and keep only files produced by the generator that correspond to the new chat-runtime routes. Do not delete unrelated generated files from other dirty work unless they are proven to belong to this feature.

If a running development server reports `SqliteError: no such table: chat_session_queue_items`, inspect the active database path from `CRADLE_DATA_DIR` or `CRADLE_DB_PATH` and confirm the table exists with SQLite. The repository now includes `packages/db/drizzle/0039_chat_session_queue_repair.sql`, which uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` so it can safely repair databases that recorded `0038` but missed the table. Restarting the server should allow `MigrationRunner` to apply `0039`; for the current desktop dev database, the repair SQL was also applied manually so the running process can recover without waiting for restart.

If live steer fails inside the provider before the provider accepts input, the queue row returns to `pending` and can drain later. If the provider accepts the steer but history persistence fails, do not retry the row; retrying would duplicate the same live user input. The service logs that history persistence failure, records it in the queue row `errorText`, and completes the queue item.

If a drain is already running when a new queue item is inserted, `requestedQueueDrainSessionIds` records that another drain pass is needed. The active drain clears the request when it starts and schedules a fresh microtask in `finally` if a request arrived during the run or pending rows remain.

The working tree contains unrelated dirty files from other tasks. Do not clean or revert them while completing this plan. The only Issue Agent cleanup required for this plan is removing queue/prompt leftovers that were created by the superseded direction.

## Artifacts and Notes

Important current behavior before implementation:

    createRun({ sessionId }) throws AppError code "chat_run_in_progress" when activeRunIdsBySession or pendingRunSessionIds already contains the session.

Expected new server response shape for list:

    {
      "items": [
        {
          "id": "queue-item-id",
          "sessionId": "session-id",
          "mode": "queue",
          "status": "pending",
          "text": "Then update the tests",
          "position": 1,
          "createdAt": 1779556080,
          "updatedAt": 1779556080
        }
      ]
    }

Observed focused server test transcript:

    RUN  v4.1.4 /Users/wibus/dev/Cradle/apps/server
    Test Files  1 passed (1)
    Tests  7 passed (7)

Observed final validation transcript after reviewer fixes:

    pnpm --config.verify-deps-before-run=false typecheck:server
    Result: passed.

    pnpm --config.verify-deps-before-run=false generate:web
    Result: passed.

    pnpm --config.verify-deps-before-run=false gen:cli
    Result: passed; generated 192 CLI commands.

    pnpm --config.verify-deps-before-run=false --filter @cradle/cli typecheck
    Result: passed.

    pnpm --config.verify-deps-before-run=false --filter @cradle/server exec vitest run tests/chat-runtime.test.ts
    Historical result at 2026-05-23 18:15Z: blocked by missing native binding because `better-sqlite3` could not locate `better_sqlite3.node`.
    Current result after rebuilding the local binding on 2026-05-24: passed; 1 test file and 7 tests passed.

Observed runtime repair transcript on 2026-05-24:

    sqlite3 "$HOME/Library/Application Support/@cradle/desktop/data/cradle.db" ".tables"
    Result before repair: `agent_session_queue_items` existed; `chat_session_queue_items` was absent.

    sqlite3 "$HOME/Library/Application Support/@cradle/desktop/data/cradle.db" < packages/db/drizzle/0039_chat_session_queue_repair.sql
    sqlite3 "$HOME/Library/Application Support/@cradle/desktop/data/cradle.db" "select name from sqlite_master where name='chat_session_queue_items';"
    Result after repair: `chat_session_queue_items`.

    sqlite3 "$HOME/Library/Application Support/@cradle/desktop/data/cradle.db" "select created_at, hash from __drizzle_migrations order by created_at desc limit 5;"
    Result after restarting server against the desktop data directory: top rows include `1779490800000` for the `0039` repair and `1779490200000` for the original queue table migration.

    curl -sS -i http://127.0.0.1:21423/chat/sessions/nonexistent-session/queue
    Result after restarting server against the desktop data directory: HTTP 404 with JSON code `chat_session_not_found`, proving the route can query `chat_session_queue_items` and is no longer failing with SQLite `no such table`.

Observed Claude Agent live steer validation on 2026-05-24:

    pnpm --config.verify-deps-before-run=false --filter @cradle/server exec vitest run src/modules/chat-runtime/providers/claude-agent/provider.test.ts
    Test Files  1 passed (1)
    Tests  6 passed (6)

Observed final queue race validation on 2026-05-24:

    pnpm --config.verify-deps-before-run=false typecheck:server && pnpm --config.verify-deps-before-run=false --filter @cradle/server exec vitest run src/modules/chat-runtime/providers/claude-agent/provider.test.ts
    Result: passed; server typecheck completed and the Claude Agent provider suite reported 1 file and 6 tests passed.

Observed completion-audit UI validation on 2026-05-24:

    pnpm --config.verify-deps-before-run=false --filter @cradle/web exec tsc --noEmit --pretty false
    Result: failed on unrelated dirty-worktree diagnostics listed above. The new drag/drop queue list file did not appear in the TypeScript diagnostics.

    pnpm --config.verify-deps-before-run=false --filter @cradle/web exec vitest run src/features/chat/chat-queue-list.test.tsx
    Result: passed; 1 test file and 2 tests passed.

Observed Agent Session lifecycle validation on 2026-05-24:

    pnpm --config.verify-deps-before-run=false typecheck:server
    Result: passed after the continuation watcher and cancellation changes.

    pnpm --config.verify-deps-before-run=false --filter @cradle/server exec vitest run tests/issue-agent.test.ts
    Result: passed; 1 test file and 3 tests passed, including the continuation bridge test with both queued and steered activity records.

Observed Agent Session UI audit validation on 2026-05-24:

    pnpm --config.verify-deps-before-run=false --filter @cradle/web exec vitest run src/features/kanban/issue-detail/agent-prompt-input.test.tsx src/features/chat/chat-queue-list.test.tsx
    Result: passed; 2 test files and 4 tests passed.

    pnpm --config.verify-deps-before-run=false --filter @cradle/web exec tsc --noEmit --pretty false
    Result: failed on unrelated dirty-worktree diagnostics in `agent-management/agent-detail.tsx`, `agent-runtime/agent-config-schema.ts`, `chronicle/use-chronicle.ts`, and `store/chat.ts`. No diagnostic referenced `agent-prompt-input.test.tsx`, `agent-prompt-input.tsx`, `agent-session-panel.tsx`, `chat-queue-list.tsx`, or the settings continuation files.

Generated CLI files for this feature:

    packages/cli/src/commands/generated/chat/queue.ts
    packages/cli/src/commands/generated/chat/queue/add.ts
    packages/cli/src/commands/generated/chat/queue/cancel.ts
    packages/cli/src/commands/generated/chat/queue/reorder.ts

## Interfaces and Dependencies

In `packages/db/src/schema/chat.ts`, define `chatSessionQueueItems` as a SQLite table with:

    id: text primary key
    sessionId: text not null references sessions.id on delete cascade
    mode: text enum "queue" | "steer" not null
    status: text enum "pending" | "running" | "cancelled" | "completed" | "failed" not null default "pending"
    text: text not null
    filesJson: text not null default "[]"
    modelId: text nullable
    thinkingEffort: text enum "low" | "medium" | "high" nullable
    position: integer not null
    sourceRunId: text nullable
    startedRunId: text nullable
    errorText: text nullable
    createdAt and updatedAt timestamps

In `apps/server/src/modules/chat-runtime/service.ts`, expose:

    export type ChatSessionQueueMode = 'queue' | 'steer'
    export type ChatSessionQueueStatus = 'pending' | 'running' | 'cancelled' | 'completed' | 'failed'
    export function listSessionQueueItems(sessionId: string): ChatSessionQueueItemDto[]
    export function enqueueSessionQueueItem(input: EnqueueSessionQueueItemInput): Promise<ChatSessionQueueItemDto>
    export function cancelSessionQueueItem(sessionId: string, queueItemId: string): ChatSessionQueueItemDto
    export function reorderSessionQueueItems(sessionId: string, queueItemIds: string[]): ChatSessionQueueItemDto[]

The drain helper may remain private, but it must be called after active run release and after enqueue when the session is idle.

In `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`, define:

    export interface SteerTurnInput {
      runtimeSession: RuntimeSession
      profile: AgentProfile
      message: UIMessage
    }

    export interface ChatRuntime {
      streamTurn: (input: StreamTurnInput) => AsyncGenerator<UIMessageChunk, void, void>
      steerTurn?: (input: SteerTurnInput) => Promise<void>
      cancelTurn: (input: CancelTurnInput) => Promise<void>
    }

In `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts`, `streamTurn` must pass an async iterable prompt to the Claude Agent SDK. The provider stores the active SDK query and its input stream by Chat Session ID. `steerTurn` finds that active query, projects the `UIMessage` to text, calls `query.interrupt()`, and pushes a priority user message into the same stream. `cancelTurn` closes both the query and input stream.

In `apps/server/src/modules/chat-runtime/providers/codex/provider.ts`, `streamTurn` must start or resume a Codex app-server thread, call `turn/start`, and keep the active app-server client plus `threadId` and `turnId` until the turn completes. `steerTurn` projects the `UIMessage` to text and calls `turn/steer` with `expectedTurnId`. `cancelTurn` calls `turn/interrupt` when an active turn id is known.

Revision note: Created this ExecPlan after discovering the previous direction targeted Issue Agent. The plan now scopes the feature to Chat Session and chat-runtime ownership.

Revision note: Updated on 2026-05-23 18:03Z after implementing Chat Session queue/steer, regenerating web and CLI surfaces, cleaning wrong Issue Agent queue residuals, and recording verification status before the five reviewer/fix rounds complete.

Revision note: Updated on 2026-05-23 18:15Z after completing the five reviewer/fix rounds. This revision records fixes for queue cancellation semantics, Drizzle snapshot correctness, Web queue behavior/accessibility, generated CLI object-array flags, final validation commands, and the local `better-sqlite3` native binding blocker.

Revision note: Updated on 2026-05-24 04:32+08:00 after adding Claude Agent true live steer, keeping durable fallback semantics for providers without `steerTurn`, fixing active-run release ordering and live-steer duplicate retry semantics, and recording focused provider validation.

Revision note: Updated on 2026-05-24 04:57+08:00 after the final reviewer/fix pass found queue race conditions. This revision records atomic live steer claiming, missed drain wakeup handling, orphaned running row recovery, expected-status queue transitions, and the final focused validation result.

Revision note: Updated on 2026-05-24 03:51+08:00 after diagnosing a live development database where `0038` was recorded but `chat_session_queue_items` was missing. This revision records the additive `0039` repair migration, current database repair, and Agent Session bridge invalidation cleanup.

Revision note: Updated on 2026-05-24 05:15+08:00 after the completion audit found the queue UI only had button reorder. This revision records native drag/drop queue sorting, retained button reorder, stricter queue state transition predicates, and the current Web typecheck blocker evidence.

Revision note: Updated on 2026-05-24 05:43+08:00 after the completion audit found Agent Session lifecycle gaps around queued continuation work. This revision records the Issue Agent continuation watcher, stop/undelegate queue cancellation semantics, live-applied `Steered` badge visibility, and focused validation results.

Revision note: Updated on 2026-05-24 06:17+08:00 after rebuilding the local `better-sqlite3` native binding, rerunning focused Chat Runtime and Issue Agent continuation tests, confirming the active desktop database recorded the `0039` repair migration, and verifying a restarted server returns the expected Chat Runtime queue business error instead of the SQLite missing-table error.

Revision note: Updated on 2026-05-24 06:26+08:00 after the completion audit added Agent Session input regression tests, tightened the queued-count badge text, extended Issue Agent continuation coverage to include `continuation.steer`, reran focused validation, and recorded the Codex SDK live-steer capability boundary.

Revision note: Updated on 2026-05-24 06:46+08:00 after replacing the Codex provider's closed-stdin SDK execution path with a Codex app-server JSON-RPC client, adding true Codex `turn/steer` and `turn/interrupt`, documenting the new provider files, and rerunning focused server, provider, issue-agent, Claude, web queue, and whitespace validation.
