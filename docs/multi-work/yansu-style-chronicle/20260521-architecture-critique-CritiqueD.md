# Architecture Critique D: Yansu-Style Chronicle

## Scope

This critique read:

- `docs/exec-plans/20260521-03-yansu-style-chronicle.md`
- `docs/draft-solutions/yansu-chronicle-spec.md`
- Current Chronicle Rust, Server, Web, and DB files under `chronicle/`, `apps/server/src/modules/chronicle/`, `apps/web/src/features/chronicle/`, and `packages/db/src/schema/`

No implementation files were edited. This handoff is intentionally adversarial: the current plan is directionally correct, but it still leaves several integration gaps that can produce a Chronicle UI that looks complete while failing the user's goal of a directly usable local activity memory system.

## Executive Finding

The biggest risk is not missing UI. The biggest risk is that the plan says "DB-backed canonical Chronicle", but the actual end-to-end ingest contract is still underspecified and partially absent:

- Rust has client methods for `POST /api/chronicle/snapshots` and `POST /api/chronicle/memories` in `chronicle/src/cradle_client.rs:195`, but Server exposes no matching routes in `apps/server/src/modules/chronicle/index.ts:10`.
- Server still reads timeline and memories from files in `apps/server/src/modules/chronicle/service.ts:201` and `apps/server/src/modules/chronicle/service.ts:325`.
- The new DB schema exists in `packages/db/src/schema/chronicle.ts:9`, but I found no migration SQL for `chronicle_snapshots`, `chronicle_memories`, `chronicle_model_resources`, or `chronicle_events`.
- Web search in `apps/web/src/features/chronicle/use-chronicle.ts:397` filters the limited `/chronicle/memories` payload client-side, so it is not durable memory search.

If this remains unchanged, users can enable Chronicle, see a daemon PID, maybe see file-backed captures, but the "Cradle-owned durable memory" path will be brittle or nonfunctional.

## Critical Issues

### 1. Ingest API contract is missing on the Server

Evidence:

- Plan requires `recordSnapshot(input)` and `recordMemory(input)` in `apps/server/src/modules/chronicle/service.ts` at `docs/exec-plans/20260521-03-yansu-style-chronicle.md:154`.
- Rust client posts snapshot reports to `/api/chronicle/snapshots` in `chronicle/src/cradle_client.rs:199`.
- Rust client posts memory reports to `/api/chronicle/memories` in `chronicle/src/cradle_client.rs:207`.
- Server routes only expose `GET /config`, `POST /summarize`, `PUT /config`, `GET /status`, `GET /resources`, `GET /timeline`, `GET /frame/:displayId/:segment/:frame`, and `GET /memories` in `apps/server/src/modules/chronicle/index.ts:10`.

Risk:

Rust-side reporting will fail as soon as wired into the daemon. If failures are treated as non-fatal, data silently remains file-only. If treated as fatal, capture becomes fragile.

Acceptance criteria to add:

- `POST /api/chronicle/snapshots` exists, validates the exact camelCase Rust payload, upserts by a stable external source ID, persists a `chronicle_snapshots` row, and records a `chronicle_events` row.
- `POST /api/chronicle/memories` exists, validates the exact camelCase Rust payload, upserts by a stable external source ID, persists a `chronicle_memories` row, links source snapshots when possible, and records a `chronicle_events` row.
- Rust tests should use a local mock HTTP server and prove the client sends payloads that Server accepts, not just that serde JSON contains expected fields.
- Server tests should call the Elysia routes, not only service functions.

### 2. DB schema has no migration path

Evidence:

- `packages/db/src/schema/chronicle.ts:9` defines `chronicleSnapshots`.
- `packages/db/src/schema/chronicle.ts:28` defines `chronicleMemories`.
- `packages/db/src/schema/chronicle.ts:50` defines `chronicleModelResources`.
- `packages/db/src/schema/chronicle.ts:70` defines `chronicleEvents`.
- `packages/db/drizzle/` currently ends at `0022_automation_platform.sql`; no migration creates Chronicle tables.

Risk:

TypeScript can import the schema while runtime DB initialization still fails with "no such table". This is the most likely "typecheck passes, app unusable" failure.

Acceptance criteria to add:

- A migration creates all four Chronicle tables and indexes.
- A fresh dev DB migration run succeeds.
- A focused server test starts with an empty DB, calls Chronicle ingest routes, and reads rows back through DB-backed timeline, memory list, and event/status APIs.

### 3. Search is currently under-scoped and can give false confidence

Evidence:

- The plan requires `searchMemories(query, limit)` in `apps/server/src/modules/chronicle/service.ts` at `docs/exec-plans/20260521-03-yansu-style-chronicle.md:161`.
- Server exposes no `/chronicle/search` or query-aware memory route in `apps/server/src/modules/chronicle/index.ts:39`.
- Web `useChronicleMemorySearch()` uses `getChronicleMemoriesOptions({ query: { limit } })` and filters client-side in `apps/web/src/features/chronicle/use-chronicle.ts:397`.

Risk:

Searching only the latest 20 memory rows is not memory search. A user can fail to find older activity even though it exists in Chronicle. This violates the Yansu-style "agent/search over long-term memory" goal.

Acceptance criteria to add:

- Add a Server-owned search route, for example `GET /chronicle/memories/search?q=&limit=`.
- Search must query persisted DB rows, not the current page of memory results.
- Search should cover at least `chronicle_memories.content`, `title` or metadata if present, and optionally OCR text via source snapshots.
- Test must insert more memories than the default list limit and verify search finds an older matching row outside the first page.

### 4. Summary generation persists nowhere canonical today

Evidence:

- Server `summarize()` returns `{ summary: result.text }` at `apps/server/src/modules/chronicle/service.ts:129`.
- `summaryCount` and `lastSummaryAt` are module variables at `apps/server/src/modules/chronicle/service.ts:139` and are never updated in the shown implementation.
- Rust writes the LLM summary markdown after Server responds in `chronicle/src/daemon.rs:228`, but Server has no memory insert in that path.

Risk:

The model call can succeed while the UI's canonical memory list stays empty after DB-backed migration. If the Rust memory report then fails because Server routes are missing or down, the only record is a local markdown file outside the canonical UI path.

Acceptance criteria to add:

- `summarize()` must persist a `chronicle_memories` row and a success or failure `chronicle_events` row itself, even before Rust reports a markdown file.
- The response should include `memoryId`, `eventId`, `status`, and `summary`, not just summary text.
- `lastSummaryAt` and `totalSummaries` must be derived from DB, not module-local process memory.
- Failure cases such as missing profile, missing key, and model-call exception must create DB events.

### 5. Rust fallback/retry is underspecified

Evidence:

- Plan says Rust should retry later if Server is unavailable at `docs/exec-plans/20260521-03-yansu-style-chronicle.md:70`.
- Existing daemon keeps pending frames only in memory as `all_persisted` in `chronicle/src/daemon.rs:88`.
- It clears `all_persisted` after `run_summary()` even when Server reporting is not guaranteed in `chronicle/src/daemon.rs:153`.
- Artifacts are durable in `chronicle/src/recorder/artifacts.rs:44`, but there is no durable outbox or replay scanner.

Risk:

"Retry on next loop" is not implementable from the current plan without defining durable pending state. A daemon restart, Server downtime, or ingestion route mismatch can permanently strand records as files that the DB-backed UI will not read.

Acceptance criteria to add:

- Define one recovery mechanism:
  - Server-side file ingester that scans artifact and memory directories into DB on startup or endpoint request, or
  - Rust-side durable outbox under `~/.cradle/chronicle/outbox/` with acknowledged/dead-letter states.
- Add idempotency keys for snapshots and memories. `sourceId` may work, but it must be unique-indexed in DB.
- Test restart recovery: write artifacts while Server is unavailable, restart or run ingest, then verify timeline and memory APIs return DB rows.

### 6. Model resource status is currently UI-compatible, not behaviorally owned

Evidence:

- Plan requires model resources to be "behavioral, not fake" at `docs/exec-plans/20260521-03-yansu-style-chronicle.md:72`.
- Web has default local resource entries in `apps/web/src/features/chronicle/use-chronicle.ts:77`, including OCR as available and optional audio/embedding resources.
- Server `/resources` currently returns daemon process resources via `apps/server/src/modules/chronicle/index.ts:29`, backed by `getDaemonResources()` in `apps/server/src/modules/chronicle/service.ts:177`, not model resource rows.
- DB has `chronicleModelResources` in `packages/db/src/schema/chronicle.ts:50`, but I found no Server reader/writer for it.

Risk:

The endpoint name `/resources` is overloaded: process RSS vs local model resources. The UI may normalize daemon resource data into defaults and appear complete while no Chronicle-owned local model resource state exists.

Acceptance criteria to add:

- Split route names:
  - Keep process usage at `/chronicle/daemon/resources` or similar.
  - Use `/chronicle/model-resources` for OCR/VAD/ASR/speaker/embedding.
- Server must return five model resource categories from DB or a deterministic service-owned baseline.
- OCR availability should distinguish macOS Vision runtime from installed model assets.
- UI must consume the Server model-resource route, not silently substitute defaults except as loading fallback.

### 7. Path and ownership boundaries need tightening before DB ingest

Evidence:

- Rust reports absolute paths for `segment_dir`, `frame_path`, `capture_path`, `ocr_path`, and `snapshot_path` in `chronicle/src/cradle_client.rs:61`.
- Server frame endpoint constructs a path from request params and only checks `resolvedPath.startsWith(storageRoot)` in `apps/server/src/modules/chronicle/service.ts:291`.
- Snapshot schema has both `segmentDir`, `framePath`, and `artifactPath` in `packages/db/src/schema/chronicle.ts:15`.

Risk:

Absolute paths in DB make storage-root migration, privacy review, and URL construction harder. The `startsWith` path check is also not strict enough for sibling path prefixes, for example `/tmp/root2` starts with `/tmp/root`.

Acceptance criteria to add:

- Persist root-relative artifact paths in DB where possible. Keep absolute paths only in event metadata if required for debugging.
- Frame serving must resolve from a DB snapshot ID or validate relative paths with `path.relative()` and reject `..` / absolute inputs.
- `GET /chronicle/frame/...` should not require the UI to concatenate raw `segmentDir` and `framePath` strings from DB. Prefer `frameUrl` or `snapshotId` in the timeline response.

### 8. The plan under-specifies the "directly usable first launch" timing

Evidence:

- Plan acceptance says wait for at least one capture cycle and see a memory at `docs/exec-plans/20260521-03-yansu-style-chronicle.md:114`.
- Daemon only summarizes every 600 seconds in `chronicle/src/daemon.rs:90`.
- Capture can show quickly, but memory generation may take ten minutes unless forced by `MAX_PENDING_FRAMES` at `chronicle/src/daemon.rs:125`.

Risk:

First-launch usability will feel broken: a user can enable Chronicle and see no memory for ten minutes, with no clear "generate now" affordance or progress.

Acceptance criteria to add:

- Add a manual "summarize recent captures now" Server route or UI action, or shorten the first summary window with an explicit first-run behavior.
- Status must expose last capture time, pending snapshot count, last summarize attempt, and last error.
- Manual validation should require a memory within a bounded time, for example under 90 seconds using inbox/run-once or a manual summarize route.

### 9. Workspace scoping is ambiguous

Evidence:

- Config includes `workspaceId` in `apps/server/src/modules/chronicle/service.ts:24`.
- Schema includes nullable `workspaceId` references in `packages/db/src/schema/chronicle.ts:11` and `packages/db/src/schema/chronicle.ts:30`.
- Rust remote config contains `workspace_id` in `chronicle/src/cradle_client.rs:23`, but snapshot/memory reports do not include workspace ID in `chronicle/src/cradle_client.rs:48` or `chronicle/src/cradle_client.rs:81`.

Risk:

Chronicle records may be global by accident while the UI and future agent memory retrieval expect workspace-scoped semantics. Conversely, using the last selected workspace for all passive desktop activity may incorrectly attribute cross-workspace activity.

Acceptance criteria to add:

- Make an explicit decision: Chronicle records are global with optional workspace projection, or they are scoped to the configured workspace at capture time.
- If scoped, include `workspaceId` in Rust report payloads and Server DB rows.
- If global, remove `workspaceId` from required UI semantics and add filters later rather than pretending workspace scoping is reliable.

### 10. Privacy and permissions are not acceptance-gated

Evidence:

- Yansu spec emphasizes permission state and privacy filtering.
- Current plan mentions local screen capture and Vision OCR, but acceptance at `docs/exec-plans/20260521-03-yansu-style-chronicle.md:118` does not require permission diagnostics or privacy filter behavior.
- Current Rust artifact storage persists OCR text and image paths directly in `chronicle/src/recorder/artifacts.rs:44`.

Risk:

A "usable" Chronicle that silently captures nothing due to macOS permissions is not usable. A Chronicle that captures private windows without visible status is risky for a local activity recorder.

Acceptance criteria to add:

- Status API must expose permission or capture capability diagnostics, at least `screenCapturePermission`, `ocrAvailable`, and `lastCaptureError`.
- UI must distinguish "enabled but permission denied" from "enabled and running".
- Add a focused test or smoke fixture proving privacy-filtered frames are counted and not ingested into DB.

## Over-Scoped or Misleading Parts

- Audio VAD, ASR, speaker, and embedding resources should not be framed as installable behavior in this iteration unless there is a real install/check mechanism. It is acceptable to show them as optional future resources, but not as implemented capabilities.
- The schema includes `appBundleId` and `windowTitle` in `packages/db/src/schema/chronicle.ts:19`, but the artifact writer currently does not persist window metadata in `capture_json()` at `chronicle/src/recorder/artifacts.rs:111`. Either wire it end to end or keep it metadata-only.
- The UI timeline scrubber is polish, but it is less important than ingest, search, and diagnostics. Do not let timeline UI work substitute for DB correctness.

## Minimum Tightened Acceptance Set

The plan should not be marked complete until all of this is true:

1. Fresh database migration creates Chronicle tables and indexes.
2. Enabling Chronicle starts the daemon and records a daemon event in DB.
3. At least one captured snapshot is visible through `GET /chronicle/timeline` from DB, not from scanning files.
4. At least one memory is visible through `GET /chronicle/memories` from DB after either the periodic summarizer or a manual summarize route.
5. `GET /chronicle/memories/search?q=...` finds a matching memory outside the default list page.
6. Rust snapshot and memory report routes are accepted by Server and are idempotent.
7. Server downtime does not permanently strand artifacts; a documented replay path ingests them later.
8. UI shows daemon status, last capture, last summary, model call error, and local model resource status from Server data.
9. Missing profile/key/model creates visible events and a user-readable status instead of returning a fake summary string.
10. Manual smoke path proves first-use capture plus memory generation in a bounded time without waiting ten minutes.

## Suggested Plan Edits

- Add a "DB migration and ingest contract" milestone before Web work.
- Add a "recovery/outbox" milestone before marking Rust daemon integration complete.
- Rename `/chronicle/resources` or split it so daemon process resources do not conflict with model resources.
- Replace client-side memory search with a Server route and DB query.
- Make `summarize()` return a structured persisted result, not only `{ summary }`.
- Require route-level tests for `/chronicle/snapshots`, `/chronicle/memories`, `/chronicle/memories/search`, `/chronicle/model-resources`, and `/chronicle/status`.

