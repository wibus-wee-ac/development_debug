# Server/DB Chronicle ReviewA Handoff

## Scope

Review target: Server/DB Chronicle persistence slice for `yansu-style-chronicle`.

Read inputs:

- `docs/exec-plans/20260521-03-yansu-style-chronicle.md`
- `docs/draft-solutions/yansu-chronicle-spec.md`
- Current `apps/server/src/modules/chronicle/`
- Current `packages/db/src/schema/`
- Current diff for the assigned Server/DB paths

Constraint followed: this review only writes this handoff file. No implementation files were modified after the assignment change.

## Current Worktree State

Relevant current diff is partial:

- `packages/db/src/schema/chronicle.ts` is new and defines `chronicleSnapshots`, `chronicleMemories`, `chronicleModelResources`, and `chronicleEvents`.
- `packages/db/src/schema/index.ts` exports `./chronicle`.
- `packages/db/src/schema/README.md` documents `chronicle.ts`.
- `apps/server/src/modules/chronicle/model.ts` is unchanged and still only models config, timeline entry, memory entry, summarize response, and status.
- `apps/server/src/modules/chronicle/index.ts` is unchanged and exposes only config, summarize, status, daemon resources, timeline, frame image, and memories.
- `apps/server/src/modules/chronicle/service.ts` is unchanged and still uses file scanning for timeline/memories plus in-memory summary counters.
- `apps/server/src/modules/chronicle/README.md` does not exist.

## Review Verdict

The current Server/DB slice does not yet satisfy the ExecPlan acceptance criteria. It has a reasonable first schema draft, but persistence is not wired into server behavior, there is no migration, and there are no API contracts for recording snapshots, recording memories, searching memories, listing model resources, or reading persisted events.

This means the current implementation cannot yet provide DB-backed snapshots, memories, model resource status, events, memory search, or summarize status/event persistence.

## Blocking Gaps

1. No SQLite migration exists for the new Chronicle tables.

   The schema file is exported, but the server migration runner only runs files under `packages/db/drizzle`. Without a generated or handwritten migration, runtime DB access to `chronicle_*` tables will fail with missing-table errors. The original Worker A write scope did not include `packages/db/drizzle/*`, so this needs main-agent integration or explicit scope expansion.

2. Server service still reads timeline and memories from the filesystem.

   `apps/server/src/modules/chronicle/service.ts` still uses `readdir`, `stat`, `readFile`, and `MEMORY_FILE_RE`. `getTimeline()` scans capture files from `storageRoot`; `getMemories()` scans `storageRoot/memories` and only accepts filenames matching `^(\d+)-(10min|6h)\.md$`. This is explicitly called out in the ExecPlan as broken relative to the Rust filename format and does not prove DB-backed UI data.

3. `summarize()` does not persist success or failure.

   The summarize path returns plain `{ summary }`. It does not insert `chronicleMemories`, does not insert `chronicleEvents`, does not store usage metadata, and does not update durable status. Configuration failures are returned as summary strings, not persisted events.

4. Status remains process-local and incomplete.

   `summaryCount` and `lastSummaryAt` are module-level variables, still not updated by `summarize()`, and would reset on process restart. The ExecPlan requires status to reflect persisted summary/event state.

5. Missing service functions required by the ExecPlan.

   The plan explicitly names these service exports: `searchMemories(query, limit)`, `getModelResources()`, `recordSnapshot(input)`, and `recordMemory(input)`. None exist in the current service file.

6. Missing API routes and schemas for daemon ingestion and UI search.

   `index.ts` has no route for recording snapshots or memories from Rust, no memory search endpoint, no model resource endpoint backed by DB, and no events endpoint. `model.ts` has no schemas for record snapshot body, record memory body, model resource response, event response, or search query/response.

7. `apps/server/src/modules/chronicle/README.md` is missing.

   The repo instructions require updated module README inventory when changing the module. This is currently absent.

## Schema Review

The schema draft is directionally aligned with the ExecPlan because it creates a Chronicle-owned namespace and includes the four required tables. There are still design and integration issues to resolve before main implementation lands.

Recommended schema fixes:

- Add a unique constraint or unique index for `chronicleModelResources.category`. The UI expects exactly one status per category (`ocr`, `audio-vad`, `audio-asr`, `speaker`, `embedding`). Without uniqueness, repeated seeding can create duplicate statuses.
- Consider whether `chronicleModelResources.status` should include both `available` and `installed`. These overlap semantically. A cleaner first contract is usually `available`, `missing`, `installing`, `error`, where `available` means usable now. If keeping both, document the distinction.
- Consider indexing memory content search. A simple `LIKE` search can ship first, but the schema has no FTS table. If the acceptance bar is only keyword search, service-level `LIKE` is acceptable; if the UI is expected to scale, add an FTS follow-up.
- Add stable external idempotency support for daemon reports. `recordSnapshot()` and `recordMemory()` will need a dedupe key, because Rust may retry after server failures. Current schema has no `externalId`, `artifactPath` unique index, or source hash. Without idempotency, retry recovery can duplicate snapshots and memories.
- `chronicleSnapshots.framePath` and `artifactPath` need clear semantics. The current server frame endpoint expects a segment-relative path, while Rust may send absolute persisted artifact paths. Pick one canonical storage field and document how `getFrameImage()` resolves it.
- Decide whether `chronicleMemories.createdAt` should use the shared `timestamps()` helper. The current explicit `createdAt`/`updatedAt` fields are fine, but service code must always set both because there is no default.
- If model profile references should be protected, `chronicleMemories.modelProfileId` can reference `agentProfiles.id`; if avoiding cross-owner lifecycle coupling is intentional, leaving it as plain text is acceptable.

## API Contract Needed

To satisfy the ExecPlan and unblock Rust/Web workers, the server module should expose at minimum:

- `GET /chronicle/timeline?limit=...`
  - Reads `chronicleSnapshots`, not filesystem scans.
- `GET /chronicle/memories?limit=...`
  - Reads `chronicleMemories`, not memory markdown filenames.
- `GET /chronicle/memories/search?q=...&limit=...`
  - Searches persisted memory content and possibly OCR text if desired.
- `GET /chronicle/model-resources`
  - Returns the five required categories with deterministic defaults even before any install flow exists.
- `GET /chronicle/events?limit=...`
  - Useful for UI/debug and for tests proving status/event persistence.
- `POST /chronicle/snapshots`
  - Rust daemon ingestion for captured frame metadata and OCR text.
- `POST /chronicle/memories`
  - Rust daemon ingestion for local/imported summaries and source paths.
- `POST /chronicle/summarize`
  - Calls the selected profile, persists `chronicleMemories` on success, persists `chronicleEvents` on success and failure, returns structured metadata beyond only `summary`.

The current `/chronicle/resources` route calls `DaemonManager.getDaemonResources()` and reports process resource usage, not Chronicle model resource status. Keep it as daemon resources if useful, but add a separate model-resource route to avoid API ambiguity.

## Service Implementation Notes

Recommended implementation shape:

- Import `db()` from `../../infra` and Chronicle tables from `@cradle/db`.
- Use `randomUUID()` for ids and `currentUnixSeconds()` for durable timestamps.
- Add small JSON helpers for `metadataJson`, `sourceSnapshotIdsJson`, `sourcePathsJson`, `usageJson`, and event attrs.
- Make `recordSnapshot()` and `recordMemory()` pure DB writes plus event writes. Avoid reading artifact files during ingestion.
- Keep `getFrameImage()` file-backed, but make timeline frame references DB-backed.
- Seed default model resources lazily in `getModelResources()` with idempotent upserts. This requires a unique category constraint or a deterministic id per category.
- Have `summarize()` throw or return a structured error consistently, but always write a `chronicleEvents` row for config/profile/key/model/generate failures.
- Capture AI SDK usage if available from `generateText()` result. If usage shape is unstable, store the raw usage object in `usageJson` with a defensive fallback.

## Tests Needed

Server tests should cover:

- `recordSnapshot()` inserts a snapshot and event, and `getTimeline()` returns that DB row without filesystem setup.
- `recordMemory()` inserts a memory and event, and `getMemories()` returns that DB row without filename regex dependency.
- `searchMemories()` finds persisted memory content and respects `limit`.
- `getModelResources()` returns all five required categories on an empty DB and remains idempotent across repeated calls.
- `summarize()` success path inserts one memory and at least one success event, stores profile/model ids, and updates status from DB.
- `summarize()` config failure path inserts an error/warning event and does not insert a memory.
- `summarize()` missing API key/profile path inserts an explicit event.
- `getStatus()` reports `lastSummaryAt` and `totalSummaries` from persisted memories/events rather than module-level variables.
- HTTP route schemas validate snapshot/memory ingestion bodies and memory search query parameters.

Validation commands from the ExecPlan remain appropriate:

```bash
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
```

If migration is added, also run the server tests against a fresh DB path to catch missing-table or migration ordering failures.

## Migration Risk

This is the largest integration risk. `packages/db/src/schema/chronicle.ts` alone is not enough because `apps/server/src/database/migration-runner.ts` runs Drizzle migrations from `packages/db/drizzle`.

The main implementation needs one of these decisions:

- Expand the Server/DB node write scope to include `packages/db/drizzle/*` and generate a migration.
- Have the main agent own the migration as an integration step after schema review.
- Temporarily create tables in tests only, but this does not satisfy runtime acceptance and should not be treated as complete.

Given the ExecPlan says the implementation may be breaking and can assume no old Chronicle compatibility, a new migration that creates the four `chronicle_*` tables is the straightforward path.

## Acceptance Against ExecPlan

Current state:

- DB-backed snapshots: not satisfied. Table draft exists, no service write/read path, no migration.
- DB-backed memories: not satisfied. Table draft exists, no summarize/record persistence, no migration.
- Model resource status: not satisfied. Table draft exists, no deterministic defaults or API.
- Events: not satisfied. Table draft exists, no service writes, no API, no migration.
- Memory search: not satisfied. No service or route.
- Summarize status/event persistence: not satisfied. Current summarize returns text only and does not persist.

The main implementation can satisfy the ExecPlan if it completes the missing service/API/migration/test work above. Schema alone is insufficient.

## Suggested Main-Agent Next Steps

1. Decide migration ownership first, because otherwise every DB-backed route can compile but fail at runtime.
2. Finish the Chronicle server service as the canonical persistence owner.
3. Add ingestion/search/model-resource/event schemas and routes.
4. Add `apps/server/src/modules/chronicle/README.md` documenting API and ownership.
5. Add focused Chronicle tests before wiring Rust/Web against the new API.
