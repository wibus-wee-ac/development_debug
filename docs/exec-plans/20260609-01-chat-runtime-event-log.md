# Rebuild Chat Runtime Around a Cradle Event Log and Provider Replay Projectors

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The plan must remain self-contained and updated at each stopping point.

## Purpose / Big Picture

Cradle chat sessions can currently get stuck in contradictory states: the session list can show a running or errored marker, the opened chat can show no active stream, and the next user message can return HTTP 409 because an in-memory active-run cache still believes a run is busy. This happens because one chat turn lifecycle is represented as mutable state in several places: `backend_runs`, `messages`, `chat_session_queue_items`, `backend_run_snapshots`, in-memory active run maps, and frontend streaming markers.

After this change, Chat Runtime has one canonical history: an append-only `chat_runtime_events` event log owned by Chat Runtime. Every run status, message snapshot, queue state, session status, and frontend busy state is derived from that log. A user can verify the outcome by starting a chat run, cancelling or failing it, reloading the app, and observing that the sidebar status, ChatView status, Runtime panel, and composer sendability agree. If a stale frontend streaming marker remains after a terminal event, the next send is allowed because the backend event-derived runtime state is idle.

This plan also fixes a separate but related architecture risk: the canonical event log must not be treated as a provider replay payload. Cradle stores Cradle-owned semantic events. Each provider, such as OpenAI-compatible, Claude Agent, Codex, or System Agent, owns a replay projector that converts Cradle history into that provider's legal message, tool, tool result, server request, fork, resume, and compaction payloads. Internal tool names such as `tool.request_user_input`, `github/search`, and Codex server request names may exist in Cradle semantic events, but they must never leak into a provider payload that rejects those names or schemas.

## Progress

- [x] (2026-06-08 18:33Z) Created this ExecPlan with the target event-log and provider replay projector architecture.
- [x] (2026-06-08 18:40Z) Added `chat_runtime_events` schema, migration `0067_chat_runtime_events.sql`, migration journal entry, and DB README notes.
- [x] (2026-06-08 18:42Z) Implemented Chat Runtime typed events, event store append/read operations, event fold, and focused tests. Validation: `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/event-fold.test.ts src/modules/chat-runtime/event-store.test.ts` passed 2 files and 6 tests.
- [x] (2026-06-08 18:50Z) Implemented provider replay projector contracts and provider-specific projectors for OpenAI-compatible, Claude Agent, Codex, and System Agent. Validation: `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/openai-compatible/replay-projector.test.ts src/modules/chat-runtime-providers/claude-agent/replay-projector.test.ts src/modules/chat-runtime-providers/codex/replay-projector.test.ts src/modules/chat-runtime-providers/system-agent/replay-projector.test.ts` passed 4 files and 6 tests; `pnpm typecheck:server` exited with code 0.
- [x] (2026-06-08 18:58Z) Implemented idempotent read-model projector for `backend_session_bindings`, `backend_runs`, `messages`, and `chat_session_queue_items`. Validation: `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/projector.test.ts src/modules/chat-runtime/event-fold.test.ts src/modules/chat-runtime/event-store.test.ts` passed 3 files and 7 tests; `pnpm typecheck:server` exited with code 0.
- [x] (2026-06-08 19:06Z) Added event-derived runtime state helper and wired Chat Runtime runtime-status plus Session sidebar status to prefer event-fold truth when a session has `chat_runtime_events`. Validation: `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/runtime-state.test.ts src/modules/session/service.test.ts src/modules/chat-runtime/projector.test.ts src/modules/chat-runtime/event-fold.test.ts src/modules/chat-runtime/event-store.test.ts` passed 5 files and 9 tests; `pnpm typecheck:server` exited with code 0.
- [x] (2026-06-08 19:46Z) Converted Chat Runtime command paths to append events before projecting read models. Ordinary `createRun` start writes `run.provider_context_recorded`, user/assistant message, queue claim, and `run.started` events; `finalizeActiveRun` writes assistant snapshot plus terminal run events; queue enqueue writes `queue.item_enqueued`; pending pre-run queue cancellation and explicit queue cancellation write `queue.item_cancelled`; queue drain claim/fail/release writes queue lifecycle events through owner callbacks; queue reorder writes `queue.item_reordered`; live steer writes a canonical `user_message.appended`; pending runtime user input writes `tool_call.user_input_requested` and `tool_call.user_input_answered`; Codex goal continuation scheduling/start writes `codex.goal_continuation_scheduled` and `codex.goal_continuation_started`; event-backed orphan streaming recovery writes `run.interrupted`; each append triggers `projectChatRuntimeReadModels`. The old run lifecycle/recovery direct read-model modules were removed, and start/terminal/queue/steer command paths no longer directly create lifecycle read-model rows.
- [x] (2026-06-08 19:14Z) Switched the main chat send path and returned `isBusy` / `canStop` state in `apps/web/src/features/chat/session/use-chat-session.ts` to use backend runtime-status as canonical busy truth. The Zustand store still owns local display markers only. Validation: `pnpm typecheck:apps-web` exited with code 0.
- [x] (2026-06-08 19:24Z) Added event coverage for queue cancellation, pending pre-run queue cancellation, queue reorder, and live steer; taught the event fold to apply `queue.item_reordered`; and gated `getMessageGroups` legacy orphan repair so event-backed sessions are not mutated by old read-model repair. Validation: `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/runtime-state.test.ts src/modules/session/service.test.ts src/modules/chat-runtime/projector.test.ts src/modules/chat-runtime/event-fold.test.ts src/modules/chat-runtime/event-store.test.ts src/modules/chat-runtime-providers/openai-compatible/replay-projector.test.ts src/modules/chat-runtime-providers/claude-agent/replay-projector.test.ts src/modules/chat-runtime-providers/codex/replay-projector.test.ts src/modules/chat-runtime-providers/system-agent/replay-projector.test.ts` passed 9 files and 16 tests; `pnpm typecheck:server` and `pnpm typecheck:apps-web` exited with code 0.
- [x] (2026-06-08 19:28Z) Added queue drain owner callbacks for claimed/released/failed rows and pending-user-input event sinks for request/answer events, keeping the queue helper and pending-user-input module free of direct event-store ownership. Validation: `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/pending-user-input.test.ts src/modules/chat-runtime-providers/openai-compatible/replay-projector.test.ts src/modules/chat-runtime-providers/claude-agent/replay-projector.test.ts src/modules/chat-runtime-providers/codex/replay-projector.test.ts src/modules/chat-runtime-providers/system-agent/replay-projector.test.ts` passed 5 files and 8 tests; `pnpm typecheck:server` exited with code 0.
- [x] (2026-06-08 19:30Z) Added Codex goal continuation owner callbacks for scheduled/start events. Ran the final focused validation slice for this turn: `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/runtime-state.test.ts src/modules/session/service.test.ts src/modules/chat-runtime/projector.test.ts src/modules/chat-runtime/event-fold.test.ts src/modules/chat-runtime/event-store.test.ts src/modules/chat-runtime/pending-user-input.test.ts src/modules/chat-runtime-providers/openai-compatible/replay-projector.test.ts src/modules/chat-runtime-providers/claude-agent/replay-projector.test.ts src/modules/chat-runtime-providers/codex/replay-projector.test.ts src/modules/chat-runtime-providers/system-agent/replay-projector.test.ts` passed 10 files and 18 tests; `pnpm typecheck:server` and `pnpm typecheck:apps-web` exited with code 0.
- [x] (2026-06-08 19:35Z) Added event-backed orphan streaming recovery: runtime-status, message hydration, and startup recovery now append/project `run.interrupted` for sessions whose event fold has an active run but the process has no live active/pending handle. Validation: `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/runtime-state.test.ts src/modules/session/service.test.ts src/modules/chat-runtime/projector.test.ts src/modules/chat-runtime/event-fold.test.ts src/modules/chat-runtime/event-store.test.ts src/modules/chat-runtime/pending-user-input.test.ts src/modules/chat-runtime-providers/openai-compatible/replay-projector.test.ts src/modules/chat-runtime-providers/claude-agent/replay-projector.test.ts src/modules/chat-runtime-providers/codex/replay-projector.test.ts src/modules/chat-runtime-providers/system-agent/replay-projector.test.ts` passed 10 files and 19 tests; `pnpm typecheck:server` and `pnpm typecheck:apps-web` exited with code 0.
- [x] (2026-06-08 19:46Z) Removed obsolete direct repair paths by deleting `apps/server/src/modules/chat-runtime/run/lifecycle.ts` and `apps/server/src/modules/chat-runtime/run/recovery.ts`; remaining service-side `messages` update is the oversized snapshot compaction maintenance path, not lifecycle state ownership. Validation: `rg "\\.update\\(backendRuns\\)|\\.insert\\(backendRuns\\)|tx\\.insert\\(messages\\)|\\.insert\\(chatSessionQueueItems\\)|\\.update\\(chatSessionQueueItems\\)|tx\\.update\\(chatSessionQueueItems\\)|\\.update\\(messages\\)" apps/server/src/modules/chat-runtime/service.ts` returns only the oversized message compaction update.
- [x] (2026-06-08 19:49Z) Removed queue helper direct lifecycle mutations: `queue/drain.ts` now constructs claim/release/fail facts and asks Chat Runtime owner callbacks to append/project queue events; `queue/session-queue.ts` no longer contains orphan-running repair or pending-position normalization writes. Validation: `rg "\\.update\\(backendRuns\\)|\\.insert\\(backendRuns\\)|tx\\.insert\\(messages\\)|\\.insert\\(chatSessionQueueItems\\)|\\.update\\(chatSessionQueueItems\\)|tx\\.update\\(chatSessionQueueItems\\)|\\.update\\(messages\\)" apps/server/src/modules/chat-runtime/service.ts apps/server/src/modules/chat-runtime/queue apps/server/src/modules/chat-runtime/run -g "*.ts"` returns only the oversized message compaction update in `service.ts`.
- [x] (2026-06-08 19:49Z) Ran focused validation for the event-log implementation. Validation: `pnpm typecheck:server`, `pnpm typecheck:apps-web`, and `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/runtime-state.test.ts src/modules/session/service.test.ts src/modules/chat-runtime/projector.test.ts src/modules/chat-runtime/event-fold.test.ts src/modules/chat-runtime/event-store.test.ts src/modules/chat-runtime/pending-user-input.test.ts src/modules/chat-runtime-providers/openai-compatible/replay-projector.test.ts src/modules/chat-runtime-providers/claude-agent/replay-projector.test.ts src/modules/chat-runtime-providers/codex/replay-projector.test.ts src/modules/chat-runtime-providers/system-agent/replay-projector.test.ts` exited with code 0; focused server tests passed 10 files and 19 tests. The known duplicate `browser-use` MCP registration log remains test noise and does not fail the run.
- [x] (2026-06-09 00:48Z) Corrected read-model ownership after broad integration exposed a `backend_run_snapshots.run_id` unique conflict: `backend_run_snapshots` and `backend_run_snapshot_events` remain live diagnostic/forensic tables owned by `run-snapshot.ts`, while the event projector owns lifecycle query read models only.
- [x] (2026-06-09 01:05Z) Fixed Claude Agent integration regressions uncovered after the snapshot ownership correction: query close is capability-checked for SDK/test doubles, SDK `result` messages now emit a terminal `finish`, complete-turn final message projection closes active text/reasoning parts as `done`, and SDK provider tests assert Cradle tool-result envelopes instead of legacy raw string tool output. Validation: `pnpm typecheck:server`, `pnpm typecheck:apps-web`, `pnpm --filter @cradle/server exec vitest run tests/sdk-providers.test.ts`, and the focused event-log/provider slice passed.
- [x] (2026-06-09 06:10Z) Fixed remaining broad Chat Runtime integration regressions: the projector preserves an existing durable binding id instead of inventing a new id for sessions with older binding rows, skips durable `backend_session_bindings` when provider events have no backend session id, event-backed stale active handles append terminal events instead of leaving runtime status busy, legacy read-model recovery is gated to sessions with no `chat_runtime_events`, oversized assistant terminal snapshots are compacted before event snapshot payloads are written, and ordinary Codex sessions include the Cradle CLI baseline skill. Validation: focused projector/runtime/legacy recovery/Codex baseline tests and `pnpm typecheck:server` passed.
- [x] (2026-06-09 06:17Z) Fixed OpenAI-compatible usage persistence after integration showed `/usage/sessions/:sessionId` returning zeros. `executeAiSdkTurn` now captures AI SDK `finish` part `totalUsage` before yielding the terminal UI chunk, so providers set `lastUsage` even when Chat Runtime stops consuming at `finish`. Validation: `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-engine/ai-sdk-engine.test.ts --reporter verbose` passed 1 file and 3 tests; `pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts -t "runs an openai-compatible turn" --reporter verbose` passed.
- [x] (2026-06-09 06:20Z) Re-ran the broad integration and final focused validation after the usage fix. Validation: `pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts tests/session.test.ts tests/issue-agent.test.ts tests/session-await.test.ts tests/sdk-providers.test.ts --reporter verbose` passed 5 files and 81 tests; the focused event/replay/AI SDK engine slice passed 10 files and 22 tests; `pnpm typecheck:server` and `pnpm typecheck:apps-web` exited with code 0.
- [x] (2026-06-09 06:25Z) Updated module documentation for the final ownership model: Chat Runtime README now names `chat_runtime_events` as canonical lifecycle history and removes deleted `run/lifecycle.ts` / `run/recovery.ts`; provider READMEs list provider-owned replay projectors; Session README describes event-derived status with legacy fallback only for no-event sessions; Web store README marks local/passive generation flags as display state rather than backend busy truth.

## Surprises & Discoveries

- Observation: The current repository has no reusable Chat Runtime event log in `apps/server`; the old `backend_timeline_events` table existed in earlier main-process plans and was deleted by migration `0015_message_snapshot_chat_runtime.sql`.
  Evidence: `rg "backend_timeline_events|chat_runtime_events" apps/server packages/db` finds only legacy migration tests and docs, not an active server-owned event log.

- Observation: `backend_run_snapshot_events` is a forensic run snapshot event table, not a canonical lifecycle event stream.
  Evidence: `apps/server/src/modules/chat-runtime/README.md` describes run snapshots as diagnostic records, and `packages/db/src/schema/backend-control-plane.ts` stores snapshot events under `backend_run_snapshot_events` linked to a snapshot id.

- Observation: The current worktree already contains an in-progress Chat Runtime decomposition where former files such as `chat-turn-context.ts`, `session-queue.ts`, and run lifecycle helpers have moved into `context/`, `queue/`, `run/`, `stream/`, `side-chat/`, and `provider-threads/`.
  Evidence: `git status --short` shows deleted old files and untracked replacement directories under `apps/server/src/modules/chat-runtime/`.

- Observation: Provider tool envelope helpers already exist and should be promoted into the event-log design rather than reinvented.
  Evidence: `apps/server/src/modules/chat-runtime-providers/tools/tool-call-payload.ts` defines `cradle.builtin-tool-call.input.v1` and `cradle.builtin-tool-call.result.v1` payloads with `{ identifier, apiName, args, result }`.

- Observation: The hand-written migration `0067_chat_runtime_events.sql` was not applied by the Drizzle migrator until `packages/db/drizzle/meta/_journal.json` included the matching journal entry.
  Evidence: the first focused event-store test run failed because `chat_runtime_events` did not exist; after adding journal entry `{ idx: 67, tag: "0067_chat_runtime_events" }`, the event-store tests passed.

- Observation: Provider replay projector tests can validate the raw/display split without booting the server app.
  Evidence: `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/openai-compatible/replay-projector.test.ts src/modules/chat-runtime-providers/claude-agent/replay-projector.test.ts src/modules/chat-runtime-providers/codex/replay-projector.test.ts src/modules/chat-runtime-providers/system-agent/replay-projector.test.ts` passed 4 files and 6 tests in about one second.

- Observation: The read-model projector can be validated with a real SQLite test by projecting the same event stream twice and observing unchanged row counts and states.
  Evidence: `apps/server/src/modules/chat-runtime/projector.test.ts` projects provider binding, user/assistant messages, a queue item, and a run twice; the focused command with event-fold and event-store tests validates idempotent lifecycle projection.

- Observation: Projecting canonical events into `backend_run_snapshots` competes with the live run snapshot recorder.
  Evidence: the broad server suite surfaced a `SQLITE_CONSTRAINT_UNIQUE` on `backend_run_snapshots.run_id` when `projectChatRuntimeReadModels` inserted a deterministic snapshot row and `startRunSnapshot()` later tried to insert the live diagnostic snapshot for the same `runId`.

- Observation: Once the snapshot conflict was removed, the Claude Agent SDK integration exposed two pre-existing stream-finalization assumptions.
  Evidence: `tests/sdk-providers.test.ts` first failed with `activeQuery.close is not a function` because the test SDK query double has no `close` method, then failed with final message parts still marked `state: "streaming"` because terminal finalization flushed text but did not close active text/reasoning projections. The fixes are in `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts`, `event-to-chunk-mapper.ts`, and `apps/server/src/modules/chat-runtime/run/final-message-projection.ts`.

- Observation: Backend status reads can prefer the event fold while preserving legacy behavior for sessions that have no event stream yet.
  Evidence: `apps/server/src/modules/chat-runtime/runtime-state.test.ts` and `apps/server/src/modules/session/service.test.ts` both construct a stale `backend_runs.status = "streaming"` row plus terminal events. The helper returns event-derived idle/error state and Session `get/list` report idle when the event log is terminal.

- Observation: The first command-path conversion slice can append events after existing direct writes and immediately project read models without breaking current streaming behavior.
  Evidence: after wiring ordinary run start, terminal finalization, and queue enqueue to append events and call `projectChatRuntimeReadModels`, `pnpm typecheck:server` passed and the focused command `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/runtime-state.test.ts src/modules/session/service.test.ts src/modules/chat-runtime/projector.test.ts src/modules/chat-runtime/event-fold.test.ts src/modules/chat-runtime/event-store.test.ts src/modules/chat-runtime-providers/openai-compatible/replay-projector.test.ts src/modules/chat-runtime-providers/claude-agent/replay-projector.test.ts src/modules/chat-runtime-providers/codex/replay-projector.test.ts src/modules/chat-runtime-providers/system-agent/replay-projector.test.ts` passed 9 files and 15 tests.

- Observation: Frontend send routing was still using local/passive store status to decide whether a message should start a normal response or be queued/steered.
  Evidence: `apps/web/src/features/chat/session/use-chat-session.ts` previously computed `isBusy` from `sessionMeta.passiveStatus` and `visibleStatus`; after this change it fetches `/chat/sessions/:sessionId/runtime-status` with `staleTime: 0` and uses `status`, `activeRun`, and pending/cancelling state as the decision input.

- Observation: Opening a session through `getMessageGroups` still ran legacy orphaned-streaming repair even after a session had canonical events.
  Evidence: `apps/server/src/modules/chat-runtime/service.ts` called `failOrphanedPersistedStreamingSession(sessionId)` whenever no live active/pending run existed. The function now first checks `readEventDerivedRuntimeState(sessionId)` and only runs the legacy repair when no event stream exists.

- Observation: Durable provider bindings are only valid when the provider reports a backend session id. Some OpenAI-compatible turns intentionally have `backendSessionId: null`, and old sessions may already have a random binding row id.
  Evidence: broad projector tests failed with foreign-key errors until `projectChatRuntimeReadModels` reused the existing `backend_session_bindings.id` for a session and projected `backend_runs.bindingId = null` when the folded provider binding had no backend session id.

- Observation: AI SDK `finish` UI chunks do not carry usage, and Chat Runtime intentionally stops consuming provider generators at terminal chunks.
  Evidence: `tests/chat-runtime.test.ts > runs an openai-compatible turn...` persisted the assistant text but `/usage/sessions/session-chat` returned zero tokens. `executeAiSdkTurn` previously called `emitUsage` only after the UI stream reached `done`, which never ran when the caller broke at `finish`.

- Observation: The AI SDK `toUIMessageStream` `messageMetadata` callback sees the lower-level `finish` part before the UI `finish` chunk is yielded.
  Evidence: the new `executeAiSdkTurn > emits usage before yielding the terminal finish chunk` test consumes only until the UI `finish` chunk and still observes `onUsage` with `{ promptTokens: 10, completionTokens: 3, totalTokens: 13 }`.

- Observation: Terminal event snapshots need the same compaction discipline as persisted final message snapshots.
  Evidence: the oversized assistant snapshot test only passed after `appendRunTerminalEvents` compacted `activeRun.finalMessage` before writing the `assistant_message.snapshot_recorded` payload.

## Decision Log

- Decision: Use a destructive migration and do not keep a legacy dual-track reader for old Chat Runtime lifecycle data.
  Rationale: Cradle is not released, and repository guidance explicitly prefers clean architecture upgrades over compatibility code. A dual track would preserve exactly the current source-of-truth ambiguity.
  Date/Author: 2026-06-08 / Codex

- Decision: Name the new canonical table `chat_runtime_events`, not `backend_timeline_events`.
  Rationale: The old table name belonged to a prior architecture and was removed. The new table is explicitly Chat Runtime-owned and should not blur namespace ownership.
  Date/Author: 2026-06-08 / Codex

- Decision: Store only Cradle-owned semantic history in the event log and require provider replay projectors for provider payload reconstruction.
  Rationale: Canonical history and provider replay payloads have different owners and constraints. OpenAI-compatible, Claude Agent, Codex, and System Agent accept different message shapes and tool names. Directly replaying Cradle UI messages or provider-specific payloads would reintroduce hidden coupling.
  Date/Author: 2026-06-08 / Codex

- Decision: Keep frontend operation state as optimistic UI only.
  Rationale: LobeHub's raw/display split and operation-state organization are useful for frontend clarity, but Cradle busy truth must live in backend event-derived runtime state because sessions can be driven by other windows, queues, automation, session-await, issue agents, and Codex goal continuation.
  Date/Author: 2026-06-08 / Codex

- Decision: OpenAI-compatible replay omits Cradle internal interaction tools such as `tool.request_user_input`, `approval.*`, and `mcp.*`, while sanitizing ordinary external tool names such as `github/search` into OpenAI-valid names such as `github_search`.
  Rationale: OpenAI-compatible function names have stricter character limits than Cradle semantic tool names, and internal human-interaction events are not legal model tool calls for this provider.
  Date/Author: 2026-06-08 / Codex

- Decision: Claude Agent and System Agent replay projectors represent Cradle tool history as text summaries and diagnostics, not provider tool calls.
  Rationale: These providers do not own Codex app-server request schemas. Passing Codex request names or MCP tool names as structured provider tools would couple canonical history to the wrong provider.
  Date/Author: 2026-06-08 / Codex

- Decision: Codex replay projects tool events into generated Codex `ResponseItem[]` and preserves Codex-owned tool names such as `github/search`, `tool.request_user_input`, `command_execution`, and `mcp.elicitation`.
  Rationale: Codex app-server history already accepts these semantic tool names, and preserving them is necessary for Codex resume, fork, compact, and thread replay behavior.
  Date/Author: 2026-06-08 / Codex

- Decision: The read-model projector uses stable deterministic ids only for projection-owned rows such as `chat-runtime-binding:${sessionId}`; it does not write `backend_run_snapshots` or `backend_run_snapshot_events`.
  Rationale: Reprojection must be idempotent without deleting user-visible read-model rows, but snapshot rows are live diagnostic records with their own recorder, retention policy, sequence model, and unique `run_id` constraint. Mixing canonical projection and forensic recording in the same rows creates ownership ambiguity and runtime conflicts.
  Date/Author: 2026-06-09 / Codex

- Decision: Until all command paths append events, `readEventDerivedRuntimeState` returns legacy read-model state only when a session has no `chat_runtime_events`; once any events exist for the session, the event fold owns backend busy truth.
  Rationale: This avoids letting stale `backend_runs` or in-memory active-run maps override terminal event history, while keeping existing unconverted sessions functional during the destructive migration work.
  Date/Author: 2026-06-08 / Codex

- Decision: Convert command paths in additive slices first, appending canonical events and projecting read models immediately after the existing direct writes, then remove direct writes once all lifecycle paths are covered by events.
  Rationale: The streaming path has live handles, replay buffers, provider cancellation, snapshots, queue drain, and Codex continuation side effects. Appending event facts first moves busy truth to the fold without destabilizing the current live stream execution; the final cleanup still removes direct read-model ownership after equivalent event coverage exists.
  Date/Author: 2026-06-08 / Codex

- Decision: Frontend `useChatSession` uses backend runtime-status to decide busy/send routing and exposes backend-derived `isBusy` / `canStop`; local Zustand streaming markers remain only a display and optimistic cleanup layer.
  Rationale: Local renderer state can be stale after reloads, reconnects, or terminal events. The backend event fold is the only state that can safely decide whether to start a new response, queue, steer, or allow cancellation.
  Date/Author: 2026-06-08 / Codex

- Decision: Keep direct read-model writes temporarily in command handlers only where the existing live runtime path still depends on them, but append canonical events immediately after each accepted command fact and gate legacy repair away from event-backed sessions.
  Rationale: This preserves live stream handles and queue drain behavior while continuing the destructive migration toward event ownership. Once queue drain, pending user input, recovery, and Codex continuation emit equivalent events, the direct writes can be removed rather than wrapped in compatibility code.
  Date/Author: 2026-06-08 / Codex

- Decision: Queue drain and pending-user-input helpers publish owner callbacks instead of importing the Chat Runtime event store.
  Rationale: The helpers own local live mechanics, but Chat Runtime owns canonical lifecycle semantics. Callback sinks keep event append/project logic centralized in `service.ts` while avoiding a new cross-module persistence dependency.
  Date/Author: 2026-06-08 / Codex

- Decision: Delete the old `run/lifecycle.ts` and `run/recovery.ts` direct repair modules instead of preserving legacy compatibility shims.
  Rationale: The event log is now the canonical lifecycle source for new Chat Runtime state. Keeping modules that patch `backend_runs`, `messages`, queue rows, and snapshots as truth would preserve the source-of-truth ambiguity this refactor is meant to remove.
  Date/Author: 2026-06-08 / Codex

- Decision: Keep `run/legacy-recovery.ts` only as a no-event fallback for old read-model sessions; event-backed sessions recover by appending/projecting terminal events.
  Rationale: Event-backed history must not be repaired by mutating read models as truth. The bounded fallback prevents old development rows with no event stream from breaking startup or message hydration while preserving canonical event ownership for new sessions.
  Date/Author: 2026-06-09 / Codex

- Decision: Capture AI SDK total usage from the lower-level `finish` stream part before yielding the UI terminal chunk, with an idempotent `result.usage` fallback for callers that naturally drain the stream.
  Rationale: Chat Runtime's provider contract allows callers to stop at terminal UI chunks. Usage persistence therefore has to be complete before that yield; waiting for generator completion loses usage for the normal OpenAI-compatible path.
  Date/Author: 2026-06-09 / Codex

## Outcomes & Retrospective

Current outcome as of 2026-06-09 00:48Z: the canonical event schema, event store/fold, provider replay projectors, event-derived read-model projector, backend/frontend busy truth, accepted command facts, event-backed orphan run recovery, and direct lifecycle read-model cleanup are implemented. A broad integration run found an event-projector/live-snapshot ownership conflict; the projector now leaves `backend_run_snapshots` and `backend_run_snapshot_events` to the live diagnostic recorder.

Current outcome as of 2026-06-09 01:05Z: the event-log implementation and the snapshot ownership correction are validated by focused integration coverage. Full `tests/sdk-providers.test.ts` passes after aligning Claude Agent terminal/result behavior with the new canonical tool-envelope and final-message projection semantics. The known duplicate `browser-use` MCP registration logs remain noisy but non-failing in these runs.

Current outcome as of 2026-06-09 06:25Z: the event-log implementation passes the broad Chat Runtime/Session/Issue Agent/Session Await/SDK provider integration slice and focused event/replay tests. OpenAI-compatible turns persist usage even when Chat Runtime stops consuming at the terminal UI chunk. Documentation now reflects that `chat_runtime_events` owns lifecycle truth, read models are projections, diagnostic snapshots are recorder-owned, and frontend local/passive flags are display state only.

## Context and Orientation

The relevant server module is `apps/server/src/modules/chat-runtime`. It exposes routes in `index.ts`, orchestrates turns in `service.ts`, and has helper modules for context, queueing, run lifecycle, streaming, side chats, pending user input, and snapshots. The current tree has an in-progress decomposition: context helpers are in `context/turn-context.ts`, queue helpers are in `queue/`, run lifecycle helpers are in `run/`, streaming helpers are in `stream/`, side chat helpers are in `side-chat/`, and provider thread helpers are in `provider-threads/`.

The relevant database schemas are under `packages/db/src/schema`. `chat.ts` defines `sessions`, `messages`, usage logs, and `chat_session_queue_items`. `backend-control-plane.ts` defines `backend_session_bindings`, `backend_runs`, `backend_run_snapshots`, and `backend_run_snapshot_events`. Today, `backend_runs.status`, `messages.status`, `chat_session_queue_items.status`, and live snapshot status can drift from one another. After this plan, `backend_session_bindings`, `backend_runs`, `messages`, and `chat_session_queue_items` are event-derived read models. `backend_run_snapshots` and `backend_run_snapshot_events` remain diagnostic/forensic tables owned by the live run snapshot recorder; they are not canonical lifecycle truth.

The term event log means an append-only table of facts that happened, ordered within one chat session. Append-only means code inserts new rows but does not update prior event rows to change history. The new table is `chat_runtime_events`. A fold is a pure function that reads all events for a session and computes current state, such as whether a run is active. A projector is code that reads events and writes read models such as `messages` or `backend_runs`.

The term provider replay projector means provider-owned code that turns Cradle semantic history into legal input for one provider. This is separate from a UI message projector. For example, Cradle may store a tool event with `identifier: "codex"` and `apiName: "github/search"`. The Codex replay projector can turn that into Codex Responses API or app-server history items. The OpenAI-compatible replay projector must not send a function name containing `/` if the target API disallows it; it must sanitize or omit the event according to the provider contract. The Claude Agent replay projector must not replay Codex server request names as Claude tools.

Provider adapters live under `apps/server/src/modules/chat-runtime-providers`. Existing directories include `openai-compatible`, `claude-agent`, `codex`, `system-agent`, `acp`, and shared `tools`. The shared tool envelope helpers in `tools/tool-call-payload.ts` should be reused as the Cradle semantic tool event payload base.

The frontend store relevant to chat rendering is `apps/web/src/store/chat.ts`. It stores `messagesMap`, local `generatingMessageIds`, `passiveStreamingMessageIds`, abort controllers, and session metadata. This store should remain a renderer cache and optimistic UI layer. It must not decide backend busy truth. The hook `apps/web/src/features/chat/session/use-chat-session.ts` coordinates message hydration, runtime status polling, streaming response commands, queueing, steering, cancellation, and composer state. The workspace sidebar session list reads session status through `apps/web/src/features/workspace/use-session.ts`.

## Plan of Work

First, add the canonical event schema. In `packages/db/src/schema`, add a Chat Runtime-owned schema export for `chatRuntimeEvents` or add it to `backend-control-plane.ts` if keeping all runtime control-plane tables together reads cleaner. The table must have `id`, `streamId`, `seq`, `type`, optional command and actor fields, optional run, message, and queue item ids, `occurredAt`, and `payloadJson`. Add a Drizzle migration after `0066_external_issue_sources.sql`, expected as `0067_*`, and update both database READMEs. Because this is a destructive migration, include SQL that clears old Chat Runtime lifecycle read model rows or makes their rebuild behavior explicit. Preserve `sessions` rows so the user can still see session shells, unless implementation discovers that existing tests require complete data reset in test databases.

Second, implement typed events and the event store under `apps/server/src/modules/chat-runtime`. Create `events.ts` for event type definitions and validation, `event-store.ts` for append and read operations, and `event-fold.ts` for a pure reducer. The event store must append with expected sequence per `streamId` so concurrent commands cannot both create an active run. It must support `commandId` idempotency so a retried command does not append duplicate start events. The fold must compute at least active run, latest run, queue state, message summaries, provider binding summary, and whether the session is busy.

Third, implement provider replay contracts before converting run orchestration. Create `apps/server/src/modules/chat-runtime/replay/` with a `types.ts` interface, a registry, shared helpers for tool envelope reading, and tests. Add provider-specific replay projectors in each provider directory: `openai-compatible/replay-projector.ts`, `claude-agent/replay-projector.ts`, `codex/replay-projector.ts`, and `system-agent/replay-projector.ts`. These projectors must be provider-owned, not generic string substitution helpers in Chat Runtime. Their tests must cover `tool.request_user_input`, `github/search`, Codex server request names, command execution, MCP elicitation, and unsupported-provider behavior.

Fourth, implement the read-model projector. Create `projector.ts` in Chat Runtime. It is the only code allowed to write lifecycle read models: `backend_runs`, `messages`, `chat_session_queue_items`, and `backend_session_bindings`. It should be idempotent: projecting the same session events twice produces the same rows and does not create duplicates. It should expose a rebuild function for one session and a startup recovery function. Startup recovery must append `run.interrupted` and `run.failed` events when a session has a non-terminal event-fold run but the process has no live active handle. It must not directly patch read model truth. It must not write `backend_run_snapshots` or `backend_run_snapshot_events`; those tables are diagnostic recorder output.

Fifth, convert command paths. Update `service.ts` and decomposed helpers in `run/`, `queue/`, `stream/`, and `side-chat/` so ordinary user responses, native approval continuations, cancel, terminal finalization, queue enqueue/claim/complete/fail/cancel/reorder, steer, pending user input resolution, Codex goal continuation, and provider binding updates append events first and then call the projector. Keep in-memory `activeRuns`, subscribers, replay buffers, abort controllers, and pending user input registries as live handles only. Do not use those maps to decide whether a session is busy; ask the event fold or event-derived runtime state.

Sixth, update read APIs. `GET /chat/sessions/:sessionId/messages`, `GET /chat/sessions/:sessionId/runtime-status`, queue list routes, completed run polling, and provider-thread context paths must read event-derived projections. `apps/server/src/modules/session/service.ts` must stop reading `backend_runs.status` as canonical and instead read Chat Runtime's event-derived session status projection or a Chat Runtime helper. The user-visible sidebar red dot and error state should be consistent with Chat Runtime event fold state after reload.

Seventh, update the frontend. `apps/web/src/store/chat.ts` should keep raw UI snapshots and display projections as renderer state, but session busy/selectors must not rely on `generatingMessageIds`, `passiveStreamingMessageIds`, or local `passiveStatus` as truth. `use-chat-session.ts` should decide ordinary response versus queue/steer using backend runtime status. Workspace session rows should prefer server Session API status. Local operation state remains useful for immediate visual feedback before the server accepts a command, but backend status wins when they disagree.

Eighth, remove obsolete repair logic and update documentation. Delete or repurpose helpers that directly mutate read models to repair truth, such as orphaned persisted streaming repair that updates `backend_runs` or `messages` without appending events. Update `apps/server/src/modules/chat-runtime/README.md`, provider READMEs where replay projectors are added, `apps/server/src/modules/session/README.md`, `apps/web/src/store/README.md`, and relevant feature READMEs.

## Concrete Steps

Run all commands from repository root `/Users/wibus/dev/Cradle`.

1. Inspect the current dirty worktree before editing:

    git status --short
    find apps/server/src/modules/chat-runtime -maxdepth 3 -type f | sort

   Expected: a dirty worktree may exist. Do not revert unrelated user changes. Continue against the current decomposed Chat Runtime layout.

2. Add the DB schema and migration:

    pnpm exec drizzle-kit generate

   If the generator chooses a migration name other than `0067_*`, keep the generated name and update this plan and `packages/db/drizzle/README.md` with the actual filename. After generation, inspect the migration and meta snapshot to ensure `chat_runtime_events` has unique `(stream_id, seq)` and the needed indexes.

3. Add event model tests before implementation where possible:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/event-fold.test.ts src/modules/chat-runtime/event-store.test.ts

   Expected before implementation: tests fail because modules do not exist or behavior is missing. After implementation: all tests pass.

4. Implement provider replay projector tests and projectors:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/replay/replay-projector.test.ts src/modules/chat-runtime-providers/codex/replay-projector.test.ts src/modules/chat-runtime-providers/claude-agent/replay-projector.test.ts src/modules/chat-runtime-providers/openai-compatible/replay-projector.test.ts

   Expected after implementation: tests prove `tool.request_user_input`, `github/search`, and server request names are transformed or omitted according to provider constraints.

5. Implement projector tests and read-model projector:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/projector.test.ts

   Expected: projecting a fixed event stream creates correct run rows, message rows, queue rows, binding rows, and session status projection.

6. Convert Chat Runtime command paths and run focused server tests:

    pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts tests/session.test.ts tests/issue-agent.test.ts tests/session-await.test.ts

   Expected: response start, cancel, queue drain, await resume enqueue, issue-agent continuation, and session status tests pass.

7. Update frontend state and run focused web tests:

    pnpm --filter @cradle/web exec vitest run src/store/chat.test.ts
    pnpm typecheck:apps-web

   Expected: chat store tests pass, and TypeScript catches any stale generated API or hook contracts.

8. Run final validation:

    pnpm typecheck:server
    pnpm --filter @cradle/server test
    pnpm typecheck:apps-web

   Expected: all commands exit with code 0. If a command fails due to unrelated concurrent work, record the failing files and still run narrower tests covering the event-log change.

## Validation and Acceptance

Acceptance is satisfied when these observable behaviors hold.

First, a stale frontend streaming marker cannot block a new run. Create or simulate a session where the event log contains `run.failed` or `run.completed`, while the frontend store still has a streaming message id. The composer must allow a normal response, and the server must not return 409. This proves backend event-derived runtime state owns busy truth.

Second, a server restart during a streaming run produces terminal event history. With a session event stream containing `run.started` and no terminal event, start the server with no live active handle and call message hydration or runtime status. The server appends `run.interrupted` and `run.failed`, projects read models, and the session list, ChatView, Runtime panel, and composer agree that the session is failed and idle.

Third, active run conflict is event-derived. Start one run, then submit another ordinary response before a terminal event. The second request returns HTTP 409 with code `chat_run_in_progress`. After appending and projecting a terminal event for the first run, another ordinary response is accepted.

Fourth, provider replay does not leak Cradle or other-provider tool names. Tests must show OpenAI-compatible payloads do not contain invalid names such as `github/search` or `tool.request_user_input`; Claude Agent does not receive Codex server request tools; Codex receives valid app-server or Responses items for `github/search`, `tool.request_user_input`, command execution, MCP elicitation, file change, and web search.

Fifth, rebuilding projections from events restores lifecycle read models. Delete or clear read model rows for a test session, run the projector rebuild, and verify messages, runs, queue rows, binding rows, and session status are restored from `chat_runtime_events` alone. Diagnostic snapshot rows are not part of this acceptance criterion because they are live recorder output, not canonical event projection.

## Idempotence and Recovery

The event store append path is intentionally not idempotent by default; command handlers must provide a `commandId` when retrying a user-visible command. If the same command is retried with the same `commandId`, the event store must return the existing appended event sequence rather than duplicate it.

The read-model projector must be idempotent. It should use deterministic ids from events or stable upsert behavior so running projection twice does not create duplicate rows. If projection fails after events are appended, rerun the projector for that session. Because the event log is canonical, projection failure is recoverable without editing event rows.

The migration is destructive for Chat Runtime lifecycle data. Before running it on a development database whose chat history matters, back up the database file under `CRADLE_DATA_DIR`. Because Cradle has no released production version, no compatibility reader is added. If tests or development data need legacy preservation later, add an explicit one-time event backfill migration as a new decision in this plan, not a hidden dual-track reader.

If provider replay projection fails because a provider does not support a Cradle semantic event, the projector should omit or summarize that event according to provider rules and include a projection diagnostic in its return value. It must not send invalid provider payloads.

## Artifacts and Notes

Initial static evidence:

    git status --short
    -> shows existing Chat Runtime decomposition changes and unrelated desktop/web edits. Do not revert them.

    find apps/server/src/modules/chat-runtime -maxdepth 3 -type f | sort
    -> shows current directories: context/, provider-threads/, queue/, run/, side-chat/, stream/.

    rg "backend_timeline_events|chat_runtime_events" apps/server packages/db
    -> no active Chat Runtime canonical event table exists in apps/server.

Known relevant files:

    packages/db/src/schema/chat.ts
    packages/db/src/schema/backend-control-plane.ts
    apps/server/src/modules/chat-runtime/service.ts
    apps/server/src/modules/chat-runtime/transcript.ts
    apps/server/src/modules/chat-runtime-providers/tools/tool-call-payload.ts
    apps/server/src/modules/chat-runtime-providers/codex/transcript-projector.ts
    apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts
    apps/server/src/modules/chat-runtime-providers/openai-compatible/provider.ts
    apps/web/src/store/chat.ts
    apps/web/src/features/chat/session/use-chat-session.ts

## Interfaces and Dependencies

Use Drizzle ORM for all database interactions. Do not use raw SQL in runtime code except migration SQL generated or inspected under `packages/db/drizzle`. Use Zod for event payload validation where runtime validation is needed, following existing server patterns.

In `packages/db/src/schema`, define and export:

    export const chatRuntimeEvents = sqliteTable('chat_runtime_events', {
      id: textPk(),
      streamId: text('stream_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
      seq: int('seq').notNull(),
      type: text('type').notNull(),
      commandId: text('command_id'),
      actorKind: text('actor_kind'),
      actorId: text('actor_id'),
      runId: text('run_id'),
      messageId: text('message_id'),
      queueItemId: text('queue_item_id'),
      occurredAt: int('occurred_at').notNull(),
      payloadJson: text('payload_json').notNull().default('{}'),
    }, table => ({
      byStreamSeq: uniqueIndex('chat_runtime_events_stream_seq_unique').on(table.streamId, table.seq),
      byStream: index('chat_runtime_events_stream_id_idx').on(table.streamId),
      byRun: index('chat_runtime_events_run_id_idx').on(table.runId),
      byMessage: index('chat_runtime_events_message_id_idx').on(table.messageId),
      byQueueItem: index('chat_runtime_events_queue_item_id_idx').on(table.queueItemId),
      byType: index('chat_runtime_events_type_idx').on(table.type),
      byOccurredAt: index('chat_runtime_events_occurred_at_idx').on(table.occurredAt),
    }))

In `apps/server/src/modules/chat-runtime/events.ts`, define a discriminated union similar to:

    export type ChatRuntimeEvent =
      | UserMessageAppendedEvent
      | AssistantMessageCreatedEvent
      | AssistantMessagePartRecordedEvent
      | AssistantMessageSnapshotRecordedEvent
      | ToolCallRequestedEvent
      | ToolCallArgumentsRecordedEvent
      | ToolCallResultRecordedEvent
      | ToolCallApprovalRequestedEvent
      | ToolCallUserInputRequestedEvent
      | ToolCallUserInputAnsweredEvent
      | RunStartRequestedEvent
      | RunStartedEvent
      | RunCompletedEvent
      | RunFailedEvent
      | RunAbortedEvent
      | RunInterruptedEvent
      | QueueItemEnqueuedEvent
      | QueueItemClaimedEvent
      | QueueItemCompletedEvent
      | QueueItemFailedEvent
      | QueueItemCancelledEvent
      | QueueItemReorderedEvent
      | ProviderBindingResolvedEvent
      | ProviderBindingUpdatedEvent
      | CodexGoalContinuationScheduledEvent
      | CodexGoalContinuationStartedEvent
      | CodexGoalContinuationSkippedEvent

Revision note, 2026-06-08 18:50Z: Updated Progress, Surprises & Discoveries, and Decision Log after implementing the event substrate and provider replay projector milestone. This revision records exact validation commands and the provider-specific replay boundary decisions so a future implementer can continue from read-model projection without re-deriving those choices.

Revision note, 2026-06-08 18:58Z: Updated Progress, Surprises & Discoveries, and Decision Log after implementing the idempotent read-model projector milestone. This revision records deterministic projection ids and the real SQLite validation command before converting service command paths.

Revision note, 2026-06-08 19:06Z: Updated Progress, Surprises & Discoveries, and Decision Log after wiring backend runtime/session status reads to prefer event-derived state. This revision records the transitional rule that legacy read models are consulted only for sessions with no event stream yet.

Revision note, 2026-06-08 19:12Z: Updated Progress, Surprises & Discoveries, and Decision Log after the first command-path conversion slice. This revision records ordinary run start, terminal finalization, and queue enqueue event writes, plus the remaining lifecycle paths that still need conversion before direct read-model writes can be removed.

Revision note, 2026-06-08 19:14Z: Updated Progress, Surprises & Discoveries, and Decision Log after switching the main frontend send/busy path to backend runtime-status. This revision records that the chat store remains a local display cache rather than busy truth.

Revision note, 2026-06-09 01:05Z: Updated Progress, Surprises & Discoveries, Outcomes, and acceptance wording after resolving the `backend_run_snapshots.run_id` ownership conflict and Claude Agent integration regressions. This revision records that diagnostic snapshot tables are not event-projected read models and captures the final validation commands that passed.

Revision note, 2026-06-09 06:25Z: Updated Progress, Surprises & Discoveries, Decision Log, Outcomes, and module documentation status after the final integration pass. This revision records the durable-binding/null-backend-session correction, no-event-only legacy recovery boundary, AI SDK usage-before-terminal fix, and the validation commands that now pass.

In `apps/server/src/modules/chat-runtime/event-store.ts`, expose:

    export interface AppendChatRuntimeEventsInput {
      streamId: string
      expectedSeq: number
      commandId?: string
      events: NewChatRuntimeEvent[]
    }

    export function readChatRuntimeEvents(streamId: string): ChatRuntimeEventRecord[]
    export function appendChatRuntimeEvents(input: AppendChatRuntimeEventsInput): ChatRuntimeEventRecord[]

In `apps/server/src/modules/chat-runtime/event-fold.ts`, expose:

    export interface ChatRuntimeFoldState {
      streamId: string
      seq: number
      activeRun: ChatRuntimeFoldRun | null
      latestRun: ChatRuntimeFoldRun | null
      runs: Map<string, ChatRuntimeFoldRun>
      messages: Map<string, ChatRuntimeFoldMessage>
      queue: Map<string, ChatRuntimeFoldQueueItem>
      providerBinding: ChatRuntimeFoldProviderBinding | null
      status: 'idle' | 'streaming' | 'error'
    }

    export function foldChatRuntimeEvents(streamId: string, events: ChatRuntimeEventRecord[]): ChatRuntimeFoldState

In `apps/server/src/modules/chat-runtime/replay/types.ts`, expose:

    export type ProviderReplayTarget =
      | 'normal_turn'
      | 'resume_session'
      | 'fork_thread'
      | 'compact_continue'
      | 'provider_target_switch'

    export interface ChatRuntimeReplayProjector<TOutput> {
      runtimeKind: RuntimeKind
      project(input: {
        events: ChatRuntimeEventRecord[]
        target: ProviderReplayTarget
        limits: ReplayLimits
      }): ProviderReplayProjection<TOutput>
    }

Provider directories must implement their replay projector locally. Chat Runtime may call the registry, but it must not centralize provider-specific tool-name rewriting.

Revision note (2026-06-08 18:33Z): Initial ExecPlan created from the agreed design. The plan front-loads provider replay projectors so the event log remains Cradle semantic history rather than an accidental provider payload store.
