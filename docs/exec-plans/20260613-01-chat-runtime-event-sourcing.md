# 20260613-01 — Chat Runtime Event Sourcing (Breaking Refactor)

Source draft: `docs/draft-solutions/2026-06-13-chat-runtime-server.md`

## Decisions (locked with owner)

1. **Pragmatic ES + synchronous projections.** An append-only `session_events` table is the
   source of truth for chat-runtime-owned lifecycle facts. Projectors run in the
   **same DB transaction** as the event append, so
   read models are never behind the event log (kills the draft's "projection latency" pit
   and the `SQLITE_BUSY` pit in one move — single writer, single transaction).
2. **Deterministic finalize, never resume.** On startup/read, an interrupted aggregate is
   replayed; if it stops mid-run we append the single missing terminal fact
   (`RunFailed`/`response.interrupted`). We never re-drive a dead ACP/Codex subprocess.
3. **One breaking sweep.** No compatibility shims in the end state. The schema baseline is
   regenerated (pre-release, per `packages/db/drizzle/README.md`).

## Progress

- [x] (2026-06-13 15:02 CST) Added `session_events` to the DB schema and regenerated the pre-release baseline files.
- [x] (2026-06-13 15:02 CST) Added `apps/server/src/modules/chat-runtime/es/` with event contracts, append/read helpers, aggregate replay, same-transaction projectors, per-session actor serialization, and command helpers.
- [x] (2026-06-13 15:02 CST) Routed chat-runtime writes for draft user messages, run start, assistant terminal snapshots, terminal run facts, queue enqueue/cancel/reorder/claim/release/fail, live steer, title changes, and bang-command transcript persistence through session events.
- [x] (2026-06-13 15:02 CST) Replaced startup/read recovery with deterministic interrupted-run finalization from event replay plus terminal fact projection for legacy read-model-only test fixtures.
- [x] (2026-06-13 15:02 CST) Removed the old direct-write `run/recovery.ts` and `run/lifecycle.ts` helpers, and moved orphaned queue claim recovery plus pending position normalization behind event commands.
- [x] (2026-06-13 15:02 CST) Updated the chat-runtime README to describe `session_events` as the canonical fact log and list the new `es/` ownership boundary.
- [x] (2026-06-13 15:02 CST) Verified `pnpm --filter @cradle/server typecheck` and focused Vitest coverage for `src/modules/chat-runtime/es/aggregate.test.ts`, `tests/chat-runtime.test.ts`, and `tests/session.test.ts`.
- [x] (2026-06-13 15:20 CST) Removed the unused `SessionStarted` event from v1 and narrowed the documentation to chat-runtime lifecycle facts so session module metadata is not misrepresented as an event projection.
- [x] (2026-06-13 15:55 CST) Review cleanup: terminal/interrupted/abort fact backfills now re-enter the per-session actor, read-before-repair APIs await self-healing writes, provider title projection no longer hides fire-and-forget persistence inside the core service helper, and oversized snapshot hydration compacts DTOs without mutating `messages` on read.

## Surprises & Discoveries

- Observation: queue drain can claim a queue item before `RunStarted` is appended. If cancellation arrives in that gap, the internal cancellation command must accept `running` rows with `startedRunId IS NULL`.
  Evidence: `cancelQueuedSessionItem()` now treats that state as cancellable, `projectQueueItemCancelled()` projects it, and `tests/chat-runtime.test.ts` covers the event stream `QueueItemDrained -> QueueItemCancelled`.
- Observation: `backend_runs.binding_id` was the last run read-model field updated outside the projector.
  Evidence: terminal run event payloads now optionally carry `bindingId`, and `projectRunTerminal()` updates the projection when that field is present.
- Observation: `SessionStarted` had no writer because session metadata creation is owned by `apps/server/src/modules/session`.
  Evidence: code search found only the event type and projector branch, not a command or route path that emitted it.

## Decision Log

- Decision: keep streaming message snapshot updates as direct read-model updates during active streaming.
  Rationale: high-frequency text/reasoning/tool deltas are explicitly not domain events in this plan. The event log records the final assistant snapshot and terminal run fact.
  Date/Author: 2026-06-13 / Codex.
- Decision: model queue claim release, failure, cancellation, and position normalization with existing queue event shapes instead of adding a new reorder event type.
  Rationale: the v1 event vocabulary already uses queue projection payloads, and adding a new semantic event would expand the type surface without changing external behavior.
  Date/Author: 2026-06-13 / Codex.
- Decision: carry terminal `bindingId` on `RunCompleted` / `RunFailed` / `RunAborted` rather than adding a separate binding-linked event.
  Rationale: the binding id is a terminal projection detail for `backend_runs`; provider-runtime still owns binding lifecycle, while chat-runtime owns the run read model.
  Date/Author: 2026-06-13 / Codex.
- Decision: remove `SessionStarted` from v1 instead of importing chat-runtime event commands into the session module.
  Rationale: session metadata creation, archive, read/unread, and deletion are owned by `apps/server/src/modules/session`; partially eventizing only creation would create a misleading source-of-truth boundary and a dependency in the wrong direction.
  Date/Author: 2026-06-13 / Codex.

## Outcomes & Retrospective

As of 2026-06-13 15:55 CST, the chat-runtime write path is event-sourced for the runtime lifecycle targeted by this plan. The HTTP route shapes remain unchanged, read models are projected synchronously in the append transaction, old multi-table recovery helpers are gone, the unused `SessionStarted` event has been removed, recovery/backfill writes are serialized through the per-session actor, and focused server verification passes. The remaining direct writes in `service.ts` are outside the event-sourced domain boundary: active streaming snapshot compaction, runtime settings stored in `sessions.config_json`, usage accounting, and provider-runtime binding persistence in the provider-runtime namespace.

## Guiding constraints (from AGENTS.md + findings)

- **Reuse existing shapes, do not invent a parallel type universe.** Event payloads carry
  `UIMessage` / `UIMessageChunk` / existing snapshot-event phase strings. No new Zod
  projection schema over AI SDK message internals (the module already forbids this).
- **The HTTP contract is the CQRS read boundary.** `apps/web` and `packages/cli` are
  generated from the server OpenAPI. **Keep every route path + response DTO identical** →
  zero frontend/CLI churn. This is the explicit success criterion.
- **Forensic layer stays.** `backend_run_snapshots` + `backend_run_snapshot_events` are
  chunk-granularity diagnostic records consumed by `observability/service.ts`. They are NOT
  the event store (wrong granularity = the draft's "stream data"). They keep working as-is,
  written by the projector.
- Claim Check (draft step 3) and Snapshotting (draft step 5) are **out of scope for v1** —
  message snapshots already bound payload size via `compactStoredMessageSnapshot`. Leave
  TODO seams; do not build speculative blob storage.

## Domain events (the only things that enter `session_events`)

Coarse, semantic, one aggregate = one `chat session`. ~10–20 rows per turn, not per token.

| Event | Payload (reuses existing shapes) |
|---|---|
| `UserMessageAppended` | `UIMessage` (user) |
| `RunStarted` | runId, origin, providerTargetId, modelId, runtimeSettings, queueItemId? |
| `AssistantMessageCompleted` | final `UIMessage` (assistant), status |
| `RunCompleted` / `RunFailed` / `RunAborted` | runId, stopReason, errorText? |
| `QueueItemEnqueued` / `QueueItemDrained` / `QueueItemCancelled` | queue row DTO |
| `SteerApplied` | visible user `UIMessage` (mode=steer) |
| `TitleChanged` | title, source |

Streaming text/reasoning/tool **deltas never become events** — they stay in the live SSE
buffer + forensic `backend_run_snapshot_events`, exactly as today.

## Schema (`packages/db/src/schema/chat.ts`)

```ts
export const sessionEvents = sqliteTable('session_events', {
  sequenceId: integer('sequence_id').primaryKey({ autoIncrement: true }), // global order
  aggregateId: text('aggregate_id').notNull(),       // = sessions.id
  aggregateType: text('aggregate_type').notNull().default('ChatSession'),
  version: integer('version').notNull(),             // per-aggregate optimistic lock
  eventType: text('event_type').notNull(),
  payload: text('payload').notNull(),                // JSON, bounded
  occurredAt: integer('occurred_at').notNull(),
}, table => ({
  byAggregateVersion: uniqueIndex('session_events_aggregate_version_unique')
    .on(table.aggregateId, table.version),
}))
```

`messages`, `backend_runs`, and `chat_session_queue_items` are read models for
chat-runtime lifecycle facts. Runtime-owned `sessions` fields such as provider-projected title
and `updated_at` are projected from the same events, while session metadata creation, archive,
read/unread, and deletion remain owned by `apps/server/src/modules/session`. Their columns are
unchanged so the HTTP DTOs and `observability` joins keep working.

## Architecture: the new write path

```
command (createRun/steer/enqueue/cancel/finalize)
   │
   ▼
per-session in-memory Actor queue  ──serializes──▶  db.transaction(tx => {
   │                                                  appendEvent(tx, evt)        // SSOT
   │                                                  project(tx, evt)            // read models, same tx
   │                                                })
   ▼
live SSE buffer (unchanged)  ──▶ broadcast UIMessageChunk (unchanged)
forensic snapshot events     ──▶ backend_run_snapshot_events (unchanged)
```

New files under `apps/server/src/modules/chat-runtime/es/`:
- `event-store.ts` — `appendEvent(tx, {aggregateId, version, type, payload})`,
  `readEvents(aggregateId)`, `nextVersion(tx, aggregateId)`. Append-only.
- `aggregate.ts` — `reduce(events) -> ChatSessionState` (in-memory replay). Pure.
- `projectors.ts` — `project(tx, event)`: writes `sessions`/`messages`/`backend_runs`/
  `queue_items` rows. One function per event type. Same-tx with append.
- `session-actor.ts` — per-`aggregateId` serial promise chain (Actor model from draft pit 1).
  All commands `enqueue()` onto it. Guarantees monotonic `version`, no `SQLITE_BUSY`.
- `commands.ts` — command handlers: load events → `reduce` → validate invariant → emit event(s).

## Staged implementation (one branch, sequential commits)

**Stage 0 — Schema baseline**
- Add `sessionEvents` to `chat.ts`. Regenerate drizzle baseline (`0000_*`, `meta/`) per
  README (pre-release path). Export types.

**Stage 1 — Event store + aggregate + projectors (no behavior change yet)**
- Build `es/event-store.ts`, `aggregate.ts`, `projectors.ts`, `session-actor.ts`.
- Unit-test `reduce` and each projector against hand-written event sequences (logic only —
  no UI/component tests per AGENTS.md).

**Stage 2 — Route write paths through the actor + event log**
- `createDraftTurn*`, `startRun`, `insertCompletedUserMessage`, `startAssistantContinuation`,
  queue enqueue/cancel/reorder/drain, steer, title writes: each becomes
  `command → append event → project(tx)`. Direct `db.insert/update` of read-model tables
  moves *into* `projectors.ts`. The `executeRun` streaming loop is unchanged except its
  terminal `finalizeActiveRun` now emits `RunCompleted/Failed/Aborted` + `AssistantMessageCompleted`.
- `service.ts` shrinks: persistence helpers relocate to `es/`. Public exported fn signatures
  (consumed by `index.ts` routes) stay identical.

**Stage 3 — Replace recovery with deterministic finalize**
- `recoverPersistedRunProjections()` → replay each aggregate with a non-terminal trailing
  run; append `RunFailed{response.interrupted}` + project. Delete the multi-table repair in
  `run/recovery.ts` (`repairTerminalRunProjection*`) — superseded by replay+project.
- `getMessageGroups`/`getRuntimeSessionStatus` self-heal becomes "replay if needed", same DTO out.

**Stage 4 — Cutover + cleanup**
- Remove now-dead direct-write paths and the orphan-repair scaffolding. `backend_runs` is
  still written (by projector) so `observability` + session-await + completed-runs polling
  are untouched.
- Verify: `pnpm --filter @cradle/server build`, server unit tests, `pnpm generate` produces
  an **unchanged** OpenAPI/SDK diff (proves read boundary preserved).

## Explicit non-goals (v1)
- Claim Check blob store, snapshot/cold-archive, time-travel UI. Leave seams + TODOs.
- No frontend changes. No CLI changes. No new HTTP routes or DTO fields.

## Risk register
- **Codex active-goal continuation** + **side-chat** are live-only/in-memory — they emit
  `RunStarted/Completed` like any run but their transcript stays out of the log where it
  already does (side-chat persists nothing). Keep that boundary.
- **Optimistic version conflicts** can't occur with the per-session actor (single writer),
  but the unique index is the backstop if a command ever bypasses the actor — fail loud.
- Largest mechanical risk is relocating ~30 inline `db.insert/update` calls from `service.ts`
  into `projectors.ts` without changing emitted rows. Mitigation: stage 1 projector unit
  tests assert row-equality against the current write shapes before stage 2 flips the caller.

Revision note, 2026-06-13 15:02 CST: recorded implementation progress, cleanup decisions, queue cancellation discovery, and focused validation evidence after the event-sourcing cutover.

Revision note, 2026-06-13 15:20 CST: removed the dead `SessionStarted` event and clarified that v1 owns chat-runtime lifecycle facts, not the session module metadata lifecycle.

Revision note, 2026-06-13 15:55 CST: review cleanup moved recovery/backfill writes behind the per-session actor, made read-before-repair paths await those writes before returning DTOs, and removed the last read-time `messages` mutation from oversized snapshot hydration.
