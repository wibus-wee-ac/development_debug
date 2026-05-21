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
- [x] (2026-05-20 19:15Z) Added a Chronicle-owned local model resource manager. Server now exposes model resource reconcile/verify/install/remove, stores resources under the Chronicle data namespace, rejects unverified manifest downloads, and Web Settings can install from local files/directories, verify, reconcile, and remove resources.
- [x] (2026-05-20 19:30Z) Added the Chronicle memory keyword index and content-hash dedup foundation. Memory ingest now writes `content_hash`, rebuilds `chronicle_memory_chunks` / `chronicle_memory_keywords`, search ranks through the keyword index, and cross-source canonical duplicate content merges into the existing memory.
- [x] (2026-05-20 20:00Z) Added Chronicle-owned semantic retrieval foundation. Drizzle migration 0026 adds `chronicle_memory_embeddings`; Server writes `chronicle-lexical` deterministic local vectors, blends keyword and semantic scores, and Web displays Keyword/Semantic/Hybrid match badges.
- [x] (2026-05-20 20:30Z) Added Chronicle-owned audio transcript ingest/list contract. Drizzle migration 0027 adds `chronicle_audio_transcripts` and `chronicle_audio_segments`; Server persists transcript evidence before deriving searchable imported memories; Web Settings shows meeting transcripts and audio timeline entries; Rust client has a typed transcript report transport contract.
- [x] (2026-05-20 20:40Z) Completed the review/fix loop for the audio transcript contract. Server now rejects invalid transcript timestamps and reversed ranges, tests cover same-source rebuild semantics, Rust source/status/confidence are typed and locally validated, and the handoff now names the 0025/0026 migration dependency chain.
- [x] (2026-05-20 20:49Z) Added a Rust transcript inbox for externally produced transcript manifests. Daemon scans `CHRONICLE_INBOX_ROOT/audio-transcripts/*.json` in bounded batches, posts valid manifests to `/chronicle/audio-transcripts`, moves successful files to `processed/`, and leaves failed files in place for retry.
- [x] (2026-05-20 21:20Z) Added Rust microphone diagnostics foundation. `cradle-chronicle --audio-diagnostics` records a short default microphone sample through `cpal`, downmixes to mono PCM, applies bounded buffering and RMS activity gating, and writes WAV plus metadata artifacts under the Chronicle storage root.
- [x] (2026-05-20 21:23Z) Re-ran `pnpm exec drizzle-kit generate --config drizzle.config.ts` after the latest Chronicle DB work and confirmed the generated migration chain is clean with `No schema changes, nothing to migrate`.
- [x] (2026-05-20 21:25Z) Fixed the microphone diagnostics review finding: same-second diagnostics now use exclusive creation with timestamp, process id, and sequence suffixes so artifact pairs are not overwritten.
- [x] (2026-05-20 21:40Z) Added opt-in daemon microphone segment capture foundation. Server/Web now expose a Background Audio preference and status, Server restarts the Rust daemon when audio launch options change, and Rust writes microphone segment WAV/metadata artifacts under `audio/segments/` without claiming system audio, VAD, ASR, speaker labeling, transcript, or memory generation readiness.
- [x] (2026-05-20 21:49Z) Completed review/fix for daemon microphone segments. Review found that inherited `CRADLE_CHRONICLE_AUDIO_CAPTURE` could bypass the Server opt-in preference; `daemon-manager` now passes `--no-audio-capture` and forces child `CRADLE_CHRONICLE_AUDIO_CAPTURE=0` when Background Audio is disabled.
- [x] (2026-05-20 22:05Z) Added Slack Events API ingress for Chronicle message sources. Source realtime config is stored in Chronicle-owned `configJson`, bot token and signing secret plaintext stay in `/secrets`, the route verifies Slack raw-body HMAC signatures before parsing, URL verification returns plaintext challenge, channel allowlist and duplicate suppression reuse the normalized message pipeline, and polling/manual sync remain as fallback.
- [x] (2026-05-20 22:06Z) Completed the Slack realtime review loop. Independent review found no blocking issues for raw body signature verification, URL verification, invalid/stale signature rejection, channel allowlist, duplicate suppression, secret-ref persistence, and polling fallback. `drizzle-kit generate` returned `No schema changes, nothing to migrate`.
- [x] (2026-05-20 22:25Z) Added Chronicle raw audio segment evidence registration. Drizzle schema migration 0028 already contains `chronicle_audio_raw_segments`; `drizzle-kit generate` now reports `No schema changes, nothing to migrate`. Server exposes `POST/GET /chronicle/audio-raw-segments`, Rust daemon reports microphone segment WAV/metadata artifacts best-effort after local write, and Web Settings shows recent raw audio segment evidence.
- [x] (2026-05-20 22:28Z) Completed raw audio segment review/fix loop. Independent review found no blocking issues but flagged whitespace `recordedAt` parsing as a Medium issue; `parseTimestamp()` now rejects blank strings before numeric parsing and the Chronicle server test covers `recordedAt: " "` returning 400.
- [x] (2026-05-20 23:25Z) Added Chronicle activity pipeline foundation. Drizzle Kit migration `0030_dazzling_blackheart` adds activity sessions, activity segments, and pipeline runs; Server assigns snapshot, Slack message, raw audio, transcript, and direct memory evidence into activity segments; Web Settings shows Activity Segments and Pipeline Runs. This is collection/segmentation only, not triage, summarization, crystallization, or dream merge.
- [x] (2026-05-21 00:10Z) Added manual Activity Segment triage and summarization. Server now exposes `POST /chronicle/activity-segments/:segmentId/triage` and `POST /chronicle/activity-segments/:segmentId/summarize`, builds segment context from Chronicle evidence refs, calls the configured profile/model, writes triage/summary results into existing Chronicle pipeline columns, creates searchable summary memories with recursive activity assignment disabled, and Web Settings shows Triage/Summarize actions. No DB schema change was needed; `drizzle-kit generate` reports no schema drift. This still does not implement crystallization, knowledge cards, dream merge, or automatic background scheduling.

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
- Observation: Local model resources were only placeholder status rows, so a user could not put VAD/ASR/speaker/embedding models into Chronicle and have the app validate them.
  Evidence: `GET /chronicle/model-resources` previously seeded resource rows but had no install, verify, remove, manifest file checks, checksum handling, or Web controls.
- Observation: Chronicle memory search was still a row scan even after memories became DB-backed.
  Evidence: `apps/server/src/modules/chronicle/service.ts` used SQLite `instr(lower(...))` over `chronicle_memories.content`, `prompt`, and `metadataJson`; there was no Chronicle-owned chunk, keyword, embedding, or FTS table.
- Observation: A semantic retrieval layer can be unblocked before ONNX inference is ready if the vector store contract is owned by Chronicle and the model id is explicit.
  Evidence: `chronicle_memory_embeddings` stores `model_id`, `model_version`, dimensions, vector JSON and vector hash. Current rows use `chronicle-lexical/v1`, not an installed ONNX model.
- Observation: The next safe audio step is a transcript evidence contract, not pretending real local ASR exists.
  Evidence: `chronicle/Cargo.toml` still has no audio capture or Sherpa/ONNX dependency, while Server now accepts `POST /chronicle/audio-transcripts` and Rust has `ChronicleAudioTranscriptReport` for future runtime output.
- Observation: The daemon can safely consume transcript output before local VAD/ASR exists if transcript files use the same typed Server contract.
  Evidence: `chronicle/src/transcript_inbox.rs` reads `audio-transcripts/*.json` as `ChronicleAudioTranscriptReport`, validates locally, posts through `CradleClient::record_audio_transcript()`, moves only successful manifests to `processed/`, and leaves failed manifests for retry.
- Observation: Microphone capture can be validated independently before local VAD/ASR exists.
  Evidence: `chronicle/src/audio/capture.rs` opens the default input device through `cpal`, converts supported sample formats into mono `f32`, and `chronicle/src/audio/wav.rs` writes local diagnostic WAV/metadata artifacts without creating transcript or memory rows.
- Observation: Slack Events API requires an unconsumed request body for signature verification, so the Chronicle route cannot use the normal JSON body parser.
  Evidence: A local Elysia probe showed `request.text()` fails after JSON body parsing with `Body is unusable: Body has already been read`; `/chronicle/message-sources/:sourceId/slack/events` therefore uses `parse: 'none'` and calls `request.text()` before `handleSlackEvents()`.
- Observation: Raw microphone segment artifacts need a DB/API surface before VAD or ASR can be wired safely.
  Evidence: Rust daemon already writes `audio/segments/*.wav` and `.json`, but without `/chronicle/audio-raw-segments` Server/Web cannot show evidence, count recent captures, or provide a durable queue boundary for later VAD/ASR/speaker processing.
- Observation: Activity segment summary/title writes can accidentally change a retry key if the evidence hash includes derived segment fields.
  Evidence: The first duplicate summarize test consumed an extra mocked model call because summarization wrote `segment.summary` and `segment.title`, and the initial evidence hash included text derived from those mutable fields. The fix computes `evidenceHash` only from segment id/time range, normalized source refs, and source evidence row `updatedAt` versions.

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
- Decision: Keep model resource install local-file-first until remote manifests carry strong integrity data.
  Rationale: Downloading arbitrary model URLs from a local server is a security risk and treating downloaded bytes as available without checksum is not a real lifecycle. The Server accepts local file/directory installs immediately, and only allows manifest downloads when every manifest file has `sourceUrl`, `sha256`, and `sizeBytes`.
  Date/Author: 2026-05-20 / Codex.
- Decision: Store Chronicle model resources under the Server data namespace rather than the configurable capture `storageRoot`.
  Rationale: `storageRoot` is for screen/audio artifacts and may be user-selected. Local model lifecycle belongs to Cradle Chronicle, so writes and removals are fixed under `CRADLE_DATA_DIR/chronicle/models` or the default `~/.cradle/chronicle/models`.
  Date/Author: 2026-05-20 / Codex.
- Decision: Build the first memory index as ordinary Chronicle-owned Drizzle tables rather than an FTS5 virtual table.
  Rationale: The immediate unblock is deterministic keyword search, index lifecycle, and content-hash dedup without repeating the orphan migration failure mode. Drizzle Kit can fully generate and track `chronicle_memory_chunks` and `chronicle_memory_keywords`; FTS5 and embedding inference should be added later through an explicitly reviewed migration/runtime design.
  Date/Author: 2026-05-20 / Codex.
- Decision: Keep `content_hash` indexed but not unique.
  Rationale: Hash is a fast candidate selector, not the source of truth. `recordMemory()` compares canonical content before merging so a theoretical hash collision cannot silently collapse two unrelated memories.
  Date/Author: 2026-05-20 / Codex.
- Decision: Add semantic ranking through `chronicle-lexical/v1` before wiring ONNX embedding inference.
  Rationale: The Yansu target needs hybrid memory retrieval. A Chronicle-owned vector table plus deterministic local lexical vectors lets Server prove vector lifecycle, cosine scoring, API shape, UI feedback, migration safety, and fallback behavior now. ONNX embedding runtime can later replace the vector generator without changing the table or search response contract.
  Date/Author: 2026-05-20 / Codex.
- Decision: Make audio transcripts first-class Chronicle evidence before implementing local audio capture, VAD, ASR, or speaker labeling.
  Rationale: Users and later runtimes need a durable contract for meeting transcripts now, but model-resource presence is not runtime readiness. `recordAudioTranscript()` stores transcript rows and segments first, then derives an imported memory for search and timeline visibility.
  Date/Author: 2026-05-20 / Codex.
- Decision: Add a transcript inbox under the existing Chronicle inbox root rather than inventing a second runtime directory or writing into another namespace.
  Rationale: `CHRONICLE_INBOX_ROOT` already represents local ingest input for Chronicle-owned evidence. Keeping transcript manifests under `audio-transcripts/` preserves namespace ownership, gives external producers a stable handoff point, and lets failed posts remain recoverable without deleting local evidence.
  Date/Author: 2026-05-20 / Codex.
- Decision: Introduce microphone diagnostics before attaching audio to daemon memory generation.
  Rationale: Yansu-style audio needs a trustworthy local input path, but VAD, ASR, and speaker labeling are separate runtime/model capabilities. A diagnostics command lets a user verify permissions, device config, PCM conversion, RMS activity detection, and artifact writing without polluting Chronicle memory with non-transcribed audio.
  Date/Author: 2026-05-20 / Codex.
- Decision: Store raw audio segment evidence in its own Chronicle table instead of overloading transcript tables.
  Rationale: A raw WAV segment has capture metadata, activity scores, and processing readiness flags, but no transcript text. Keeping `chronicle_audio_raw_segments` separate from `chronicle_audio_transcripts` avoids implying ASR completion and gives later VAD/ASR/speaker workers a clear queue/evidence boundary.
  Date/Author: 2026-05-20 / Codex.
- Decision: Treat Rust raw segment reporting as best-effort after local artifact write.
  Rationale: Local WAV/metadata files are the recovery source. Server downtime or an ingest failure must not delete microphone evidence or block screen capture; daemon only logs the reporting failure.
  Date/Author: 2026-05-20 / Codex.
- Decision: Implement Activity Segment triage and summarization with existing Chronicle activity/pipeline columns instead of adding new Drizzle tables.
  Rationale: `chronicle_activity_segments.summary` and `metadata_json`, plus `chronicle_pipeline_runs.triage_results_json`, `summary_results_json`, `metadata_json`, and unique `source_key`, already support the behavior. Avoiding an unnecessary migration keeps this slice smaller while preserving Drizzle schema-first discipline. Future crystals or knowledge cards can add new tables only when their ownership and lifecycle are clear.
  Date/Author: 2026-05-21 / Codex.
- Decision: Key manual activity pipeline retries by segment, stage, and source evidence revision rather than by segment alone.
  Rationale: A segment is mutable as new evidence arrives, so `sourceKey` must distinguish different input revisions. The implemented `evidenceHash` uses normalized source refs and source evidence `updatedAt` values, while excluding derived segment summary/title writes so successful summarization does not invalidate its own retry key.
  Date/Author: 2026-05-21 / Codex.

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

Local model resource management now has a real lifecycle:

    GET /chronicle/model-resources
    reads cached DB state

    POST /chronicle/model-resources/reconcile
    checks local files and updates resource rows

    POST /chronicle/model-resources/:category/verify
    verifies one resource's manifest files

    POST /chronicle/model-resources/:category/install
    installs from local files/directories or from strongly verified manifest URLs

    DELETE /chronicle/model-resources/:category
    removes Chronicle-owned files and returns the resource to missing

The Server test now proves `audio-vad` manifest install is no longer rejected by the unverified-manifest safety gate, without relying on a live network download. It also proves corrupt local `silero_vad.onnx` bytes fail checksum verification before promotion and do not create files under capture `storageRoot`.

Validation after the local model resource manager update:

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    passed with "No schema changes, nothing to migrate"

    pnpm --filter @cradle/server exec tsc --noEmit
    passed

    pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
    passed

    pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
    passed

Memory search now has a durable index foundation:

    chronicle_memories.content_hash
    indexed canonical content hash for duplicate candidate lookup

    chronicle_memory_chunks
    Chronicle-owned chunk records with embedding_status = missing until a local embedding runtime exists

    chronicle_memory_keywords
    Chronicle-owned token index across content, prompt, and metadata

`recordMemory()` now rebuilds the chunk/keyword index on insert and update. Different `sourceId` values with the same canonical content merge into the existing memory after comparing canonical content, and a Chronicle memory event records the duplicate merge. `/chronicle/memories/search` now queries the keyword index and ranks by weighted term hits plus phrase containment. This does not claim true semantic embedding deduplication yet.

Validation after the memory keyword index update:

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    generated packages/db/drizzle/0025_lowly_stature.sql and packages/db/drizzle/meta/0025_snapshot.json

    pnpm --filter @cradle/server exec tsc --noEmit
    passed

    pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
    passed

The independent review for this slice found three issues before finalization: upgraded DB rows without index would become unsearchable, memory row writes and index rebuild were not atomic, and updating an existing `sourceId` into duplicate content could leave duplicate rows. These were fixed by adding DB-path-scoped index reconciliation, moving memory row mutation and index rebuild into a single transaction, and merging/deleting the old row on update-into-duplicate. The Chronicle server test now covers legacy backfill and update-into-duplicate.

Semantic retrieval foundation now has a durable vector table and visible match mode:

    chronicle_memory_embeddings
    Chronicle-owned per-chunk vector rows with model id/version, dimensions, vector JSON, vector hash, and status

    chronicle-lexical/v1
    deterministic local lexical vector generator used until ONNX embedding inference exists

`/chronicle/memories/search` now blends keyword score, phrase containment, and semantic cosine score. It no longer exits early when keyword rows are absent, so semantic-only matches can surface. Search response entries include nullable `matchKind`, `keywordScore`, and `semanticScore`; Web Settings shows Keyword, Semantic, or Hybrid badges.

The independent review for this slice found two misleading readiness claims before finalization: the local `embedding` model resource could read as if installing ONNX enables current semantic search, and `chronicle_memory_chunks.embedding_status` was marked `ready` for lexical vectors. These were fixed by describing the model resource as future neural ranking support and leaving chunk `embedding_status = missing` while lexical readiness lives in `chronicle_memory_embeddings.model_id = chronicle-lexical`.

Activity Segment triage and summarization now has a user-facing manual path:

    POST /chronicle/activity-segments/:segmentId/triage
    runs model-backed triage over the segment evidence and records keep/skip metadata

    POST /chronicle/activity-segments/:segmentId/summarize
    reuses or runs triage, generates a structured summary, writes the segment summary, and creates a searchable Chronicle memory

Settings > Chronicle now shows Triage and Summarize buttons on each Activity Segment card, and pipeline run cards show error messages. The implementation addresses the independent ReviewAT risks: config/model failures write error status instead of false success; unchanged retries return existing success/skipped runs without another model call; summary-created memories use `skipActivityAssignment: true`; and evidence hashes are based on source evidence refs/versions rather than derived summary text. This remains a manual interpretation stage and does not complete crystals, dream merge, automatic scheduling, or solve-layer integration.

Validation after the activity triage/summarization update:

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    passed with "No schema changes, nothing to migrate"

    pnpm --filter @cradle/server exec tsc --noEmit
    passed

    pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
    passed

    pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
    passed

Validation after the semantic retrieval foundation update:

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    generated packages/db/drizzle/0026_perfect_korath.sql and packages/db/drizzle/meta/0026_snapshot.json

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    passed with "No schema changes, nothing to migrate"

    pnpm --filter @cradle/server exec tsc --noEmit
    passed

    pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
    passed

    pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
    passed

The remaining limitation is scope, not a hidden broken Chronicle path: audio capture/VAD runtime, local ASR runtime, speaker labeling runtime, ONNX embedding inference, semantic deduplication, and Slack Socket Mode are not yet implemented. Slack is currently background polling over `conversations.history`. The first directly usable local path is screen capture with macOS Vision OCR plus remote-model summary generation through configured Cradle profiles, with DB-backed hybrid memory retrieval.

Audio transcript evidence now has a first-class path:

    chronicle_audio_transcripts
    Chronicle-owned transcript session rows with source, status, timing, title, language, app/window, artifact paths, and derived memory id

    chronicle_audio_segments
    Ordered transcript segments with timing, text, optional speaker label, confidence, language, and metadata

    POST /chronicle/audio-transcripts
    persists transcript evidence and segments, then creates or updates an imported searchable memory

    GET /chronicle/audio-transcripts
    returns recent transcript evidence for Settings > Chronicle

Settings > Chronicle now shows transcript counts in Runtime Status, a Meeting Transcripts section, and audio entries in the mixed timeline. Rust `ChronicleAudioTranscriptReport` and `record_audio_transcript()` define the transport contract for a future runtime. This is not a claim that local audio capture, Silero VAD, SenseVoice ASR, or speaker embedding inference is implemented.

Validation after the audio transcript contract update:

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    generated packages/db/drizzle/0027_dazzling_vance_astro.sql and packages/db/drizzle/meta/0027_snapshot.json

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    passed with "No schema changes, nothing to migrate"

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

The independent review for this slice found four issues before finalization: transcript timestamps could silently fall back to receipt time, reversed transcript/segment ranges were accepted, the synthesis handoff did not name its dependency on the prior 0025/0026 Chronicle memory-index migrations, Rust transport used unbounded strings/confidence for Server enum/range fields, and same-source transcript rebuild behavior was untested. These were fixed by adding Server-side 400 validation, extending the Chronicle server test with invalid chronology and idempotent rebuild cases, adding Rust enum/newtype validation, and correcting the handoff boundary.

Rust transcript inbox now gives future local or external audio runtimes a recoverable handoff:

    CHRONICLE_INBOX_ROOT/audio-transcripts/*.json
    typed transcript manifests using the `ChronicleAudioTranscriptReport` camelCase contract

    CHRONICLE_INBOX_ROOT/audio-transcripts/processed/
    successful manifests after Server ingest returns OK

Daemon run-once and long-running loop both call the bounded `process_transcript_inbox_tick()` path. Successful manifests are posted to `/chronicle/audio-transcripts` and moved to `processed/`; parse failures, validation failures, transport failures, and Server rejection leave the original file in place for retry. The inbox is intentionally transport-only and does not add microphone capture, system audio capture, VAD, ASR, or speaker labeling runtime.

Validation after the Rust transcript inbox update:

    cargo fmt --manifest-path chronicle/Cargo.toml
    passed

    cargo test --manifest-path chronicle/Cargo.toml
    passed, 47 unit tests plus 1 smoke test

    cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
    passed

The independent review for this slice found three issues before finalization: failed transcript manifests could repeatedly delay capture because every daemon loop retried the whole backlog, Rust manifest deserialization was stricter than the Server optional/default contract, and tests did not cover reachable Server rejection. These were fixed by adding a bounded daemon inbox tick, applying Server-equivalent defaults during Rust deserialization, and adding tests for optional defaults, 400/500 Server rejection preservation, and per-tick failure limits.

Rust microphone diagnostics now has a real local input path:

    cradle-chronicle --audio-diagnostics
    records a short default microphone sample through CPAL

    <storage_root>/audio/diagnostics/<timestamp>-<pid>-<sequence>-microphone-diagnostic.wav
    normalized mono 16-bit WAV artifact

    <storage_root>/audio/diagnostics/<timestamp>-<pid>-<sequence>-microphone-diagnostic.json
    device/sample/RMS/peak/activity metadata with explicit VAD/ASR/speaker runtime flags set to false

The audio module includes a bounded PCM buffer, supported sample-format conversion into mono `f32`, an RMS activity gate, and a WAV artifact writer. This is deliberately not connected to transcript ingestion or memory generation yet. It verifies microphone permission/device/runtime plumbing and gives the next VAD/ASR slice a real local audio input foundation.

The independent review for this slice found that timestamp-only artifact names could overwrite same-second diagnostics. The fix reserves files with `OpenOptions::create_new(true)` and names artifacts with timestamp, process id, and sequence suffixes. A focused Rust test now writes two diagnostics with the same timestamp and verifies both WAV/metadata pairs remain present.

Validation after the microphone diagnostics update:

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    passed with "No schema changes, nothing to migrate"

    cargo fmt --manifest-path chronicle/Cargo.toml
    passed

    cargo test --manifest-path chronicle/Cargo.toml
    passed, 54 unit tests plus 1 smoke test

    cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
    passed

Daemon microphone segment capture now has a user-facing opt-in path:

    Settings > Chronicle > Background Audio
    toggles Server preference `audioCaptureEnabled`

    Daemon launch options
    `--audio-capture --audio-segment-ms <ms> --audio-segment-interval-ms <ms> --audio-rms-threshold <value>`

    <storage_root>/audio/segments/<timestamp>-<pid>-<sequence>-microphone-segment.wav
    normalized mono 16-bit microphone segment artifact

    <storage_root>/audio/segments/<timestamp>-<pid>-<sequence>-microphone-segment.json
    device/sample/RMS/peak/activity metadata with explicit VAD/ASR/speaker runtime flags set to false

This is deliberately a microphone artifact foundation, not full Yansu background audio transcription. It does not capture system audio through ScreenCaptureKit, does not run Silero VAD, does not run SenseVoice/Sherpa ASR, does not label speakers, and does not create transcript or memory rows from raw audio. It gives the next audio runtime slice a repeatable daemon-owned input path and gives the user a visible opt-in control instead of a hidden CLI-only capability.

The independent review for this slice found one blocker before finalization: Rust also reads `CRADLE_CHRONICLE_AUDIO_CAPTURE`, so a parent process environment could bypass a disabled Server preference if Server only omitted `--audio-capture`. This was fixed by explicitly passing `--no-audio-capture`, setting the child env to `CRADLE_CHRONICLE_AUDIO_CAPTURE=0` when disabled, and adding `chronicle-daemon-manager.test.ts`.

Validation after the daemon microphone segment update:

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    passed with "No schema changes, nothing to migrate"

    cargo fmt --manifest-path chronicle/Cargo.toml
    passed

    cargo test --manifest-path chronicle/Cargo.toml
    passed, 57 unit tests plus 1 smoke test

    cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
    passed

    pnpm --filter @cradle/server exec tsc --noEmit
    passed

    pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
    passed

    pnpm --filter @cradle/server exec vitest run tests/chronicle-daemon-manager.test.ts tests/chronicle.test.ts
    passed

    pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
    passed

    pnpm --filter @cradle/web exec tsc --noEmit
    failed only in existing unrelated src/features/chat/use-chat-session-binding.test.tsx tuple/call-signature errors; Chronicle files no longer report type errors.

Raw audio segment evidence now has a durable DB/API/UI path:

    chronicle_audio_raw_segments
    Chronicle-owned rows for raw microphone/system/mixed segment evidence, artifact paths, sample stats, RMS/peak activity scores, and VAD/ASR/speaker processing status

    POST /chronicle/audio-raw-segments
    upserts a raw segment report by `sourceId`, validates `recordedAt`, normalizes artifact paths relative to Chronicle storage root, stores RMS/peak as basis points, and records a Chronicle audio event

    GET /chronicle/audio-raw-segments
    returns recent raw audio evidence for Settings > Chronicle

    Rust daemon
    writes microphone segment WAV/metadata locally first, then best-effort reports a `ChronicleAudioRawSegmentReport` to Server

Settings > Chronicle now shows raw segment count and recent time in Runtime Status and adds an Audio Segments section listing active/quiet state, RMS/peak, duration, sample stats, artifact paths, and VAD/ASR/Speaker status. This remains raw evidence only: it does not create transcript rows or memories and does not claim local VAD, ASR, speaker labeling, or system audio capture is implemented.

Validation after the raw audio segment evidence update:

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    passed with "No schema changes, nothing to migrate"

    pnpm --filter @cradle/server exec tsc --noEmit
    passed

    pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
    passed

    pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
    passed

    cargo fmt --manifest-path chronicle/Cargo.toml -- --check
    passed

    cargo test --manifest-path chronicle/Cargo.toml cradle_client --lib
    passed, including raw audio segment serialization and validation tests

Independent raw segment review found no blocking findings. The one Medium issue, blank `recordedAt` parsing to Unix epoch `0`, was fixed by trimming and rejecting empty timestamps in `parseTimestamp()`. Follow-up validation after that fix:

    pnpm --filter @cradle/server exec tsc --noEmit
    passed

    pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
    passed

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    passed with "No schema changes, nothing to migrate"

    pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
    passed

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
    record_audio_transcript(transcript)

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

Revision note 2026-05-20 19:15Z: Added Chronicle-owned local model resource manager. Resource state can now be reconciled, verified, installed from local files/directories, and removed through Server routes and Web controls. The model root is fixed to the Chronicle data namespace. Remote manifest install is intentionally blocked until manifest entries carry strong checksum and size metadata.

Revision note 2026-05-20 19:30Z: Added Chronicle-owned memory index tables and content-hash dedup foundation through Drizzle Kit migration `0025_lowly_stature`. Search now reads the keyword index rather than scanning `chronicle_memories`, and same canonical content from different sources merges into the original memory. Embedding inference, semantic cosine ranking, and FTS5 remain separate future slices.

Revision note 2026-05-20 19:45Z: Completed the review/fix loop for the memory index slice. Fixed upgraded-database backfill, transactional memory/index writes, and update-into-duplicate behavior; recorded the synthesis handoff in `docs/multi-work/yansu-style-chronicle/20260521-memory-index-dedup-SynthesisJ.md`.

Revision note 2026-05-20 20:00Z: Added semantic retrieval foundation. Drizzle migration `0026_perfect_korath` adds `chronicle_memory_embeddings`; Server writes `chronicle-lexical/v1` vectors and blends keyword plus semantic scores; Web displays match badges. This is not the ONNX embedding runtime.

Revision note 2026-05-20 20:05Z: Completed the review/fix loop for the semantic retrieval foundation. Corrected embedding resource messaging and chunk embedding status so lexical vector readiness cannot be confused with installed ONNX embedding runtime readiness.

Revision note 2026-05-20 20:30Z: Added audio transcript evidence contract through Drizzle Kit migration `0027_dazzling_vance_astro`, Server routes, Web transcript/timeline UI, Rust transport structs, and focused validation. Real audio capture, VAD, ASR, and speaker labeling remain explicit future runtime work.

Revision note 2026-05-20 20:40Z: Completed the audio transcript review/fix loop. Tightened Server validation for timestamp and segment chronology, added same-source rebuild coverage, strengthened Rust transcript transport typing, and corrected the migration-chain handoff language.

Revision note 2026-05-20 20:49Z: Added Rust transcript inbox processing. External or future local transcript producers can write typed JSON manifests to `CHRONICLE_INBOX_ROOT/audio-transcripts/`; daemon posts them to Server in bounded batches, moves successful manifests to `processed/`, keeps failed manifests available for retry, and accepts the same optional/default fields as Server ingest.

Revision note 2026-05-20 21:20Z: Added Rust microphone diagnostics foundation. The new `audio/` module records short default microphone diagnostics through CPAL, writes Chronicle-owned WAV and metadata artifacts under `audio/diagnostics/`, and validates bounded PCM buffering plus RMS activity detection without claiming VAD, ASR, or speaker labeling runtime readiness.

Revision note 2026-05-20 21:25Z: Corrected the microphone diagnostics artifact identity after review. Artifact paths now include timestamp, process id, and sequence suffixes and are created exclusively; same-second diagnostics cannot silently overwrite earlier WAV/metadata output. Also re-ran Drizzle Kit and confirmed the current Chronicle schema has no pending migration drift.

Revision note 2026-05-20 21:40Z: Added the daemon microphone segment foundation. Background Audio is now an explicit Server/Web preference that restarts the Rust daemon with audio launch options; Rust writes microphone segment artifacts under `audio/segments/` and keeps metadata honest about missing VAD, ASR, and speaker labeling runtime.

Revision note 2026-05-20 21:49Z: Completed daemon microphone segment review/fix. The disabled launch path now actively negates audio capture through both CLI and environment so inherited `CRADLE_CHRONICLE_AUDIO_CAPTURE` cannot bypass the explicit Background Audio preference.

Revision note 2026-05-20 22:45Z: Added Chronicle accessibility evidence as a Drizzle schema-first slice. `packages/db/src/schema/chronicle.ts` now owns `chronicle_accessibility_snapshots`; `pnpm exec drizzle-kit generate --config drizzle.config.ts` produced the migration chain earlier and now reports no schema drift. Rust writes window-inventory accessibility artifacts and reports them with screen snapshots; Server upserts them by accessibility source id; Web shows status/provider/window text and permission-denied state. This is not yet full AXObserver deep tree polling.

Revision note 2026-05-20 23:00Z: Upgraded accessibility runtime from window inventory only to macOS AX tree polling. Rust now checks Accessibility permission, tries to read the frontmost app focused/main/focused UI element tree through `AXUIElementCopyAttributeValue`, serializes role/title/value/depth/path nodes into the existing Chronicle accessibility evidence contract, and falls back to window inventory if AX tree reads fail. This still is not the long-running AXObserver notification lifecycle.

Revision note 2026-05-20 23:25Z: Added the first Activity Pipeline foundation. `packages/db/src/schema/chronicle.ts` now owns `chronicle_activity_sessions`, `chronicle_activity_segments`, and `chronicle_pipeline_runs`; `pnpm exec drizzle-kit generate --config drizzle.config.ts` produced `0030_dazzling_blackheart.sql` and `meta/0030_snapshot.json`. Server writes activity segments and pipeline runs from canonical ingest paths, exposes `/chronicle/activity-segments` and `/chronicle/pipeline-runs`, and status includes activity/pipeline totals. Review found duplicate pipeline runs and out-of-order segment merging risks; the fix adds a unique pipeline `sourceKey`, records current segmentation runs as `running` with downstream stages pending, and prevents older evidence from merging into a later segment. Web Settings shows grouped activity windows and recent pipeline runs between Timeline and Memories. Validation passed for Drizzle generation, server typecheck, Chronicle server tests, and focused Chronicle Web ESLint. Remaining Yansu work still includes triage, segment summarization, crystallization, AXObserver lifecycle, system audio, real VAD/ASR/speaker runtimes, ONNX embeddings, and solve-layer integration.

Revision note 2026-05-21 00:10Z: Added manual Activity Segment triage and summarization without a DB migration. Server now builds segment context from existing evidence refs, uses the configured Chronicle profile/model for triage and summary, records idempotent pipeline runs with evidence-hash source keys, and writes summary memories without recursive activity assignment. Web Settings now exposes Triage and Summarize actions per segment. Validation passed for Drizzle no-drift, server typecheck, Chronicle server tests, and focused Chronicle Web ESLint. Remaining Yansu work still includes crystallization, knowledge cards, dream merge, automatic pipeline scheduling, AXObserver lifecycle, system audio, real VAD/ASR/speaker runtimes, ONNX embeddings, and solve-layer integration.

Revision note 2026-05-21 00:40Z: Added Chronicle-owned knowledge crystallization and dream merge dry-run foundation. Drizzle Kit generated `0031_shallow_captain_midlands`, `0032_powerful_talos`, and `0033_next_vector` for knowledge cards, versions, source links, dream runs, dream candidates, and stable knowledge keys. Server now exposes `POST /chronicle/activity-segments/:segmentId/crystallize`, `GET /chronicle/knowledge-cards`, `GET /chronicle/knowledge-cards/:knowledgeId/versions`, `GET /chronicle/dream-runs`, and `POST /chronicle/dream-runs`. Crystallization validates model JSON into typed cards, writes cards/versions/source links in one transaction after model success, uses evidence-hash pipeline idempotency, and avoids duplicate versions on unchanged retry. Dream run defaults to lexical dry-run candidate recording with `chronicle-lexical/v1` and does not mutate knowledge unless explicitly requested. Web Settings now shows Crystallize, Knowledge Cards, and Dream Merge Dry Run sections. Remaining Yansu work still includes automatic pipeline scheduling, AXObserver notification lifecycle, system audio capture, real VAD/ASR/speaker runtimes, ONNX embeddings, semantic merge thresholds, and solve-layer integration.

Revision note 2026-05-21 01:05Z: Added automatic Activity Pipeline scheduling. Server config/status now expose `activityPipelineEnabled`, `activityPipelineIntervalMs`, and `activityPipelineBatchSize`; startup/config updates restart a Chronicle-owned scheduler; shutdown stops it. `POST /chronicle/activity-pipeline/tick` runs the same progression manually and advances the oldest eligible uncrystallized segment by one behavior step: collecting/error to triage, triaged to summarization, summarized to crystallization. Web Settings now exposes the scheduler toggle, status text, and manual Tick control. Tests prove collecting to triaged, triaged to summarized, summarized to crystallized, and disabled scheduler no-op behavior. Remaining Yansu work still includes AXObserver notification lifecycle, system audio capture, real VAD/ASR/speaker runtimes, ONNX embeddings, semantic merge thresholds, and solve-layer integration.

Revision note 2026-05-21 01:35Z: Added Rust/macOS AXObserver notification lifecycle foundation. `chronicle/src/screen/macos.rs` now owns an `AxObserverRuntime` that creates `AXObserver`, subscribes focused/window/value/title notifications, attaches the observer source to a dedicated run loop, drains a bounded event queue, and stops the thread/run loop on drop. `chronicle/src/daemon.rs` starts the observer for the frontmost app, rebuilds it when the frontmost target changes, and turns notification events into `macos-ax-observer` accessibility evidence by triggering the existing snapshot artifact/report path. The queue is bounded and records dropped-event backpressure in evidence. This removes the polling-only blocker, while deeper standalone AX event DB tables can still be split out later if the UI needs event history independent from snapshots. Remaining Yansu work still includes system audio capture, real VAD/ASR/speaker runtimes, ONNX embeddings, semantic merge thresholds, automatic dream scheduling, and solve-layer integration.

Revision note 2026-05-21 02:10Z: Unblocked the `audio-vad` local model resource manifest path. The built-in Silero VAD manifest now carries verified `sourceUrl`, `sha256`, and `sizeBytes`; Server remote install reaches the download path instead of the old unverified-manifest rejection, retries primary plus fallback URLs, removes partial downloads between attempts, and still verifies checksum/size before promotion into `CRADLE_DATA_DIR/chronicle/models` or `~/.cradle/chronicle/models`. Web Settings now shows a `Download` action only for manifest-backed resources whose files all carry strong integrity metadata, while local file install remains available for the same expected bytes. Validation passed for Drizzle no-drift, server typecheck, Chronicle server tests, focused Chronicle Web ESLint, and `git diff --check`; Web full TypeScript still fails only on the pre-existing `src/features/chat/use-chat-session-binding.test.tsx` tuple/call-signature errors. Remaining Yansu work still includes system audio capture, real Rust VAD inference over audio segments, SenseVoice/Sherpa ASR runtime, speaker embedding, ONNX embeddings, semantic merge thresholds, automatic dream scheduling, and solve-layer integration.
