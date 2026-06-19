# Clear Chat Runtime Live Projection Debt

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The file itself is the plan, so it intentionally omits an outer Markdown code fence. A future implementer must be able to start from only this file and complete the change without relying on chat history.

## Purpose / Big Picture

Cradle chat sessions must stop showing impossible states such as one view saying a run is finished while the message bubble still says it is streaming. After this refactor, Chat Runtime makes terminal lifecycle state monotonic by construction: terminal facts in `session_events` win over every late writer, and deterministic recovery can reproject historical drift from the event log. A user can verify the result by reproducing the two local corrupt sessions listed below before the change, running recovery after the change, and observing that session list, runtime status, message hydration, and durable run snapshots all agree on the same terminal state.

The deeper goal is to remove the historical debt left by the 2026-06-13 event-sourcing cutover. That cutover correctly made `session_events` the canonical lifecycle log, but it deliberately left active streaming snapshots as direct writes into the `messages` read model, and left the durable run snapshot finalizer without a terminal fence. Those two unfenced write paths have now proven unsafe: a stale in-memory active run can overwrite a terminal message projection after recovery has already written the correct `RunFailed` fact, and a stale finalizer can flip a `backend_run_snapshots` row from `failed` to `complete` after the projector already set it to `failed`. This plan adds terminal fencing to the existing writers rather than introducing a new live-snapshot table.

## Progress

- [x] (2026-06-19 16:44 +0800) Investigated the two reported sessions and confirmed they are not live active runs.
- [x] (2026-06-19 16:44 +0800) Confirmed the current architecture still direct-writes streaming snapshots into `messages` through `snapshotActiveRun()` and `persistMessageSnapshot()`.
- [x] (2026-06-19 16:44 +0800) Confirmed `finalizeRunSnapshot()` writes `backend_run_snapshots` without a `status='running'` fence, while the projector's `projectRunTerminal()` does fence on `status='running'`.
- [x] (2026-06-19 16:44 +0800) Confirmed existing recovery tests cover explicit recovery and read-path non-repair, but not late active-run snapshot writes after a terminal fact exists, nor message-vs-run drift reconciliation.
- [x] (2026-06-19 16:44 +0800) Wrote this cleanup ExecPlan.
- [ ] Add a centralized terminal fence helper and use it from streaming snapshot writes, terminal finalization, pending delta flush, and durable snapshot finalization.
- [ ] Split the streaming message write into a fenced `persistStreamingMessageSnapshot(activeRun)`; keep `persistMessageSnapshot` fence-free with no `runId` parameter.
- [ ] Fence `finalizeRunSnapshot()` on `status='running'` and record an observability event on conflict instead of overwriting a terminal status.
- [ ] Add deterministic drift reconciliation so terminal fact plus streaming message rows are reprojected from `session_events`.
- [ ] Add regression tests for stale active runs, late snapshot timers, late stream finalization, and historical drift recovery.
- [ ] Update Chat Runtime documentation.

## Surprises & Discoveries

- Observation: The two reported sessions are not running and have no pending await.
  Evidence: `cradle session get aa79921e-fe7a-45cc-bca9-1429e3a8b400` reported `status: idle`; `cradle session get 3653a378-6d07-48ef-81ad-b394c68eae00` reported `status: error`; runtime snapshot active runs did not include either session.

- Observation: Both bad runs have terminal canonical state but streaming message projections.
  Evidence from `/Users/wibus/Library/Application Support/@cradle/desktop/data/cradle.db`:

        [{"session_id":"3653a378-6d07-48ef-81ad-b394c68eae00","message_id":"14b183f4-33e1-4c54-89b8-4e52b77f481d","message_status":"streaming","message_updated_at":1781857874,"run_id":"7802388c-7511-4703-976e-a646c5a2aa95","run_status":"failed","stop_reason":"response.interrupted","finished_at":1781857806},
        {"session_id":"aa79921e-fe7a-45cc-bca9-1429e3a8b400","message_id":"d4d423a8-7636-432c-92fa-61984d696601","message_status":"streaming","message_updated_at":1781856507,"run_id":"c94270c8-327b-4e6a-abbe-56875009d029","run_status":"failed","stop_reason":"response.interrupted","finished_at":1781856450}]

- Observation: The event log already contains the correct terminal facts for both runs.
  Evidence:

        [{"aggregate_id":"3653a378-6d07-48ef-81ad-b394c68eae00","event_type":"AssistantMessageCompleted","message_id":"14b183f4-33e1-4c54-89b8-4e52b77f481d","message_status":"failed","run_id":null,"run_status":null,"occurred_at":1781857806},
        {"aggregate_id":"3653a378-6d07-48ef-81ad-b394c68eae00","event_type":"RunFailed","message_id":null,"message_status":null,"run_id":"7802388c-7511-4703-976e-a646c5a2aa95","run_status":"failed","occurred_at":1781857806},
        {"aggregate_id":"aa79921e-fe7a-45cc-bca9-1429e3a8b400","event_type":"AssistantMessageCompleted","message_id":"d4d423a8-7636-432c-92fa-61984d696601","message_status":"failed","run_id":null,"run_status":null,"occurred_at":1781856450},
        {"aggregate_id":"aa79921e-fe7a-45cc-bca9-1429e3a8b400","event_type":"RunFailed","message_id":null,"message_status":null,"run_id":"c94270c8-327b-4e6a-abbe-56875009d029","run_status":"failed","occurred_at":1781856450}]

- Observation: Durable run snapshots can also contradict canonical run facts when stale finalization continues after recovery.
  Evidence:

        [{"run_id":"7802388c-7511-4703-976e-a646c5a2aa95","status":"complete","completed_at":1781857879737,"completion_reason":"stop","final_message_bytes":null,"finalize_ms":null},
        {"run_id":"c94270c8-327b-4e6a-abbe-56875009d029","status":"complete","completed_at":1781856511517,"completion_reason":"stop","final_message_bytes":null,"finalize_ms":null}]

- Observation: The projector already fences durable snapshot terminal updates on `status='running'`, but the active-run finalizer does not.
  Evidence: `projectors.ts` `projectRunTerminal()` updates `backend_run_snapshots` with `where(and(eq(runId), eq(status, 'running')))`, so a terminal projection cannot overwrite another terminal status. `run-snapshot.ts` `finalizeRunSnapshot()` updates with only `where(eq(id, snapshotId))` and no status guard, so a late `complete` can overwrite an earlier `failed`.

- Observation: The original event-sourcing plan explicitly kept streaming message snapshot updates as direct read-model updates.
  Evidence: `docs/exec-plans/20260613-01-chat-runtime-event-sourcing.md` decision log says "keep streaming message snapshot updates as direct read-model updates during active streaming."

- Observation: The current code still implements that debt.
  Evidence: `apps/server/src/modules/chat-runtime/service.ts` has `snapshotActiveRun()` calling `persistMessageSnapshot({ messageStatus: 'streaming' })`, and `persistMessageSnapshot()` directly updates `messages` outside `session_events`.

- Observation: Renderer refresh of an in-progress run does not depend on the `messages` streaming row.
  Evidence: `openBufferedChunkStream()` (`service.ts` run stream opener) replays from the in-memory `activeRun.chunkBuffer`, not from the `messages` row. The `messages` streaming row only matters across a server-process restart where the active run is gone but the run row is still `streaming` — and that case is already recovered by `finalizeInterruptedRunsForSession()`. Therefore fencing the streaming write in place preserves refresh behavior; a separate live buffer table is not needed to keep refresh working.

- Observation: Existing recovery tests do not pin the newly observed failure.
  Evidence: `apps/server/tests/chat-runtime-recovery.test.ts` verifies explicit recovery and read-path non-repair. `apps/server/tests/chat-runtime.test.ts` has a stale-active-run test that expects the message to remain streaming until explicit recovery, but it does not assert that a late snapshot/finalizer cannot re-stream a terminal message after the terminal fact exists.

## Decision Log

- Decision: Treat this as a fencing cleanup, not a new read-model introduction.
  Rationale: The failure happened because two writers (`persistMessageSnapshot` for streaming messages, `finalizeRunSnapshot` for diagnostics) lacked the terminal-state fence that the projector already enforces. Adding the fence to the existing writers fixes the root cause without a new table, a new migration, or a new read-merge path. This matches CLAUDE.md's guidance against inventing new projections.
  Date/Author: 2026-06-19 / Codex

- Decision: Keep `session_events` as the only durable source for terminal lifecycle facts.
  Rationale: The correct facts already exist in the reported corrupt sessions. The failure is not missing facts; it is stale direct projection writes after facts were appended.
  Date/Author: 2026-06-19 / Codex

- Decision: Keep `messages` as the single assistant transcript table, including its streaming rows, but make streaming writes non-mutating once a terminal fact exists.
  Rationale: A live snapshot table was considered and rejected. Renderer refresh hydrates from the in-memory SSE replay buffer, not from the `messages` streaming row, so the only job of the streaming row is cross-process-restart continuity — already covered by interrupted-run recovery. Fencing the write in place is the smaller, sufficient change. Splitting the table would add a migration, a read-merge at the route boundary, and a lifecycle-delete path for a narrow benefit that does not exist yet.
  Date/Author: 2026-06-19 / Codex

- Decision: Make terminal status monotonic in code and tests rather than relying on informal call ordering.
  Rationale: Late chunks, timers, and provider process exits are normal distributed-system behavior. The system must make terminal facts win by construction.
  Date/Author: 2026-06-19 / Codex

- Decision: Reconcile historical drift from facts, not from `backend_run_snapshots`.
  Rationale: Durable run snapshots are forensic records. They are useful evidence that a stale finalizer fired, but they must not decide user-visible session state.
  Date/Author: 2026-06-19 / Codex

## Outcomes & Retrospective

Not implemented yet. This plan records the intended fencing refactor and the local evidence motivating it. The expected end state is that the two reported sessions can be repaired by deterministic recovery, and that future stale active runs cannot write `messages.status = streaming` after a terminal fact exists, nor flip a terminal `backend_run_snapshots` status to a different terminal status.

## Context and Orientation

Chat Runtime lives under `apps/server/src/modules/chat-runtime`. It owns chat turn execution, session-scoped queueing, live streaming, runtime status, persisted message snapshots, backend run rows, and diagnostic run snapshots. Provider adapters such as Codex live under `apps/server/src/modules/chat-runtime-providers`; providers own native protocol semantics, but Chat Runtime owns Cradle session lifecycle facts and HTTP projections.

The table `session_events` is the append-only fact log for Chat Runtime lifecycle facts. "Append-only" means new rows are inserted for facts instead of updating old facts. The event types are defined in `apps/server/src/modules/chat-runtime/es/events.ts`. The important event types for this plan are `RunStarted`, `AssistantMessageCompleted`, and one terminal run event: `RunCompleted`, `RunFailed`, or `RunAborted`.

The tables `messages`, `backend_runs`, `chat_session_queue_items`, selected `sessions` fields, and `backend_run_snapshots` are read models. A read model is a table optimized for reads and derived from facts. The same-transaction projector lives in `apps/server/src/modules/chat-runtime/es/projectors.ts`. It updates `messages` when `AssistantMessageCompleted` is appended and updates `backend_runs`, queue rows, and `backend_run_snapshots` when a terminal run fact is appended.

The current live streaming path lives mainly in `apps/server/src/modules/chat-runtime/service.ts`. Active provider chunks are stored in memory on an `ActiveRun`. The function `projectFinalMessageChunk()` from `apps/server/src/modules/chat-runtime/run/final-message-projection.ts` incrementally builds a final assistant `UIMessage`. The current `snapshotActiveRun()` periodically flushes that active projection and calls `persistMessageSnapshot()` with `messageStatus: 'streaming'`, directly updating the `messages` table. This direct write is the debt to fence, not to relocate.

The durable diagnostic snapshot layer lives in `apps/server/src/modules/chat-runtime/run-snapshot.ts` and `apps/server/src/modules/chat-runtime/run/snapshot-events.ts`. It records ordered phases such as text deltas, tool outputs, usage, and finalization. These snapshots are forensic diagnostics, not the session source of truth. Their terminal status must mirror terminal run facts or remain explicitly marked as late/ignored; they must not contradict `backend_runs`. Today `finalizeRunSnapshot()` writes without a status fence; the projector's `projectRunTerminal()` already fences on `status='running'`.

The database schema for these tables is in `packages/db/src/schema/chat.ts`. The existing `session_events.subject_run_id` generated column and `session_events_terminal_fact_run_unique` index already enforce one terminal fact per session run. This plan reuses that invariant instead of adding another terminal identity mechanism. No schema change or migration is required.

Important existing tests are in `apps/server/tests/chat-runtime-recovery.test.ts` and `apps/server/tests/chat-runtime.test.ts`. The recovery test file already has helpers for temp data directories, seeding sessions, messages, backend runs, and queue rows. The broader chat runtime test file already has real streaming tests with a blocking test runtime and `flushAllActiveRunSnapshots()`.

Define these terms before using them in implementation:

An active run is the in-memory representation of a provider turn currently streaming. It lives in `runRegistry` and contains replay chunks, pending timers, the final assistant projection, runtime handle, and identifiers.

A terminal fact is one of `RunCompleted`, `RunFailed`, or `RunAborted`. Once one exists for a run, the run can never go back to `streaming`.

Terminal fencing means every live writer checks the persisted terminal state before mutating read models or diagnostics. If a terminal fact or terminal run row already exists, late writers stop and release resources instead of writing another status. This is a deterministic database fence, not a heuristic: it reads `backend_runs.status` for the run id before writing.

## Plan of Work

Start by adding a single terminal fence helper. Create `apps/server/src/modules/chat-runtime/run/run-write-fence.ts` (or place it alongside the existing run-status read helpers if a more natural home exists). It answers one question: "is this run still allowed to be written as streaming?" It reads `backend_runs` for the run id and returns `streaming`, the terminal status with error text, or `missing`. It must not be a heuristic and must not inspect in-memory state — the source of truth is the persisted run row.

Then split the streaming message snapshot write off into its own fenced helper. Add `persistStreamingMessageSnapshot(activeRun)` next to `snapshotActiveRun()` in `service.ts` (or in a small `run/` module if it keeps `service.ts` smaller). It takes the `ActiveRun` directly, calls `readRunWriteFence(activeRun.runId)` first, and only proceeds to write `messages` with `status='streaming'` when the fence returns `streaming`. If the fence returns terminal or missing, it sets `activeRun.terminalStatus` to the persisted terminal status, releases the run through the existing `releaseActiveRun()` path, and returns without writing. `persistMessageSnapshot()` is left untouched as the fence-free event-derived writer: it keeps its current signature with no `runId` parameter, and its only remaining callers are the terminal projection (already inside `commitSessionEvents` via `persistTerminalMessageSnapshot`) and the non-streaming record mutation in `resolvePlanImplementationApproval()`. `snapshotActiveRun()` now calls `persistStreamingMessageSnapshot(activeRun)` instead of `persistMessageSnapshot({ messageStatus: 'streaming' })`.

Next, fence durable run snapshot finalization. In `finalizeRunSnapshot()` (`run-snapshot.ts`), change the `update(backendRunSnapshots)` `where` clause from `eq(id)` to `and(eq(id), eq(status, 'running'))`. This mirrors the projector's `projectRunTerminal()` fence. If the update affects zero rows (the snapshot is already terminal), record an observability event `CHAT_LATE_RUN_FINALIZATION_IGNORED` with run id, session id, previous status (read back before the attempted update, or null), attempted status, and provider target id, and do not overwrite the existing terminal status, `completionReason`, or `errorText`. Keep `projectRunTerminal()` in `projectors.ts` as the authoritative terminal status update for `backend_run_snapshots`.

Then centralize terminal finalization around the same fence. `publishTerminalChunk()` currently calls `finalizeActiveRun()`, which appends `AssistantMessageCompleted` plus a terminal run fact through `commitSessionEvents()`. Keep that fact append as the only way to make durable terminal state. Before appending, `finalizeActiveRun()` (and the `persistRunTerminalAndUsage()` path that calls it) should read the fence for the run id; if the run is no longer streaming, emit no new terminal fact, set `activeRun.terminalStatus` to the persisted terminal status, and return that status. This protects against stale active runs that continue after recovery. The existing `session_events_terminal_fact_run_unique` index already prevents a duplicate terminal fact at the storage layer; the fence makes the in-memory path fail fast and release resources instead of relying on the index to throw.

Add deterministic drift reconciliation. Extend `recoverChatRuntimeProjections()` and `recoverChatRuntimeSession(sessionId)` in `apps/server/src/modules/chat-runtime/es/commands.ts`, or split a new `apps/server/src/modules/chat-runtime/es/recovery.ts`, so recovery detects rows where `backend_runs.status` is terminal while the joined `messages.status` is still `streaming`, and rows where a terminal fact exists but `backend_run_snapshots.status` disagrees with `backend_runs.status`. Reprojection must use the existing `AssistantMessageCompleted` and terminal run fact payloads from `session_events`, not `backend_run_snapshots`. Because the event log already carries the terminal `AssistantMessageCompleted(status=failed)` fact for both reported sessions, recovery should re-apply that fact's message projection (set the message row to `failed`) rather than synthesize a new fact. For snapshot drift, recovery should set the snapshot terminal status to match the run's terminal status from the terminal run fact, or otherwise mark the late finalization as ignored consistently with the runtime fence's behavior. For the two local corrupt sessions, recovery should update the message rows to `failed`, keep `backend_runs` failed, and reconcile the durable snapshot to `failed`.

Update documentation. In `apps/server/src/modules/chat-runtime/README.md`, add a short note that streaming message snapshot writes are terminal-fenced: once a terminal fact exists for a run, late streaming writers no-op and release the active run, and recovery reconciles any historical message-vs-run drift from `session_events`. Update the recovery section for drift reconciliation. Do not introduce a live-snapshot table into the docs.

Finally, add tests before relying on manual inspection. Tests must prove the new invariants: fenced streaming snapshots cannot mutate a terminal message, late finalizers cannot overwrite a terminal `backend_run_snapshots` status, recovery fixes terminal fact plus streaming message drift, snapshot terminal status cannot contradict `backend_runs`, and ordinary read APIs still do not append recovery events.

## Concrete Steps

1. Check the worktree:

        cd /Users/wibus/dev/Cradle
        git status --short

   There may be unrelated local changes. Do not revert them. Keep edits scoped to Chat Runtime and tests required for this refactor. No DB schema or migration changes are expected.

2. Add the terminal fence helper. Prefer a new file `apps/server/src/modules/chat-runtime/run/run-write-fence.ts` if it keeps `service.ts` smaller, otherwise place it next to the existing run-status read helper. The helper reads `backend_runs` for the run id and returns one of:

        export type RunWriteFence =
          | { status: 'streaming' }
          | { status: 'complete' | 'failed' | 'aborted'; errorText: string | null }
          | { status: 'missing' }

        export function readRunWriteFence(runId: string): RunWriteFence

   Use it from streaming snapshot persistence, terminal finalization, pending delta flush, and durable snapshot finalization. Do not scatter ad hoc `getRun()` checks; route them through this helper.

3. Add the fenced streaming writer. Create `persistStreamingMessageSnapshot(activeRun: ActiveRun)` next to `snapshotActiveRun()` in `service.ts`. It calls `readRunWriteFence(activeRun.runId)` first; on `streaming` it writes `messages` with `status='streaming'` using the existing `compactStoredMessageSnapshot` / `normalizeMessageSnapshot` / `extractMessageText` helpers; on terminal or missing it sets `activeRun.terminalStatus` to the persisted terminal status, calls `releaseActiveRun(activeRun)`, and returns without writing. Change `snapshotActiveRun()` to call this helper instead of `persistMessageSnapshot({ messageStatus: 'streaming' })`. Leave `persistMessageSnapshot()` with its current signature and no `runId`; its remaining callers are the terminal projection inside `commitSessionEvents` and the non-streaming record mutation in `resolvePlanImplementationApproval()`. Expected result: no code path writes `messages.status = 'streaming'` for a run whose `backend_runs` row is already terminal, and `persistMessageSnapshot` never touches `runId`.

4. Fence `finalizeRunSnapshot()` in `run-snapshot.ts`. Change the `update(backendRunSnapshots)` `where` to `and(eq(backendRunSnapshots.id, input.snapshotId), eq(backendRunSnapshots.status, 'running'))`. Detect a zero-rows-affected result (Drizzle `.run().changes === 0`); when that happens, record `CHAT_LATE_RUN_FINALIZATION_IGNORED` via the existing observability path with run id, session id, previous status, attempted status, and provider target id, and return without overwriting the row. Keep `projectRunTerminal()` in `projectors.ts` unchanged as the authoritative terminal snapshot update.

5. Refactor finalization around the fence. In `finalizeActiveRun()` (`service.ts`), before appending events via `persistTerminalMessageSnapshot()`, call `readRunWriteFence(activeRun.runId)`. If the fence returns terminal or missing, do not append a new terminal fact (the `session_events_terminal_fact_run_unique` index would reject a duplicate anyway — fail fast instead); set `activeRun.terminalStatus` to the persisted terminal status and return. `persistRunTerminalAndUsage()` inherits this protection because it calls `publishTerminalChunk()` → `finalizeActiveRun()`. Do not insert usage or finalize diagnostics for a stale run whose persisted terminal status does not match the final chunk this active run is trying to write.

6. Add recovery for drift. In `apps/server/src/modules/chat-runtime/es/commands.ts` or a new recovery module, add a function that finds terminal `backend_runs` rows whose joined `messages.status` is still `streaming`. For each, locate the matching `AssistantMessageCompleted` fact and terminal run fact from `session_events`, then re-apply the message projection from the `AssistantMessageCompleted` payload (set `messages` to the fact's `status`/`content`/`messageJson`/`errorText`) in the per-session actor. Because `session_events_terminal_fact_run_unique` already enforces one terminal fact, this is deterministic. Also reconcile `backend_run_snapshots` rows whose status disagrees with the run's terminal status from the terminal run fact. The recovery result grows a new count:

        export interface ChatRuntimeRecoveryResult {
          interruptedRunsFinalized: number
          terminalFactsProjected: number
          terminalProjectionDriftsRepaired: number
        }

   Update all call sites that read `ChatRuntimeRecoveryResult`: `apps/server/src/modules/chat-runtime/service.ts` (`recoverPersistedRunProjections`), `apps/server/src/app.ts`, `apps/server/src/index.ts`, and tests. This is a breaking internal API change and should not carry old fallback fields.

7. Update tests in `apps/server/tests/chat-runtime-recovery.test.ts`. Add a seeded test matching the two local corrupt sessions: a terminal `backend_runs` row, existing `AssistantMessageCompleted(status=failed)` and `RunFailed`, a `messages.status = streaming` row updated later, and a conflicting `backend_run_snapshots.status = complete`. Run recovery and assert the message becomes failed, the run remains failed, the snapshot no longer contradicts the run, and a second recovery call reports zero changes (idempotence).

8. Update tests in `apps/server/tests/chat-runtime.test.ts`. Extend the existing active streaming snapshot test so it asserts that an active flush still updates `messages` for a streaming run (refresh continuity preserved), but that the same flush becomes a no-op once the run's `backend_runs` row is manually marked terminal. Add a stale active-run test where a run is manually marked failed, `flushAllActiveRunSnapshots()` is called, and the message remains failed rather than returning to streaming. Add a late-finalizer test where the blocked runtime releases after recovery and verify the terminal fact and durable run snapshot stay failed.

9. Search for forbidden unfenced streaming writes:

        rg -n "messageStatus: 'streaming'" apps/server/src/modules/chat-runtime

   Expected result: no remaining `messageStatus: 'streaming'` literal — the streaming write now lives in `persistStreamingMessageSnapshot`, which does not take a `messageStatus` field. Event projectors can still update `messages` for `RunStarted`, `AssistantMessageCompleted`, `SteerApplied`, and user messages.

10. Run focused validation:

        pnpm --filter @cradle/server exec vitest run apps/server/tests/chat-runtime-recovery.test.ts
        pnpm --filter @cradle/server exec vitest run apps/server/tests/chat-runtime.test.ts --testNamePattern "active streaming snapshots|stale active run|late"
        pnpm --filter @cradle/server typecheck

   Expected result: focused tests pass and server typecheck passes.

11. Run the local corrupt-session reconciliation against a copy of the desktop DB, not the original first. Copy `/Users/wibus/Library/Application Support/@cradle/desktop/data/cradle.db` to a temporary path, point `CRADLE_DATA_DIR` at a temporary directory containing that copy, and run the recovery entry point. Verify the two session ids from this plan no longer have streaming assistant messages joined to terminal runs. Only after this succeeds should the real desktop DB be allowed to recover through normal server startup.

## Validation and Acceptance

The user-visible acceptance criterion is simple: no Cradle screen should show a session as both running and not running for the same backend run. For the two local sessions in this plan, after recovery, `cradle session get aa79921e-fe7a-45cc-bca9-1429e3a8b400` should stay `idle` or terminal according to latest run semantics, `cradle session get 3653a378-6d07-48ef-81ad-b394c68eae00` should stay `error`, and `cradle session messages <id>` should not show the failed assistant message as `streaming`.

Database acceptance for the reproduced drift is:

        select m.session_id, m.id, m.status, r.id, r.status
        from messages m
        join backend_runs r on r.message_id = m.id
        where r.status in ('complete', 'failed', 'aborted')
          and m.status = 'streaming';

Expected result after recovery: no rows.

Durable snapshot acceptance is:

        select s.run_id, s.status as snapshot_status, r.status as run_status
        from backend_run_snapshots s
        join backend_runs r on r.id = s.run_id
        where r.status in ('complete', 'failed', 'aborted')
          and s.status != r.status;

Expected result after recovery: no rows for Chat Runtime-owned current snapshots, unless a deliberate forensic conflict marker is introduced and documented. If a conflict marker is chosen instead of rewriting snapshot status, this query must be replaced by an explicit documented invariant.

Refresh-continuity acceptance is that active streaming refresh still works. Start a run with a blocking test runtime or an actual long Codex turn, force `flushAllActiveRunSnapshots()`, refresh the renderer, and observe the partial assistant text replays from the SSE buffer. Then finish or interrupt the run and verify the durable message row is terminal. (There is no separate live-snapshot row to clean up in this design.)

Regression acceptance is that a stale active run cannot reverse terminal state. The focused test should create a streaming run, mark its `backend_runs` row failed through recovery or a direct setup step, flush active snapshots, release the provider stream with a finish chunk, and assert that `messages.status`, `backend_runs.status`, and `backend_run_snapshots.status` remain failed.

Performance acceptance is that ordinary reads still do not append session events. Reuse the existing recovery test pattern: record `count(*)` from `session_events`, call message and runtime-status routes, and assert the count is unchanged.

## Idempotence and Recovery

All new recovery work must be idempotent. Running `recoverPersistedRunProjections()` twice on the same database should repair drift the first time and report zero repairs the second time. Terminal facts must not be duplicated; the existing `session_events_terminal_fact_run_unique` index remains the invariant.

No migration is required by this plan — it is purely code and tests. For the real desktop database, do not manually edit rows during development. First prove recovery against a copied DB. Because this project has not shipped a stable release, do not add compatibility code that preserves invalid mixed projections. Invalid historical projections should be deterministically reprojected from facts.

If implementation discovers duplicate terminal facts despite the unique index, stop and record the exact rows in this plan. Do not pick a terminal winner heuristically. The correct response is to repair the event log invariant explicitly or fail with a clear error.

If a provider continues streaming after Chat Runtime has fenced the run as terminal, the stream should be drained or cancelled best-effort, but late chunks must not update durable projections. This is safe to retry because the terminal fact has already won.

## Artifacts and Notes

The two local sessions that motivated this plan are:

        aa79921e-fe7a-45cc-bca9-1429e3a8b400
        3653a378-6d07-48ef-81ad-b394c68eae00

The desktop database used for evidence was:

        /Users/wibus/Library/Application Support/@cradle/desktop/data/cradle.db

The current unfenced streaming writer is:

        function snapshotActiveRun(activeRun: ActiveRun): void {
          if (activeRun.terminalStatus) {
            return
          }
          flushFinalMessageProjection(activeRun)
          persistMessageSnapshot({
            sessionId: activeRun.sessionId,
            messageId: activeRun.messageId,
            message: activeRun.finalMessage,
            messageStatus: 'streaming',
            errorText: null
          })
        }

The intended replacement shape is:

        snapshotActiveRun(activeRun)
          -> flushFinalMessageProjection(activeRun)
          -> persistStreamingMessageSnapshot(activeRun)
               -> readRunWriteFence(activeRun.runId)
               -> if terminal/missing: releaseActiveRun(activeRun), no write
               -> else: write messages with status='streaming'

`persistMessageSnapshot()` keeps its current signature (no `runId`) and is now used only by the event-derived terminal projection and the non-streaming record mutation, not by the streaming path.

The current unfenced durable snapshot finalizer is `finalizeRunSnapshot()` in `run-snapshot.ts`, which updates `backend_run_snapshots` with `where(eq(id))`. The intended replacement adds `and(eq(id), eq(status, 'running'))` and records `CHAT_LATE_RUN_FINALIZATION_IGNORED` on a zero-rows-affected result.

The old event-sourcing plan is `docs/exec-plans/20260613-01-chat-runtime-event-sourcing.md`. It is useful background but not required to execute this plan; this plan embeds the necessary context.

The recovery performance plan is `docs/exec-plans/20260619-04-chat-runtime-recovery-sqlite.md`. It already introduced indexed terminal facts and explicit recovery. This plan builds on that by fencing the remaining direct streaming and diagnostic writers rather than relocating them.

## Interfaces and Dependencies

Use Drizzle ORM for database access. No schema change is required. The existing `session_events_terminal_fact_run_unique` index is the terminal-fact invariant this plan relies on.

Add a terminal fence helper with an interface like:

        export type RunWriteFence =
          | { status: 'streaming' }
          | { status: 'complete' | 'failed' | 'aborted'; errorText: string | null }
          | { status: 'missing' }

        export function readRunWriteFence(runId: string): RunWriteFence

Use this helper from live snapshot persistence, terminal finalization, pending delta flush, and durable snapshot finalization. The goal is one explicit terminal-state gate, not scattered checks.

The streaming write path becomes a dedicated fenced helper that takes the `ActiveRun` directly:

        export function persistStreamingMessageSnapshot(activeRun: ActiveRun): void

It calls `readRunWriteFence(activeRun.runId)` internally and either writes `messages` with `status='streaming'` or releases the run without writing. `persistMessageSnapshot()` is unchanged and takes no `runId`:

        export interface PersistMessageSnapshotInput {
          sessionId: string
          messageId: string
          message: UIMessage
          messageStatus: ChatMessageStatus
          errorText: string | null
        }

`persistMessageSnapshot` is now used only by event-derived paths (the terminal projection inside `commitSessionEvents`) and the non-streaming record mutation in `resolvePlanImplementationApproval()`. Both helpers accept `UIMessage` directly and use existing `compactStoredMessageSnapshot`, `normalizeMessageSnapshot`, and `extractMessageText` helpers. Do not parse the message through `unknown` helpers.

Recovery result grows a drift count:

        export interface ChatRuntimeRecoveryResult {
          interruptedRunsFinalized: number
          terminalFactsProjected: number
          terminalProjectionDriftsRepaired: number
        }

If this interface is exposed outside tests, update all call sites in `apps/server/src/modules/chat-runtime/service.ts`, `apps/server/src/app.ts`, `apps/server/src/index.ts`, and tests. This is a breaking internal API change and should not carry old fallback fields.

Revision note, 2026-06-19 16:44 +0800: Initial plan created after investigating two sessions with terminal run facts but streaming message projections. The plan originally proposed a dedicated live-snapshot table; that was rejected after confirming renderer refresh hydrates from the in-memory SSE replay buffer rather than the `messages` streaming row, making the table's only benefit (cross-process-restart continuity) already covered by interrupted-run recovery. The revised plan fences the existing streaming and diagnostic writers in place and adds fact-based drift recovery.
