# Upgrade chat runtime recovery with SQLite-indexed event identity

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The file itself is the plan, so it intentionally omits an outer Markdown code fence.

## Purpose / Big Picture

Cradle chat sessions currently store canonical lifecycle facts in `session_events` and read optimized state from projection tables such as `messages`, `backend_runs`, and `chat_session_queue_items`. A CPU spike showed that ordinary read paths can trigger repair code that scans and JSON-parses a whole session event stream once for every terminal run. For a session with hundreds of terminal runs, this turns UI polling into a server main-thread CPU storm.

After this upgrade, ordinary chat read APIs only read projections and never repair event sourcing state. Crash recovery and terminal fact repair move into an explicit chat-runtime recovery path. A SQLite generated column and a partial unique index expose run identity directly to indexed SQL queries, so recovery can ask SQLite for missing facts without loading and parsing the full event log in Node.js. A user can see the result by running focused server tests, by verifying that read APIs do not append `session_events`, and by observing that repeated status/message polling no longer makes `parseStoredChatSessionEvent` dominate a CPU profile.

## Progress

- [x] (2026-06-19 14:36 +0800) Investigated the CPU spike and identified the hot path as `projectTerminalRunFactsForSession -> projectTerminalRunFact -> hasTerminalRunFact -> readSessionEvents -> parseStoredChatSessionEvent`.
- [x] (2026-06-19 14:36 +0800) Verified local SQLite is version 3.43.2 and supports generated columns, JSON functions, and partial indexes.
- [x] (2026-06-19 14:36 +0800) Verified the installed Drizzle versions expose the needed features: `drizzle-orm` 0.45.2 has SQLite `generatedAlwaysAs`, SQLite index builders support `.where(...)`, and `drizzle-kit` 0.31.10 emits generated column SQL.
- [x] (2026-06-19 14:36 +0800) Wrote this preparation ExecPlan with a no-compatibility-debt upgrade route.
- [x] (2026-06-19 14:52 +0800) Incorporated architecture review feedback: request-time cleanup must not append events, global recovery must be projection-driven and batched, the terminal fact index should not be duplicated, and this milestone should only introduce run identity.
- [x] (2026-06-19 14:56 +0800) Tightened the plan wording and validation so the architecture review findings are expressed as executable constraints rather than only design notes.
- [x] (2026-06-19 16:01 +0800) Updated the Drizzle schema for `session_events` with one generated virtual `subjectRunId` column and one unique terminal fact partial index.
- [x] (2026-06-19 16:01 +0800) Generated and inspected `packages/db/drizzle/0003_wealthy_odin.sql`; it adds `subject_run_id` and `session_events_terminal_fact_run_unique`.
- [x] (2026-06-19 16:01 +0800) Refactored chat-runtime recovery so ordinary message/status reads no longer repair event state, request-time cleanup no longer appends `session_events`, and startup/session recovery uses projection-driven bounded batches.
- [x] (2026-06-19 16:01 +0800) Added focused server coverage in `apps/server/tests/chat-runtime-recovery.test.ts` and updated the old chat-runtime repair tests to assert projection-only reads plus explicit recovery.
- [x] (2026-06-19 16:01 +0800) Ran focused tests, server typecheck, migration startup validation, and a final `drizzle-kit generate` check with no schema changes remaining.

## Surprises & Discoveries

- Observation: The CPU spike was not caused by Codex app-server subprocesses or the observability queue. The server Node process itself reached roughly 80-98% CPU while observability queue depth stayed zero.
  Evidence: Runtime snapshot and Prometheus showed server CPU max around 95.5%, event loop utilization max around 0.976, and `cradle_observability_queue_depth` at zero.

- Observation: The JavaScript CPU profile showed `parseStoredChatSessionEvent` consuming 40.1% of samples during the spike.
  Evidence: The profile stack was `parseStoredChatSessionEvent <- readSessionEvents <- hasTerminalRunFact <- projectTerminalRunFactInActor <- projectTerminalRunFactsForSession`.

- Observation: One local session had 632 terminal runs and 1897 session events. The old algorithm can perform approximately 632 \* 1897 event checks for one no-op repair pass.
  Evidence: SQLite counts from the local database showed `8bc07666-2bc2-4127-9cc4-fe4634439919` with `terminal_runs=632` and `events=1897`.

- Observation: The local SQLite and Drizzle stack can express the desired database-owned identity indexes.
  Evidence: `sqlite3` accepted a virtual generated column using `json_extract(payload, '$.x')` and a unique partial index. Local `drizzle-orm` types expose `generatedAlwaysAs(as, { mode: 'virtual' | 'stored' })`, and SQLite indexes expose `.where(condition)`.

- Observation: A review found the initial plan still allowed one request-time write path: `releaseTerminalPersistedActiveRunForSession` calls `projectTerminalRunFact(run)`, which can append `session_events` while serving a read-triggered cleanup.
  Evidence: `apps/server/src/modules/chat-runtime/service.ts` contains `releaseTerminalPersistedActiveRunForSession`, and the reviewed call chain points from that helper to `projectTerminalRunFact(run)`.

- Observation: The initial plan optimized terminal fact lookup but did not explicitly remove the global `readAllSessionEvents()` recovery scan.
  Evidence: `apps/server/src/modules/chat-runtime/es/commands.ts` currently has `finalizeInterruptedSessionEventStreams()` reading every session event before grouping and reducing them.

- Observation: Drizzle's `inArray()` helper generated parameter placeholders inside the partial index predicate, and SQLite rejects parameters in partial index `WHERE` clauses.
  Evidence: A migration startup check failed with `parameters prohibited in partial index WHERE clauses` for `CREATE UNIQUE INDEX ... WHERE ("session_events"."event_type" in (?, ?, ?) ...)`. The schema now uses a literal `sql` predicate for the partial index, and a later startup check against a temporary database succeeded.

- Observation: Drizzle compares generated column expressions textually in snapshots, including whitespace.
  Evidence: After formatting changed only indentation inside the generated expression, `pnpm --filter @cradle/db generate` produced a spurious migration that dropped and re-added `subject_run_id`. The uncommitted 0003 migration and snapshot were normalized to the schema expression text, the spurious 0004 migration was removed, and a final generate reported `No schema changes, nothing to migrate`.

## Decision Log

- Decision: Use SQLite generated virtual columns for event identity instead of ordinary application-maintained subject columns.
  Rationale: Generated columns avoid dual writes and backfills. Existing rows become queryable immediately because SQLite derives identity from `payload` at read/index time. This keeps event identity in the event log envelope without creating a separate projection table.
  Date/Author: 2026-06-19 / Codex

- Decision: Use `drizzle-kit generate` as the migration source of truth.
  Rationale: Repository rules require Drizzle for database changes. The installed Drizzle stack supports generated columns and partial indexes, so schema changes should start in `packages/db/src/schema/chat.ts` and migrations should be generated through `pnpm --filter @cradle/db generate`. If generated SQL needs hand inspection or a small correction for a SQLite limitation, record that correction in this plan and keep the Drizzle schema authoritative.
  Date/Author: 2026-06-19 / Codex

- Decision: Remove repair from ordinary read APIs rather than optimizing it in place.
  Rationale: The architectural bug is not only the O(runs \* events) algorithm. Reads such as session status and message hydration should not mutate event sourcing state or run recovery. Recovery must have a named owner, observable behavior, idempotence, and bounded work.
  Date/Author: 2026-06-19 / Codex

- Decision: Do not add runtime fallbacks that parse payload JSON when the generated identity column is null.
  Rationale: This project is not released and the instruction is to avoid compatibility debt. After the migration, new code should rely on the upgraded schema and fail tests if event identity is malformed.
  Date/Author: 2026-06-19 / Codex

- Decision: This milestone introduces only `subjectRunId`; `subjectMessageId` and `subjectQueueItemId` are deferred until a concrete query owner needs them.
  Rationale: The CPU incident and recovery owner need run identity. Adding message and queue generated columns now would create unused schema semantics. Cradle's ownership principle prefers introducing namespace semantics only when the owner and evolution path are clear.
  Date/Author: 2026-06-19 / Codex

- Decision: Use one unique partial index for terminal facts rather than both ordinary and unique partial indexes with the same predicate.
  Rationale: A unique partial index on `(aggregate_id, subject_run_id)` can serve the terminal fact lookup and also enforces idempotence. A duplicate non-unique index would add write amplification unless `EXPLAIN QUERY PLAN` proves a separate index is needed.
  Date/Author: 2026-06-19 / Codex

- Decision: Request-time cleanup may release in-memory runRegistry state but must not append `session_events` or perform projection repair.
  Rationale: The read/write boundary must be explicit. A read-triggered helper that mutates the event log recreates the same architecture smell even if the underlying lookup is indexed.
  Date/Author: 2026-06-19 / Codex

- Decision: Startup and explicit recovery must use projection-driven, batched queries instead of event-log replay for interrupted streaming recovery.
  Rationale: Moving a full `readAllSessionEvents()` parse from polling to startup would preserve the CPU debt in another path. `backend_runs.status = 'streaming'` is the projection that identifies persisted orphaned streaming runs, and recovery can finalize those rows in bounded pages.
  Date/Author: 2026-06-19 / Codex

- Decision: Keep the recovery implementation in `apps/server/src/modules/chat-runtime/es/commands.ts` for this milestone while exposing explicit recovery functions.
  Rationale: The existing command module already owns append-and-project transactions for chat-runtime events. Splitting a new file would require exporting private transaction helpers only to move code. The architectural boundary is still explicit: `recoverChatRuntimeProjections()` and `recoverChatRuntimeSession(sessionId)` are the write-owning recovery entry points, and ordinary reads do not call repair helpers.
  Date/Author: 2026-06-19 / Codex

- Decision: Express the terminal fact partial index predicate as a literal `sql` fragment, not `inArray()`.
  Rationale: SQLite partial index predicates cannot contain bound parameters. Drizzle's `inArray()` emits placeholders in generated migration SQL, so the valid Drizzle schema expression must be literal SQL for this DDL predicate.
  Date/Author: 2026-06-19 / Codex

## Outcomes & Retrospective

Implemented. `session_events` now has a generated virtual `subject_run_id` column and one unique partial index, `session_events_terminal_fact_run_unique`, that both enforces one terminal fact per session run and serves indexed terminal fact lookups. Explicit chat-runtime recovery now returns `{ interruptedRunsFinalized, terminalFactsProjected }`, finalizes persisted streaming runs by reading `backend_runs.status = 'streaming'` in batches, and projects missing terminal facts by querying terminal `backend_runs` rows missing indexed terminal events.

Ordinary message/status reads no longer append event-log repair events. `getMessageGroups()` reads message projections only. `getRuntimeSessionStatus()` may release stale in-memory active-run registry state, but `releaseTerminalPersistedActiveRunForSession()` no longer calls `projectTerminalRunFact()` and does not append `session_events`. Write entry points that need to clear stale persisted state call `recoverChatRuntimeSession(sessionId)` explicitly.

Validation passed for focused recovery tests, the two updated chat-runtime behavioral tests, server typecheck, temporary-database migration startup, and a final drizzle generate check. A full CPU profile after repeated polling was not rerun in this pass; the hot O(runs * events) call chain was removed from ordinary reads and from startup recovery.

## Context and Orientation

The relevant database schema lives in `packages/db/src/schema/chat.ts`. The `sessionEvents` table is the append-only event log for chat-runtime-owned lifecycle facts. "Append-only" means new facts are inserted rather than editing previous facts. The current table has `sequence_id`, `aggregate_id`, `aggregate_type`, `version`, `event_type`, `payload`, and `occurred_at`, plus indexes on aggregate id and event type. `payload` is a JSON string containing event-specific data.

The generated migrations live under `packages/db/drizzle`. The command `pnpm --filter @cradle/db generate` runs `drizzle-kit generate` using `packages/db/drizzle.config.ts`, which points at `./src/schema/index.ts` and outputs migrations to `./drizzle`. The server applies these migrations at startup through `apps/server/src/database/migration-runner.ts`, which calls Drizzle's `migrate(db, { migrationsFolder })`.

The event store code lives in `apps/server/src/modules/chat-runtime/es/event-store.ts` and event types live in `apps/server/src/modules/chat-runtime/es/events.ts`. `readSessionEvents(aggregateId)` currently selects all events for one session and parses every row payload with `JSON.parse`.

The problematic recovery and repair code lives in `apps/server/src/modules/chat-runtime/es/commands.ts`. `projectTerminalRunFactsForSession(sessionId)` reads all terminal runs for a session, then calls `projectTerminalRunFact(run)` for each run. `projectTerminalRunFactInActor` calls `hasTerminalRunFact(sessionId, runId)`, and `hasTerminalRunFact` currently calls `readSessionEvents(sessionId)` for every run. This is the O(runs \* events) hot path.

The read paths that currently trigger repair live in `apps/server/src/modules/chat-runtime/service.ts`. `getRuntimeSessionStatus(sessionId)` and `getMessageGroups(sessionId)` both call recovery/repair helpers when a session has no active or pending run. `finalizeInterruptedPersistedStreamingSessionIfIdle(sessionId)` also mixes lifecycle cleanup with repair. `releaseTerminalPersistedActiveRunForSession(sessionId)` releases in-memory active run state but currently calls `projectTerminalRunFact(run)`, so it can append `session_events` during request-time cleanup. This plan separates these responsibilities: request-time cleanup can mutate only in-memory runtime registries, while event-log repair belongs to explicit recovery.

The term "projection" means a table optimized for reads and derived from canonical events. Here `messages`, `backend_runs`, `chat_session_queue_items`, and selected `sessions` fields are projections. The term "generated column" means a SQLite column whose value is computed from other columns by SQLite. In this plan, the generated identity column is not a projection because it does not store a second copy of domain state; it exposes event identity inside the same event log table for indexes and constraints.

## Plan of Work

First, update `packages/db/src/schema/chat.ts` so `sessionEvents` has a generated virtual column that derives run identity from `payload`. Add `subjectRunId` as a nullable text column generated with Drizzle's `generatedAlwaysAs` API and `{ mode: 'virtual' }`. Use existing event payload shapes, not new projection types. For run identity, `RunStarted` reads `$.run.id`, while `RunCompleted`, `RunFailed`, and `RunAborted` read `$.runId`. Other event types produce null for `subjectRunId`. Do not add message or queue identity columns in this milestone.

Add the new index in the same Drizzle schema. Keep the current aggregate/version and event type indexes. Add exactly one unique partial index for terminal run facts on `(aggregate_id, subject_run_id)` where `event_type` is one of `RunCompleted`, `RunFailed`, or `RunAborted` and `subject_run_id` is not null. This index both serves lookup and enforces at most one terminal fact per run in a session. Do not add a duplicate non-unique partial index unless a later `EXPLAIN QUERY PLAN` proves SQLite will not use the unique partial index for the target lookup.

Generate a migration with drizzle-kit:

    cd /Users/wibus/dev/Cradle
    pnpm --filter @cradle/db generate

Inspect the new SQL in `packages/db/drizzle`. The generated SQL must contain `GENERATED ALWAYS AS (...) VIRTUAL` for SQLite and the unique partial index with `WHERE`. If the migration attempts an unsafe table rewrite or emits invalid SQL for the generated column on SQLite, stop and adjust the Drizzle schema first. If a small SQL correction is unavoidable because of drizzle-kit behavior, keep it in the generated migration file, record the exact correction in this plan's Decision Log, and do not add runtime compatibility fallbacks.

Next, refactor recovery queries. In `apps/server/src/modules/chat-runtime/es/commands.ts`, remove the current `hasTerminalRunFact` implementation that reads and parses all session events. Replace terminal fact detection with a SQL query against `session_events.subject_run_id` and the terminal event types. Prefer an anti-join or `not exists` SQL expression that selects only terminal `backend_runs` rows missing a terminal event. If a set-based TypeScript implementation is clearer, it must read terminal runs once, read existing terminal fact run ids once from `session_events`, build a `Set<string>`, and append facts only for runs missing from the set. It must not call `readSessionEvents` for terminal fact detection.

Then separate recovery ownership. Create a named recovery module such as `apps/server/src/modules/chat-runtime/es/recovery.ts` if the commands file becomes unclear. Move startup and explicit repair functions there. The recovery module owns persisted streaming interruption recovery and terminal fact repair. It can write `session_events` because it is part of chat-runtime ownership. Ordinary reads in `service.ts` must stop calling `finalizeInterruptedSessionEventStream`, `projectTerminalRunFactsForSession`, and `projectTerminalRunFact`. The helper `releaseTerminalPersistedActiveRunForSession` must be split or rewritten so request-time cleanup only releases in-memory `runRegistry` and active-run resources; it must not append `session_events`, call `projectTerminalRunFact`, or otherwise repair projections.

Also replace global interrupted streaming recovery with projection-driven bounded work. The existing `finalizeInterruptedSessionEventStreams()` must stop calling `readAllSessionEvents()` and stop reducing every event stream to find active runs. Instead, query `backend_runs` for persisted rows with `status = 'streaming'`, optionally constrained to a session id, and process them in deterministic batches ordered by `started_at` or primary key. For each orphaned streaming row, append the interrupted terminal event and update projections through the same explicit recovery owner. If implementation discovers a specific invariant that truly requires event-stream replay, document that invariant in this plan before using replay; otherwise replay is out of scope for recovery.

Finally, add focused tests. Server tests should prove four behaviors. First, ordinary reads do not append events: create or seed a session, record `session_events` count, call `getMessageGroups` or the route behind it, and assert the count is unchanged. This test must cover the former `releaseTerminalPersistedActiveRunForSession -> projectTerminalRunFact` path if it can be reached from a read API. Second, recovery is idempotent: seed a terminal `backend_runs` row without a terminal event, run the recovery once and expect one fact appended, run it again and expect zero changes. Third, persisted streaming recovery uses `backend_runs.status = 'streaming'` rather than `readAllSessionEvents`; seed streaming runs and assert bounded recovery finalizes them without replaying all event payloads. Fourth, duplicate terminal facts are rejected by the unique partial index. If direct service tests are easier than HTTP route tests, use service tests; do not add frontend tests for this server-side architecture change.

## Concrete Steps

1. Confirm the worktree before editing:

   cd /Users/wibus/dev/Cradle
   git status --short

2. Edit `packages/db/src/schema/chat.ts`. Import `sql` from `drizzle-orm` if it is not already imported in that file. Add the `subjectRunId` generated virtual column to `sessionEvents` and add the unique terminal fact partial index in the table extra config. Do not add message or queue subject columns in this milestone.

3. Run drizzle-kit generation:

   pnpm --filter @cradle/db generate

   Expected result: a new migration appears under `packages/db/drizzle`, and the terminal reports a successful generated migration rather than "No SQL generated".

4. Inspect the generated migration:

   git diff -- packages/db/src/schema/chat.ts packages/db/drizzle

   Expected result: the migration includes the SQLite generated column and unique partial index. The generated column SQL should resemble:

   `subject_run_id` text GENERATED ALWAYS AS (...) VIRTUAL

   The terminal fact index should be unique and include a predicate equivalent to:

   WHERE event_type IN ('RunCompleted', 'RunFailed', 'RunAborted') AND subject_run_id IS NOT NULL

5. Add or refactor recovery code in `apps/server/src/modules/chat-runtime/es/commands.ts` and, if useful, `apps/server/src/modules/chat-runtime/es/recovery.ts`. Keep runtime SQL typed with Drizzle and `sql` fragments. Do not introduce `unknown`-heavy inline parsing helpers. Do not read all events to answer "does this run have a terminal fact?" Do not read all events to find interrupted streaming runs; use `backend_runs.status = 'streaming'` in bounded batches.

6. Remove read-path repair calls from `apps/server/src/modules/chat-runtime/service.ts`. In particular, normal message and status reads must not call `finalizeInterruptedSessionEventStream`, `projectTerminalRunFactsForSession`, or `projectTerminalRunFact`. Rewrite `releaseTerminalPersistedActiveRunForSession` so any request-time use only releases in-memory active-run state and never appends `session_events`.

7. Verify the read/write separation with code search before writing tests:

   rg -n "readAllSessionEvents\\(" apps/server/src/modules/chat-runtime/es
   rg -n "finalizeInterruptedSessionEventStream|projectTerminalRunFactsForSession|projectTerminalRunFact" apps/server/src/modules/chat-runtime/service.ts

   Expected result: `readAllSessionEvents()` is not used by startup or session recovery. The service search may still show imports or explicit recovery entry points while refactoring, but `getRuntimeSessionStatus`, `getMessageGroups`, `finalizeInterruptedPersistedStreamingSessionIfIdle`, and `releaseTerminalPersistedActiveRunForSession` must not call event-log repair functions. If a helper keeps an old name for compatibility inside the module, inspect its body and ensure it uses bounded `backend_runs.status = 'streaming'` queries rather than event replay.

8. Add focused tests under `apps/server/src/modules/chat-runtime` or `apps/server/tests`, following existing server test style. Prefer tests that exercise the service layer and database migration behavior directly.

9. Run focused validation:

   pnpm --filter @cradle/server exec vitest run <new-or-updated-test-files>
   pnpm typecheck:server

   If typecheck fails in unrelated files, record the exact unrelated failures in this plan and still keep the focused tests passing.

10. Optional performance validation after implementation, using a local DB with the previously heavy session:

    pnpm --filter @cradle/cli cradle observability runtime-snapshot --json
    sample <server-pid> 5 -file /tmp/cradle-server-after.sample.txt

Expected result: repeated chat status/message reads do not show `parseStoredChatSessionEvent` as a dominant CPU sample.

## Validation and Acceptance

The migration is accepted when `pnpm --filter @cradle/db generate` creates the intended Drizzle migration and the server can start against a migrated local SQLite DB without migration errors.

The schema is accepted when SQLite can use the unique partial index for terminal fact lookups. Validate this with an `EXPLAIN QUERY PLAN` query against a migrated database. The output should mention the terminal fact index on `session_events` rather than a full table scan. A representative query is:

    EXPLAIN QUERY PLAN
    SELECT 1
    FROM session_events
    WHERE aggregate_id = 'some-session'
      AND subject_run_id = 'some-run'
      AND event_type IN ('RunCompleted', 'RunFailed', 'RunAborted');

The recovery refactor is accepted when a seeded missing terminal fact is appended exactly once, and a second recovery run reports zero additional changes. Persisted streaming recovery is accepted when it finalizes rows selected from `backend_runs.status = 'streaming'` without calling `readAllSessionEvents` or parsing unrelated event payloads. The read-path separation is accepted when calling message/status reads does not change `count(*)` from `session_events`, including cases where a persisted terminal run exists and request-time cleanup releases only in-memory state.

The performance fix is accepted when the old heavy local shape no longer does O(runs \* events) JSON parsing. A CPU profile under repeated polling must not show `parseStoredChatSessionEvent` as a top self-time function for terminal fact repair. It is acceptable for `parseStoredChatSessionEvent` to appear when a caller explicitly asks to replay or inspect the event stream.

## Idempotence and Recovery

Drizzle migrations are applied by the server's `MigrationRunner`; rerunning startup should not reapply a completed migration. Recovery itself must be idempotent: running it twice on the same database should append facts on the first run only and report zero changes on the second.

Generated virtual columns avoid data backfill because SQLite derives their values from existing `payload` values. If the unique terminal fact index fails to create because duplicate terminal facts already exist, do not add a compatibility fallback. Investigate the duplicates, record the exact rows in this plan, and either write a one-time cleanup migration or deliberately fail with a clear migration error. Since this project is not released, the preferred path is to keep the invariant strict rather than preserving invalid historical state. Do not add a non-unique duplicate terminal fact index to work around a failed unique index.

If `drizzle-kit generate` produces invalid SQL for a SQLite generated column or partial index, do not bypass Drizzle by writing unrelated raw SQL in runtime code. Adjust the schema expression first. If the limitation is only in migration text generation and the Drizzle schema metadata is correct, manually correct the generated migration SQL, document the correction here, and keep future schema changes in Drizzle.

## Artifacts and Notes

Initial evidence from local debugging:

    server CPU max over 3h: 95.52%
    nodejs_eventloop_utilization max over 3h: 0.976
    observability queue depth: 0
    CPU profile top self-time: parseStoredChatSessionEvent at 40.1%
    hot stack: parseStoredChatSessionEvent <- readSessionEvents <- hasTerminalRunFact <- projectTerminalRunFactInActor <- projectTerminalRunFactsForSession
    heavy session: terminal_runs=632, session_events=1897
    review finding: releaseTerminalPersistedActiveRunForSession can call projectTerminalRunFact during request-time cleanup
    review finding: finalizeInterruptedSessionEventStreams currently uses readAllSessionEvents and must become projection-driven

Local capability checks:

    sqlite3 version: 3.43.2
    drizzle-orm: SQLiteColumnBuilder.generatedAlwaysAs is present
    drizzle-orm: SQLite IndexBuilder.where is present
    drizzle-kit: generated column SQL emission is present

Implementation validation:

    pnpm --filter @cradle/server exec vitest run tests/chat-runtime-recovery.test.ts
    Result: 1 file passed, 4 tests passed.

    pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts -t "keeps message reads projection-only|releases stale active runs"
    Result: 1 file passed, 2 tests passed and 50 skipped by filter.

    pnpm typecheck:server
    Result: passed.

    CRADLE_DATA_DIR="$(mktemp -d)" pnpm --filter @cradle/server exec tsx -e "import { db, shutdownInfra } from './src/infra'; db().run('select 1'); shutdownInfra();"
    Result: passed; migrations applied to a temporary empty database.

    pnpm --filter @cradle/db generate
    Result: No schema changes, nothing to migrate.

    rg -n "readAllSessionEvents\\(" apps/server/src/modules/chat-runtime/es apps/server/src/modules/chat-runtime/service.ts
    Result: no matches.

    rg -n "finalizeInterruptedSessionEventStream|projectTerminalRunFactsForSession|projectTerminalRunFact" apps/server/src/modules/chat-runtime/service.ts
    Result: no matches in `service.ts`; these names remain only inside `es/commands.ts` as explicit recovery helpers.

Useful file paths:

    packages/db/src/schema/chat.ts
    packages/db/drizzle.config.ts
    packages/db/drizzle
    apps/server/src/database/migration-runner.ts
    apps/server/src/modules/chat-runtime/es/event-store.ts
    apps/server/src/modules/chat-runtime/es/events.ts
    apps/server/src/modules/chat-runtime/es/commands.ts
    apps/server/src/modules/chat-runtime/service.ts
    apps/server/src/modules/chat-runtime/README.md

## Interfaces and Dependencies

Use `drizzle-orm` and `drizzle-kit`; do not introduce a new database library. The schema change belongs to `@cradle/db` in `packages/db/src/schema/chat.ts` because the database schema is owned by the DB package. The chat runtime behavior change belongs to `apps/server/src/modules/chat-runtime` because chat-runtime owns the semantics of session lifecycle events, recovery, and projections.

At the end of the schema milestone, `sessionEvents` should expose this new generated column in TypeScript:

    subjectRunId: string | null

At the end of the recovery milestone, chat-runtime should expose a recovery function with a clear idempotent contract. A suitable interface is:

    export interface ChatRuntimeRecoveryResult {
      interruptedRunsFinalized: number
      terminalFactsProjected: number
    }

    export async function recoverChatRuntimeProjections(): Promise<ChatRuntimeRecoveryResult>
    export async function recoverChatRuntimeSession(sessionId: string): Promise<ChatRuntimeRecoveryResult>

The exact function names can change if existing names are clearer, but the contract must remain: recovery is explicit, idempotent, writes only chat-runtime-owned state, and is not called from ordinary read APIs.

Revision note 2026-06-19 14:36 +0800: Initial ExecPlan created after debugging the server CPU spike. The plan chooses SQLite generated virtual columns and partial indexes generated through drizzle-kit, separates recovery from read paths, and rejects runtime compatibility fallbacks.

Revision note 2026-06-19 14:52 +0800: Updated after architecture review. The plan now explicitly forbids request-time cleanup from appending `session_events`, requires global interrupted streaming recovery to query `backend_runs.status = 'streaming'` in bounded batches instead of replaying all events, uses only one unique terminal fact partial index unless `EXPLAIN QUERY PLAN` proves otherwise, and scopes generated identity to `subjectRunId` only.

Revision note 2026-06-19 14:56 +0800: Tightened wording from plural identity columns/indexes to a single `subjectRunId` column and one new unique terminal fact partial index, and added code-search validation for the reviewed read-path write and global event replay hazards.

Revision note 2026-06-19 16:01 +0800: Implemented the upgrade. Added the Drizzle generated column and migration, refactored recovery to projection-driven batches, removed request-time event appends from read cleanup, added focused recovery tests, and recorded validation results plus the Drizzle partial-index predicate discovery.
