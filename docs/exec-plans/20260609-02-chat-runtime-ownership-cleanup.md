# Clean Up Chat Runtime Event Ownership

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository uses the ExecPlan rules from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. This document follows those rules: it is self-contained, uses plain language, describes observable outcomes, and must be revised whenever implementation progress or decisions change.

## Purpose / Big Picture

This work fixes a confusing split-brain state in Cradle's chat runtime. Today, `backend_session_bindings` can be written by both Chat Runtime event projection and Provider Runtime directory code. That means a later event replay can overwrite a provider binding with an older snapshot, causing a chat session to resume the wrong provider thread or lose the newest provider state. The user-visible outcome is that chat sessions resume reliably after runs, restarts, and projections because one owner writes durable provider bindings.

This work also makes the "session is busy" check use durable runtime truth instead of stale in-memory handles. After the change, a new chat run should not be rejected with `chat_run_in_progress` when the event history already says the previous run has ended. Finally, the plan removes misleading provider replay documentation, adds minimal event payload validation at the append boundary, fixes a message projection fallback that can copy text from the wrong message, and restores a frontend composer slot filter for pending user-input prompts.

## Progress

- [x] (2026-06-09 09:41Z) Read the ExecPlan rules and confirmed this task is complex enough to need a plan because it changes ownership boundaries across Chat Runtime, Provider Runtime, event storage, projectors, tests, and one frontend selector.
- [x] (2026-06-09 09:41Z) Compared the proposed approach with `/Users/wibus/dev/lobehub`; that system uses DB message snapshots and runtime state as canonical truth while stream events are delivery/replay only, which supports narrowing Cradle's event ownership rather than expanding it.
- [x] (2026-06-09 09:41Z) Wrote this ExecPlan as `docs/exec-plans/20260609-02-chat-runtime-ownership-cleanup.md`.
- [x] (2026-06-09 09:58Z) Updated Chat Runtime, Provider Runtime, and provider README files so `backend_session_bindings` is clearly Provider Runtime-owned and Chat Runtime events are lifecycle/status history, not the binding source of truth.
- [x] (2026-06-09 09:58Z) Changed `apps/server/src/modules/chat-runtime/projector.ts` so it no longer writes `backendSessionBindings`; it only reads the current Provider Runtime binding id to link projected run rows.
- [x] (2026-06-09 10:02Z) Updated projector tests to prove event replay does not overwrite an existing Provider Runtime binding and still projects runs, messages, and queue items idempotently.
- [x] (2026-06-09 10:02Z) Changed `createRun()` busy gating so event-derived active run state decides whether a session is actually busy; in-memory maps remain live-handle hints only.
- [x] (2026-06-09 10:09Z) Added a focused integration test that appends a terminal run event while a runtime stream is still blocked in memory, then verifies a second `/response` request starts instead of returning `chat_run_in_progress`.
- [x] (2026-06-09 10:02Z) Added lightweight semantic validation for `chat_runtime_events` payloads before append, with tests for accepted and rejected canonical events.
- [x] (2026-06-09 10:02Z) Fixed message projector fallback so it only uses text events for the same `messageId`.
- [x] (2026-06-09 09:58Z) Reconciled provider replay helpers and documentation by keeping them as experimental diagnostic/future migration helpers, not the live provider input path.
- [x] (2026-06-09 10:13Z) Verified the composer `userInput` slot filter is present in the current file and removed formatting-only churn so there is no net frontend diff for that file.
- [x] (2026-06-09 10:13Z) Ran focused verification commands and recorded the results here.
- [x] (2026-06-09 10:38Z) Removed provider binding projection state from `event-fold.ts` and deleted the unused binding update event type. The remaining run-start provider metadata event is being renamed away from binding terminology; Provider Runtime remains the durable binding owner.
- [x] (2026-06-09 11:12Z) Renamed the former binding-named run-start provider metadata event to `run.provider_context_recorded` across Chat Runtime code, tests, and module documentation. The event records provider context for a run and does not represent durable binding lifecycle.

## Surprises & Discoveries

- Observation: The similar lobehub runtime is not fully event-sourced. Its `StreamEventManager` comments say message snapshots are canonical in the database and stream events strip heavy `finalState.messages`; its coordinator saves `AgentState` and then publishes stream terminal events. This supports treating Cradle stream/replay events as transport or lifecycle history only where they actually own semantics.
  Evidence: `/Users/wibus/dev/lobehub/src/server/modules/AgentRuntime/StreamEventManager.ts` says the canonical message copy lives in DB, and `/Users/wibus/dev/lobehub/src/server/modules/AgentRuntime/AgentRuntimeCoordinator.ts` saves state before publishing terminal events.
- Observation: Current Cradle docs contradict each other. `apps/server/src/modules/chat-runtime/README.md` says `backend_session_bindings` is projected from `chat_runtime_events`, while `apps/server/src/modules/provider-runtime/README.md` says `directory.ts` owns durable provider runtime bindings.
  Evidence: Chat Runtime README lists `backend_session_bindings` in its projected read models; Provider Runtime README states `directory.ts owns durable provider runtime bindings`.
- Observation: The provider replay helper already recognizes `tool_call.user_input_requested` and `tool_call.user_input_answered`, so the specific claim that replay only supports `tool_call.requested` and `tool_call.result_recorded` is stale. The broader concern remains valid because the live provider paths still use transcript/UIMessage input rather than these replay projectors.
  Evidence: `apps/server/src/modules/chat-runtime/replay/tool-events.ts` accepts both generic tool events and `tool_call.user_input_*`; `openai-compatible/provider.ts` builds model messages from `input.history`, and `codex/provider.ts` injects reconstructed transcript history.

- Observation: The first projector verification failed because the test inserted a `backend_session_bindings.providerTargetId` that had no matching `provider_targets` row. The test only needed an existing durable binding row, so `providerTargetId: null` was the correct minimal fixture.
  Evidence: `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/projector.test.ts ...` initially failed with `SqliteError: FOREIGN KEY constraint failed` at `projector.test.ts:99`, then passed after the fixture stopped depending on an unrelated provider target.

- Observation: The synthetic create-run gate test can log snapshot foreign-key errors when it releases the deliberately blocked first stream after the event log has already marked that run terminal and the gate has released the active handle. This is an artifact of the test forcing an impossible same-process stale stream; the assertion still proves the create command uses event-derived terminal state instead of stale memory as the busy truth.
  Evidence: The targeted test `uses terminal event state instead of stale memory handles when creating a run` passed, while logging `failed to append run snapshot event` for the artificially released old stream.

## Decision Log

- Decision: Provider Runtime remains the only writer for durable provider bindings in `backend_session_bindings`.
  Rationale: A durable provider binding answers "which provider-native session can this Cradle session resume?" That depends on provider runtime semantics such as whether a provider returns a resumable session id. Provider Runtime already owns this policy in `provider-runtime/directory.ts` and `provider-runtime/service.ts`. Chat Runtime may read the binding id for run rows, but must not mutate the binding table from event projection.
  Date/Author: 2026-06-09 / Codex

- Decision: Chat Runtime events remain canonical for run lifecycle, queue lifecycle, and runtime status, but not for provider binding persistence.
  Rationale: The current event fold is useful for answering whether a run is active, terminal, failed, or queued. Extending it to own provider binding snapshots creates the rollback bug this plan fixes.
  Date/Author: 2026-06-09 / Codex

- Decision: Do not wire provider replay projectors into the live provider path in this plan.
  Rationale: Provider replay touches normal chat turns, native approval continuation, Codex native history injection, and provider-specific transcript behavior. That is a larger migration with different risks. This plan should first remove misleading claims and keep runtime behavior stable.
  Date/Author: 2026-06-09 / Codex

- Decision: Add lightweight Zod validation for event payload semantics at append time.
  Rationale: `chat_runtime_events` is used as canonical run lifecycle history, so accepting any JSON object makes projectors guess fields. A small discriminated validation layer catches malformed canonical events without introducing a new framework.
  Date/Author: 2026-06-09 / Codex

- Decision: Test the run creation busy gate through the HTTP `/response` route instead of exporting a private helper only for tests.
  Rationale: The review concern was about the create command returning `chat_run_in_progress` when events were already terminal. The route-level test proves that exact behavior while still using the real in-memory maps, event store, projector, and runtime registry.
  Date/Author: 2026-06-09 / Codex

## Outcomes & Retrospective

Completed. Provider Runtime is now documented and enforced as the only writer of durable provider bindings; Chat Runtime projection no longer creates or overwrites `backend_session_bindings`. Chat Runtime events are canonical for run lifecycle, queue lifecycle, and runtime status, and `createRun()` now uses event-derived active run state before consulting stale memory handles. Provider replay helpers remain in the tree only as diagnostic/future migration helpers, not as the live provider input path. Event appends validate required semantic fields, message fallback projection no longer copies text across message ids, and the event fold no longer exposes provider binding state.

Verification completed from `/Users/wibus/dev/Cradle`:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/projector.test.ts src/modules/chat-runtime/event-store.test.ts src/modules/chat-runtime/event-fold.test.ts src/modules/chat-runtime/runtime-state.test.ts
    Result: 4 test files passed, 14 tests passed.

    pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts -t "uses terminal event state instead of stale memory handles when creating a run"
    Result: 1 test passed, 48 skipped by the name filter.

    pnpm typecheck:server
    Result: passed.

    pnpm typecheck:apps-web
    Result: passed.

The broad `pnpm test:server` command was not run because this task already sits on a dirty feature branch with many existing server test files and the focused tests cover the ownership, event validation, projection, runtime-state, and create-gate behavior changed here.

## Context and Orientation

This repository's server code lives under `apps/server/src/modules`. "Chat Runtime" is the server module under `apps/server/src/modules/chat-runtime` that creates chat runs, writes chat messages, streams model output, stores run lifecycle events, and projects read models for existing queries. "Provider Runtime" is the module under `apps/server/src/modules/provider-runtime` that chooses or resumes provider-native runtime sessions, such as Codex app-server threads or other provider sessions.

A "durable provider binding" is the row in `backend_session_bindings` that stores the provider target, runtime kind, provider-native session id, provider state snapshot, and requested model for a Cradle chat session. A provider-native session id is only useful when it can resume a provider conversation later. The Provider Runtime module has the policy for when such a binding should exist.

An "event fold" means reading ordered `chat_runtime_events` for one session and reducing them into a current state object. In this repository that reducer is `apps/server/src/modules/chat-runtime/event-fold.ts`. The fold derives active/latest run state, messages, and queue items. Provider binding information may appear as run-start event metadata, but it is not fold state and must not be projected into `backend_session_bindings`.

A "read model" is a database table optimized for existing queries or UI hydration, not necessarily the canonical source of truth. In this task, `backend_runs`, `messages`, and `chat_session_queue_items` remain Chat Runtime-projected read models. `backend_session_bindings` stops being a Chat Runtime-projected read model and is written only through Provider Runtime.

The files most likely to change are:

- `apps/server/src/modules/chat-runtime/README.md`, which currently overclaims that `backend_session_bindings` is a Chat Runtime read model.
- `apps/server/src/modules/provider-runtime/README.md`, which already states Provider Runtime owns durable bindings and may need a clarification that Chat Runtime can read but not project them.
- `apps/server/src/modules/chat-runtime/projector.ts`, which currently writes `backendSessionBindings` and passes a projected binding id to backend run rows.
- `apps/server/src/modules/chat-runtime/projector.test.ts`, which currently expects binding rows to be rebuilt from events.
- `apps/server/src/modules/chat-runtime/service.ts`, especially `createRun()` and helper functions around `activeRunIdsBySession`, `pendingRunSessions`, `readEventDerivedRuntimeState`, and `releaseTerminalActiveHandleForSession`.
- `apps/server/src/modules/chat-runtime/events.ts` and `apps/server/src/modules/chat-runtime/event-store.ts`, which currently allow payload as a generic `Record<string, unknown>` and only parse JSON object shape.
- `apps/server/src/modules/chat-runtime/replay/*` and provider replay README entries, which should be described as experimental/future unless they are wired.
- `apps/web/src/features/chat/composer/composer-slot-states.tsx`, where `userInput` slot state should be filtered by declared composer slot ids.

## Plan of Work

First, update documentation before code so the ownership decision is explicit. `apps/server/src/modules/chat-runtime/README.md` should say `chat_runtime_events` is canonical for Chat Runtime run lifecycle, queue lifecycle, and runtime status. It should say `backend_runs`, `messages`, and `chat_session_queue_items` are projected read models. It should not list `backend_session_bindings` as Chat Runtime-owned. `apps/server/src/modules/provider-runtime/README.md` should keep saying `directory.ts` owns durable bindings and add that Chat Runtime may read the binding to attach run rows but must not write it.

Second, remove binding writes from `projector.ts`. Delete the `backendSessionBindings` import and the `projectBinding` function. Replace the projected binding id with a read-only lookup of an existing durable binding id by `chatSessionId`, probably using `tx.select({ id: backendSessionBindings.id })` if keeping the import only for read is acceptable, or using a Provider Runtime helper if one exists and can operate in the transaction. The important rule is that projection must not insert, update, or delete `backend_session_bindings`. If no binding exists, projected `backend_runs.bindingId` should be `null`.

Third, update projector tests. The existing test named "rebuilds runs, messages, queue, and binding rows from events idempotently" should become a test that pre-inserts a provider runtime binding row, replays events with an older `run.provider_context_recorded` snapshot, and proves the binding row is unchanged after projection. It should still assert that messages, runs, and queue rows are projected. Add or keep a test proving no binding row is created when only events exist.

Fourth, change run creation gating. Introduce a small helper in `service.ts`, for example `assertSessionCanStartRun(sessionId: string)`, that calls `interruptOrphanedEventRunIfIdle(sessionId)` and then reads `readEventDerivedRuntimeState(sessionId)`. If the event-derived state has events and an active run id, throw `chat_run_in_progress`. If the event state has no active run, clear or release stale memory handles with `releaseTerminalActiveHandleForSession(sessionId)` and allow the run to start. For legacy sessions with no events, keep the existing memory/pending guard as fallback. `pendingRunSessions` should still prevent two simultaneous create requests in the same process while the new run is being prepared.

Fifth, add event payload validation. In `events.ts`, define a Zod schema map or discriminated union that validates the fields needed by each event type. Keep it lightweight: `run.started` and `run.provider_context_recorded` must have `runId`; assistant message events must have `messageId` when their semantics require one; queue item events must have `queueItemId`; run provider context events may allow nullable backend session id but must keep known field names and object payload shape. Call this validator from `appendChatRuntimeEvents()` before rows are built. Tests in `event-store.test.ts` should prove a valid event appends and a malformed canonical event throws an `AppError` or Zod-derived error consistently.

Sixth, fix the message fallback. In `projector.ts`, `readMessageSnapshot()` currently uses `readReplayTextMessages(events).filter(candidate => candidate.role === role).at(-1)` as a fallback. Change it so fallback text is taken only from the current payload or from replay text events tied to the same `messageId`. This prevents one assistant message from inheriting text emitted for another assistant message during re-projection.

Seventh, reconcile provider replay files. If the replay projector files are kept, update README language so they are described as unconnected diagnostic/future helpers. If they are deleted, delete corresponding tests and README bullets. This plan prefers keeping code only if the documentation is honest that live provider input is still transcript/UIMessage based.

Eighth, restore frontend slot filtering in `apps/web/src/features/chat/composer/composer-slot-states.tsx` so `userInputState` requires `composerSlotIds.has(state.slotId)`, just like goal and plan states. This ensures a provider state meant for another surface does not render beside the composer.

## Concrete Steps

Work from the repository root:

    cd /Users/wibus/dev/Cradle

Before editing, inspect the relevant files:

    rg -n "backend_session_bindings|backendSessionBindings|run.provider_context_recorded|activeRunIdsBySession|pendingRunSessions|readReplayTextMessages|userInputState" apps/server/src/modules/chat-runtime apps/server/src/modules/provider-runtime apps/web/src/features/chat/composer -S

After each logical edit, run the narrowest relevant tests. For projector and event validation changes:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/projector.test.ts src/modules/chat-runtime/event-store.test.ts src/modules/chat-runtime/event-fold.test.ts src/modules/chat-runtime/runtime-state.test.ts

For service busy-gate changes, add a focused test if a suitable existing test file exists. If adding a direct `createRun()` test is too expensive because it requires provider setup, extract a pure or dependency-light helper and test that helper. Run:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/runtime-state.test.ts src/modules/chat-runtime/projector.test.ts

For the frontend slot filter, do not add a new frontend component test unless the user asks for frontend tests. Run TypeScript or lint only if needed to catch type errors:

    pnpm --filter @cradle/web typecheck

At the end, run the broader server verification if the worktree allows it:

    pnpm typecheck:server
    pnpm test:server

If the broader commands fail because of unrelated dirty work, record the exact unrelated files and the narrower passing commands in `Outcomes & Retrospective`.

Actual final verification run for this implementation:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/projector.test.ts src/modules/chat-runtime/event-store.test.ts src/modules/chat-runtime/event-fold.test.ts src/modules/chat-runtime/runtime-state.test.ts
    pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts -t "uses terminal event state instead of stale memory handles when creating a run"
    pnpm typecheck:server
    pnpm typecheck:apps-web

These commands all passed.

## Validation and Acceptance

The implementation is accepted when these behaviors are true:

First, projecting Chat Runtime events cannot create or overwrite `backend_session_bindings`. A test should set up an existing binding row owned by Provider Runtime, run `projectChatRuntimeReadModels()` with run provider context events, and show the row remains unchanged. This proves replay cannot roll a binding back to an old run-start snapshot.

Second, projected backend run rows can still point at an existing binding id when one exists, and use `null` when no durable provider binding exists. This preserves existing run queries without making Chat Runtime own binding mutation.

Third, a session is rejected as busy only when event-derived state says a run is active, or when a legacy no-event session still has a local pending/live handle. If events show terminal state, stale memory handles should not produce `chat_run_in_progress`.

Fourth, malformed lifecycle events are rejected before they enter `chat_runtime_events`. For example, a `run.started` append without a `runId` should fail; a valid `run.started` with `runId` and optional message id should still append and read back in sequence.

Fifth, message projection fallback cannot copy text from another message. A test should include two assistant messages and prove a missing snapshot for one does not inherit the other assistant message's text.

Sixth, a pending `userInput` UI slot appears in the composer only when the runtime declared that slot for the `composerState` surface.

## Idempotence and Recovery

The projector changes must be idempotent: running `projectChatRuntimeReadModels()` multiple times with the same events should leave the same `backend_runs`, `messages`, and `chat_session_queue_items` rows and should not touch `backend_session_bindings`.

Event validation changes are safe to retry because failed appends should happen before any rows are inserted. The event store appends inside a transaction; if validation throws before row construction, no partial event sequence is written.

The busy-gate change must be safe when called repeatedly. Releasing a stale terminal handle should be a no-op after the first call. Interrupting an orphaned event run should continue to use command idempotency or event-state checks so repeated status/start calls do not append duplicate terminal events.

Do not run destructive git commands. The worktree is already dirty with related PR files. If a file contains unrelated user changes, read it and edit only the necessary local region.

## Artifacts and Notes

Relevant current evidence from Cradle:

    apps/server/src/modules/chat-runtime/README.md currently says:
    chat_runtime_events is canonical and backend_session_bindings is projected from that stream.

    apps/server/src/modules/provider-runtime/README.md currently says:
    directory.ts owns durable provider runtime bindings.

    apps/server/src/modules/chat-runtime/projector.ts currently:
    imports backendSessionBindings, has projectBinding(), and writes the table with insert/onConflictDoUpdate.

    apps/server/src/modules/chat-runtime/service.ts currently:
    createRun() calls interruptOrphanedEventRunIfIdle(), then immediately checks activeRunIdsBySession and pendingRunSessions for 409.

Relevant evidence from lobehub comparison:

    /Users/wibus/dev/lobehub/src/server/modules/AgentRuntime/StreamEventManager.ts:
    stream events are delivery/history; messages are canonical in DB and heavy finalState.messages are stripped.

    /Users/wibus/dev/lobehub/src/server/modules/AgentRuntime/AgentRuntimeCoordinator.ts:
    runtime state is saved before terminal stream events are published.

This comparison supports the direction of using events where they are actually the owner of lifecycle, not expanding them into every durable table.

Final verification transcript:

    Test Files  4 passed (4)
         Tests  14 passed (14)

    Test Files  1 passed (1)
         Tests  1 passed | 48 skipped (49)

    pnpm typecheck:server
    $ pnpm --filter @cradle/server exec tsc --noEmit

    pnpm typecheck:apps-web
    $ pnpm --filter @cradle/web exec tsc --noEmit

## Interfaces and Dependencies

Use existing dependencies only. Zod is already available in `apps/server/src/modules/chat-runtime/events.ts`, so event payload validation should use `z` from `zod`.

At the end of this plan, `apps/server/src/modules/chat-runtime/projector.ts` should expose the same public function:

    projectChatRuntimeReadModels(input: {
      streamId: string
      events: ChatRuntimeEventRecord[]
    }): ProjectChatRuntimeReadModelsResult

The result type may keep a `counts.bindings` field only if changing it would cause unnecessary API churn, but that count should always be `0` or be renamed if all callers are updated. Prefer removing or de-emphasizing binding projection in tests and docs rather than preserving misleading semantics.

At the end of this plan, `apps/server/src/modules/chat-runtime/events.ts` should provide a validation function used by `event-store.ts`, for example:

    export function validateNewChatRuntimeEvent(event: NewChatRuntimeEvent): NewChatRuntimeEvent

or:

    export function parseNewChatRuntimeEvent(event: NewChatRuntimeEvent): NewChatRuntimeEvent

The exact name can follow local style, but validation must run before append and must be covered by tests.

At the end of this plan, `apps/server/src/modules/chat-runtime/service.ts` should have one clear gate helper for run startup, so future changes do not reintroduce direct stale-memory 409 checks.

Revision note, 2026-06-09 09:41Z: Initial ExecPlan created to guide implementation of Chat Runtime ownership cleanup after review findings and lobehub comparison.

Revision note, 2026-06-09 10:13Z: Updated the living plan after implementation and verification. Progress, discoveries, decisions, outcomes, and final validation commands now reflect the completed ownership cleanup.
