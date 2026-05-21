# Build Yansu-Style Cradle Chronicle

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained so another contributor can resume the work with only this file and the repository checkout.

## Purpose / Big Picture

Cradle Chronicle should become a usable local activity memory system inspired by `docs/draft-solutions/yansu-chronicle-spec.md`, but shaped by Cradle ownership boundaries. After this work, a user can open Settings > Chronicle, enable local screen activity capture, choose an existing Cradle model profile for summary generation, see a live capture timeline, see generated activity memories, search those memories, and inspect whether the local Chronicle runtime and local model resources are available. The system must be useful on first launch without requiring audio or messaging integrations; macOS screen capture plus Vision OCR is the first production path, and optional local model categories are represented as Chronicle-owned resources that can be installed later.

The implementation is intentionally breaking. Compatibility with the current file-only Chronicle memory reader is not required. The requested end state is a Cradle-owned Chronicle namespace with durable records, observable model calls, and a front-end experience that can be used directly.

## Progress

- [x] (2026-05-20 17:35Z) Read the current `$multi-work` and `execplan` skills. Strategy 1 requires a Plan File before DAG implementation; Strategy 2 requires handoff files for critique-chain review.
- [x] (2026-05-20 17:35Z) Inspected current Chronicle Rust crate, Server Chronicle module, Web Chronicle settings, and DB schema export surface.
- [x] (2026-05-20 17:35Z) Confirmed the repository has many unrelated dirty worktree changes. Chronicle work must not revert unrelated files.
- [x] (2026-05-20 18:00Z) Created Cradle-owned Chronicle database schema and migration for snapshots, memories, model resources, and events. `packages/db/src/schema/index.ts` already exports the schema barrel, and `packages/db/src/schema/README.md` now lists `chronicle.ts`.
- [x] (2026-05-20 18:00Z) Replaced Server Chronicle file-only timeline/memory reading with DB-backed ingest, timeline, memory list, literal memory search, local model resource status, snapshot frame serving by snapshot id, and status derived from persisted records.
- [x] (2026-05-20 18:00Z) Updated Server `summarize()` to validate enabled/profile/API key state, call the configured profile/model through AI SDK, persist successful summaries as Chronicle memories, and record success/failure events with usage when available.
- [x] (2026-05-20 18:00Z) Extended the Rust Chronicle daemon client and loop so persisted frames and local summary markdown are reported to Server as best-effort snapshot/memory reports after local artifacts are written.
- [x] (2026-05-20 18:00Z) Updated Settings > Chronicle to show capture enablement, provider/model selection, runtime status, Chronicle-owned local model resource state, DB-backed timeline, snapshot-frame preview, memories, and server-side memory search.
- [x] (2026-05-20 18:00Z) Ran targeted Rust, Server, and Web validation. Results are recorded in Outcomes & Retrospective.
- [x] (2026-05-20 18:25Z) Fixed the Chronicle DB migration chain by replacing the orphan hand-written `0023_yansu_style_chronicle.sql` with `drizzle-kit generate` output: `0023_outstanding_diamondback.sql`, `meta/0023_snapshot.json`, and a matching `_journal.json` entry.
- [x] (2026-05-20 18:30Z) Re-ran fresh-database smoke against an isolated `CRADLE_DATA_DIR`; migration 0023 was recorded in `__drizzle_migrations`, all four Chronicle tables existed, and timeline/memory/search/frame HTTP paths returned 200.
- [x] (2026-05-20 18:55Z) Upgraded Slack from manual-only source sync to a Server-owned background polling lifecycle. Enabled Slack sources are checked on Server startup and every 60 seconds, while the manual sync endpoint remains available for immediate pulls.

## Surprises & Discoveries

- Observation: Current Chronicle memories are written with filenames like `20260518173631-ccxi-10min-cradle_llm_summary.md`, but the Server memory reader only accepts `^(\d+)-(10min|6h)\.md$`.
  Evidence: `chronicle/src/memory_pipeline/naming.rs` defines `memory_filename()` as `<timestamp>-<suffix>-<window>-<slug>.md`, while `apps/server/src/modules/chronicle/service.ts` defines `MEMORY_FILE_RE = /^(\d+)-(10min|6h)\.md$/`.
- Observation: Current Server Chronicle status exposes `summaryCount` and `lastSummaryAt`, but the summarize path never updates them.
  Evidence: `apps/server/src/modules/chronicle/service.ts` defines those variables and returns them from `getStatus()`, while `summarize()` returns `result.text` without mutating them.
- Observation: Rust Chronicle already uses macOS CoreGraphics display capture and Vision OCR, not just synthetic frames.
  Evidence: `chronicle/src/screen/macos.rs` calls `CGDisplay::image()` and `VNRecognizeTextRequest`.
- Observation: The Rust client was posting to `/api/chronicle/*`, while Server and Web use `/chronicle/*`.
  Evidence: `chronicle/src/cradle_client.rs` had `/api/chronicle/config`, `/api/chronicle/summarize`, `/api/chronicle/snapshots`, and `/api/chronicle/memories`; `apps/server/src/modules/chronicle/index.ts` mounts `new Elysia({ prefix: '/chronicle' })`.
- Observation: Web status timestamps from Server are Unix seconds, not JavaScript milliseconds.
  Evidence: `apps/server/src/modules/chronicle/service.ts` returns persisted integer seconds; `apps/web/src/features/chronicle/chronicle-settings.tsx` previously passed numeric values directly to `new Date(value)`.
- Observation: The old timeline frame URL was coupled to display/segment/frame path splitting, but DB-backed rows have a stable snapshot id.
  Evidence: Server now exposes `GET /chronicle/snapshots/:snapshotId/frame`; Web now uses that route for timeline preview.
- Observation: Desktop can start Server on fallback ports `21424`, `21425`, or `21426`, while Rust defaulted to `http://127.0.0.1:21423`.
  Evidence: `apps/desktop/src/main/server-process.ts` chooses the first free port from `[21423, 21424, 21425, 21426]`; `chronicle/src/cradle_client.rs` defaults `CRADLE_URL` to `http://127.0.0.1:21423`.
- Observation: A hand-written Chronicle SQL file without a matching Drizzle snapshot and journal entry is invisible to the runtime migrator on a fresh database.
  Evidence: An isolated Server with a new `CRADLE_DATA_DIR` returned `no such table: chronicle_events`, `no such table: chronicle_snapshots`, and `no such table: chronicle_memories` until the migration was regenerated with `drizzle-kit generate`.
- Observation: The previous Slack integration was usable only after pressing a manual sync button.
  Evidence: `apps/server/src/modules/chronicle/service.ts` exposed `syncSlackSource()` only through `POST /chronicle/message-sources/:sourceId/sync`; Server startup did not schedule any Slack source polling.

## Decision Log

- Decision: Keep local small models in the Chronicle-owned data namespace, not in source control, not in `.agents`, and not in chat provider profile storage.
  Rationale: OCR/VAD/ASR/speaker/embedding models are local runtime resources owned by Chronicle. Chat provider profiles own remote LLM credentials and model IDs. This avoids lifecycle confusion and respects Cradle namespace ownership.
  Date/Author: 2026-05-20 / Codex.
- Decision: Let Rust Chronicle own low-level local sensing and local inference, while Server Chronicle owns model calls, durable semantic records, model resource management, and UI-facing API.
  Rationale: Rust is the right place for screen capture, OCR, local ONNX/Sherpa models, idle detection, and daemon behavior. Server already owns profiles, secrets, AI SDK provider creation, observability, DB, and OpenAPI contracts.
  Date/Author: 2026-05-20 / Codex.
- Decision: Make this implementation breaking and DB-backed instead of preserving the current file-only memory list contract.
  Rationale: The user explicitly allowed destructive changes and wants a directly usable implementation. File artifacts remain useful evidence, but UI and search should read canonical Cradle records.
  Date/Author: 2026-05-20 / Codex.
- Decision: Use `/chronicle/*` as the canonical Server contract instead of adding a duplicate `/api/chronicle/*` alias.
  Rationale: Server already mounts Chronicle at `/chronicle`, generated Web SDK already uses `/chronicle`, and desktop/web server URL resolution points directly at the Server origin. Moving Rust to the same contract removes a split-brain API without duplicating routes.
  Date/Author: 2026-05-20 / Codex.
- Decision: Keep Web on generated hooks for existing Chronicle endpoints, but use a narrow hand-written fetch boundary for the newly added `model-resources` and `memories/search` routes until `api-gen` is intentionally regenerated.
  Rationale: This keeps Settings > Chronicle usable immediately without sweeping generated API churn from unrelated dirty Server work. `use-chronicle.ts` remains the single compatibility boundary.
  Date/Author: 2026-05-20 / Codex.
- Decision: Inject the actual Server URL into the Rust Chronicle daemon through `CRADLE_URL` when Server starts it.
  Rationale: Desktop-owned Server startup may use fallback ports. Passing the configured host and port from `apps/server/src/modules/chronicle/daemon-manager.ts` makes Rust report snapshots and memories to the same Server instance that launched it.
  Date/Author: 2026-05-20 / Codex.
- Decision: Use `drizzle-kit generate` as the source of truth for the Chronicle migration artifact, and keep the SQL, `meta/0023_snapshot.json`, and `_journal.json` entry together.
  Rationale: Drizzle's migrator reads the journal and migration folder as a chain. A standalone SQL file can look correct in review but not be applied in a new runtime database.
  Date/Author: 2026-05-20 / Codex.
- Decision: Use a Server-owned Slack polling loop before adding Slack Socket Mode.
  Rationale: The user-facing unblock is that configured Slack sources ingest without repeated manual clicks. Polling `conversations.history` reuses the existing secret/source/message contract and can be verified deterministically; Socket Mode can later be added as a lower-latency worker over the same Chronicle-owned tables.
  Date/Author: 2026-05-20 / Codex.

## Outcomes & Retrospective

The DB-backed Chronicle slice is now implemented and targeted validation passes. A user-visible Settings > Chronicle path exists for enabling capture, selecting a configured provider/model, seeing runtime state, seeing Chronicle-owned local model resource status, browsing DB-backed captures, previewing snapshot frames by snapshot id, listing generated/imported memories, and searching memories through the Server.

Validation results:

    pnpm --filter @cradle/server exec tsc --noEmit
    passed

    pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
    passed

    pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
    passed

    cargo fmt --manifest-path chronicle/Cargo.toml
    passed

    cargo test --manifest-path chronicle/Cargo.toml
    passed

    cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
    passed

    pnpm --filter @cradle/web exec tsc --noEmit
    failed in unrelated src/features/chat/use-chat-session-binding.test.tsx type errors: TS2493 at line 189 and TS2349 at lines 193 and 203. Chronicle files were separately linted successfully.

Fresh database smoke after regenerating migration 0023 with Drizzle Kit:

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    generated packages/db/drizzle/0023_outstanding_diamondback.sql and packages/db/drizzle/meta/0023_snapshot.json

    isolated Server on http://127.0.0.1:21433 with a new CRADLE_DATA_DIR
    __drizzle_migrations included created_at 1779301267428 from 0023_outstanding_diamondback
    sqlite_master included chronicle_events, chronicle_memories, chronicle_model_resources, and chronicle_snapshots
    GET /chronicle/timeline returned 200
    GET /chronicle/memories returned 200
    GET /chronicle/memories/search?q=ChronicleSmokeAlpha returned 200
    GET /chronicle/snapshots/:snapshotId/frame returned 200

Slack message import now has a background lifecycle. `createServerApp({ startBackgroundTasks: true })` starts a Chronicle-owned Slack polling loop; enabled sources are synced immediately and then every 60 seconds. The route `POST /chronicle/message-sources/:sourceId/sync` remains the manual immediate pull path. The Chronicle server test now proves that `runSlackSyncTick()` imports a configured Slack source and that the manual endpoint is idempotent afterward.

Validation after the Slack background sync update:

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    passed with "No schema changes, nothing to migrate"

    pnpm --filter @cradle/server exec tsc --noEmit
    passed

    pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
    passed

The remaining limitation is scope, not a hidden broken Chronicle path: audio VAD, local ASR, speaker labeling, embedding install flows, semantic deduplication, and Slack Socket Mode are not yet implemented. Slack is currently background polling over `conversations.history`. The first directly usable local path is screen capture with macOS Vision OCR plus remote-model summary generation through configured Cradle profiles.

## Context and Orientation

The source target is `docs/draft-solutions/yansu-chronicle-spec.md`. It describes a desktop activity assistant that listens to local screen, accessibility, audio, and messages; crystallizes raw activity into long-term memory; and later lets agents search or act on that memory. Cradle should follow the same behavior direction without copying Yansu's Go/Wails boundaries.

The current Rust crate is under `chronicle/`. Its binary is `cradle-chronicle`. It can run in smoke mode or daemon mode. `chronicle/src/daemon.rs` owns the capture loop. `chronicle/src/screen/macos.rs` owns macOS screen capture and Vision OCR. `chronicle/src/recorder/` owns privacy filtering, deduplication, and artifact writes. `chronicle/src/memory_pipeline/` owns prompt building and local summary writing. `chronicle/src/cradle_client.rs` calls Cradle Server's `/chronicle/config` and `/chronicle/summarize` endpoints.

The current Server module is under `apps/server/src/modules/chronicle/`. `service.ts` reads and writes Chronicle preferences, calls AI SDK `generateText()`, starts the Rust daemon through `daemon-manager.ts`, and reads timeline/memory data from local files. `index.ts` exposes `/chronicle/*` HTTP routes. `model.ts` defines Elysia TypeBox schemas.

The current Web settings surface is under `apps/web/src/features/chronicle/`. `chronicle-settings.tsx` renders a Settings page with enablement, model selection, status, timeline preview, and memories. `use-chronicle.ts` wraps generated API hooks.

The canonical database schema exports live under `packages/db/src/schema/`. New Chronicle-owned tables should be created in `packages/db/src/schema/chronicle.ts` and exported from `packages/db/src/schema/index.ts`. The directory README must be updated when this directory changes.

Key terms used in this plan: a daemon is a background process started by the Server and stopped when Chronicle is disabled. An artifact is an image or JSON file written under Chronicle storage root. A snapshot is one persisted capture frame plus OCR text and window metadata. A segment is a group of snapshots that represents one activity window. A memory is a durable Cradle record derived from one or more segments. A local model resource is a small on-disk model such as OCR, VAD, ASR, speaker embedding, or text embedding.

## Plan of Work

First, create a Cradle-owned Chronicle schema. Add `packages/db/src/schema/chronicle.ts` with tables for settings-visible runtime state, snapshots, memories, and local model resources. The first implementation should avoid over-modeling every Yansu table; it should still make the user behavior real. The minimum DB contract is `chronicleSnapshots`, `chronicleMemories`, `chronicleModelResources`, and `chronicleEvents`. `chronicleSnapshots` records captured frame metadata and OCR text. `chronicleMemories` records model or local summaries with searchable content and source snapshot IDs. `chronicleModelResources` records expected local resource categories and installation state. `chronicleEvents` records daemon/model-call events that the UI can show or that tests can inspect. Export these tables from `packages/db/src/schema/index.ts` and update `packages/db/src/schema/README.md`.

Second, replace the Server Chronicle module's file-only behavior with DB-backed behavior. Keep artifact files as evidence, but insert snapshots and memories into DB. `apps/server/src/modules/chronicle/service.ts` should expose config, status, timeline, memories, memory search, local model resource status, and summarize. The summarize endpoint should validate config, resolve the selected profile and API key, call AI SDK, record success or failure in `chronicleEvents`, update status counters, persist the generated memory, and return a structured response. If the selected model is missing or the key is unavailable, the response should be explicit and the event should be recorded.

Third, extend the Rust daemon to report work back to Server. It should keep writing artifacts for local evidence, but after a capture batch it should call Server with snapshot metadata. After a summary is generated, it should call Server with the memory content and source snapshot paths. If Server is unavailable, Rust should still write local artifacts and local summaries, then retry on the next loop rather than dropping evidence. The first version can use simple HTTP JSON through `chronicle/src/cradle_client.rs`.

Fourth, update the Web Chronicle Settings page so a user can understand and use the system. The page should show enablement, daemon status, configured remote model, local model resource categories, timeline, memories, and memory search. Local model resources should be behavioral, not fake: categories that are not implemented yet must be marked optional or not installed, and enabling audio/embedding-dependent behavior should clearly indicate that the local resource is required. The first directly usable path is screen capture and summary generation.

Fifth, use `$multi-work` Strategy 1 and Strategy 2. Strategy 1 is used for parallel DAG work: Server/DB, Rust daemon, and Web UI can be investigated and implemented independently once this plan exists. Strategy 2 is used to critique the architecture and then synthesize fixes. All sub-agent outputs must be written under `docs/multi-work/yansu-style-chronicle/` using the handoff filename convention.

## Concrete Steps

Work from `/Users/wibus/dev/Cradle`.

Create or update these files:

    packages/db/src/schema/chronicle.ts
    packages/db/src/schema/index.ts
    packages/db/src/schema/README.md
    apps/server/src/modules/chronicle/model.ts
    apps/server/src/modules/chronicle/service.ts
    apps/server/src/modules/chronicle/index.ts
    apps/server/src/modules/chronicle/README.md
    chronicle/src/cradle_client.rs
    chronicle/src/daemon.rs
    chronicle/src/config.rs
    chronicle/src/README.md
    apps/web/src/features/chronicle/use-chronicle.ts
    apps/web/src/features/chronicle/chronicle-settings.tsx
    apps/web/src/features/chronicle/README.md

Run these commands as validation after the relevant edits:

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    cargo fmt --manifest-path chronicle/Cargo.toml
    cargo test --manifest-path chronicle/Cargo.toml
    cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
    pnpm --filter @cradle/web exec tsc --noEmit

If generated OpenAPI hooks need to change for the Web app, run:

    pnpm --filter @cradle/web generate

For manual behavior validation, start the desktop stack in the normal way used by this repo:

    pnpm dev:desktop

Then open Settings > Chronicle. Select a model profile, enable Chronicle, wait for at least one capture cycle, and confirm that the timeline shows a capture, the memory list shows a summary, and search can find a word visible in the OCR text or summary.

## Validation and Acceptance

Acceptance is behavioral. A user must be able to enable Chronicle from the UI, choose an existing model profile, see the daemon running, see at least one captured frame in the timeline, see at least one generated memory, and search memories. The UI must show local model resource status for at least OCR, audio VAD, audio ASR, speaker embedding, and text embedding categories, even if only OCR via macOS Vision is available initially.

Server tests should prove that `summarize()` records a memory and event on success, records an event on configuration failure, and that timeline/memory search read from DB rather than relying on a filename regex. Rust tests should prove that the client serializes snapshot/memory reports and that daemon fallback remains local if Server is unreachable. Web typecheck must pass after API type changes.

This plan is not complete if only code compiles. It is complete only when the end-to-end Chronicle behavior can be exercised by a human in the app or by a documented smoke path that proves the same API flow.

## Idempotence and Recovery

The implementation may be breaking. If migrations are added, they must be generated or reconciled through Drizzle Kit so the SQL file, snapshot, and journal entry are consistent. Chronicle can assume no compatibility with old file-only memory state. Artifact files under `~/.cradle/chronicle` are evidence, not the canonical UI source after this change. If a Server call from Rust fails, Rust must not delete local artifacts; it should continue to write local files and allow a later ingest or summary call to recover.

The worktree contains unrelated user changes. Do not run `git reset`, do not checkout unrelated files, and do not delete unrelated generated files. If a validation command fails because of unrelated dirty work, document the exact failure and continue narrowing Chronicle-specific checks.

## Artifacts and Notes

The first static scan found these relevant facts:

    chronicle/src/daemon.rs currently calls Cradle Server summarize only inside run_summary().
    apps/server/src/modules/chronicle/service.ts currently calls generateText() directly and returns result.text.
    apps/server/src/modules/chronicle/service.ts currently reads memory files with a filename regex that does not match Rust's current memory_filename().
    apps/web/src/features/chronicle/chronicle-settings.tsx already has a user-facing Settings page, so the fastest path is to make its data real and complete rather than create a new surface.

All `$multi-work` handoff files for this effort must be written under:

    docs/multi-work/yansu-style-chronicle/

## Interfaces and Dependencies

Use Drizzle schema builders from `drizzle-orm/sqlite-core` for new DB tables. Reuse `textPk`, `createdAt`, and `timestamps` from `packages/db/src/schema/shared.ts`.

In `packages/db/src/schema/chronicle.ts`, define and export at least:

    chronicleSnapshots
    chronicleMemories
    chronicleModelResources
    chronicleEvents

In `apps/server/src/modules/chronicle/service.ts`, expose functions for:

    getConfig()
    updateConfig(config)
    getStatus()
    getTimeline(limit)
    getMemories(limit)
    searchMemories(query, limit)
    getModelResources()
    recordSnapshot(input)
    recordMemory(input)
    summarize(body)

In `chronicle/src/cradle_client.rs`, expose methods for:

    fetch_config()
    summarize(prompt, window_type)
    record_snapshot(snapshot)
    record_memory(memory)

The local model resource categories are:

    ocr
    audio-vad
    audio-asr
    speaker
    embedding

These resources live under the Chronicle-owned data root:

    ~/.cradle/chronicle/models/

Revision note 2026-05-20: Initial plan created after reading the Yansu spec, current Chronicle implementation, `$multi-work`, and `execplan` rules. This plan intentionally chooses a breaking DB-backed implementation and records the Rust/Server/Web owner split.

Revision note 2026-05-20 18:00Z: Updated after integration. Recorded DB-backed schema/API/UI/Rust reporting completion, fixed `/api/chronicle` route mismatch by standardizing on `/chronicle`, documented validation results, and noted remaining local-model install flows as future capability work.

Revision note 2026-05-20 18:08Z: Added the desktop fallback-port discovery and `CRADLE_URL` injection decision so Rust reports to the actual Server port selected by desktop startup.

Revision note 2026-05-20 18:30Z: Corrected the migration implementation after fresh-database smoke caught missing Chronicle tables. The Chronicle migration is now the Drizzle Kit generated `0023_outstanding_diamondback` artifact set, including SQL, snapshot, and journal entry.

Revision note 2026-05-20 18:55Z: Added Server-owned Slack background polling. Enabled Slack sources are synced at startup and every 60 seconds; manual sync remains as an immediate pull and idempotence path. No DB migration was needed, and `drizzle-kit generate` remained clean.
