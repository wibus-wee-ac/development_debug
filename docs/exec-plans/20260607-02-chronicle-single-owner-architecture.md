# Make Chronicle a Server-Owned Memory System With a Rust Evidence Runtime

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained so a contributor can resume the refactor with only this file and the repository checkout.

## Purpose / Big Picture

Chronicle has drifted into a two-core architecture: Rust documentation and code describe Rust as the memory core, while the Cradle Server and database already own the UI, API, search, chat context, activity pipeline, knowledge cards, privacy export, and generated CLI surface. After this change, Chronicle has one product semantic owner. Cradle Server and the `chronicle_*` database tables own memory, activity, knowledge, search, privacy projections, and agent context. The Rust `cradle-chronicle` binary owns local capture, audio capture, local model diagnostics, local inference, artifact writing, and durable evidence delivery.

The observable behavior is that `cradle-chronicle --smoke` no longer creates local memory summaries or a memory manifest. It writes frame, capture, OCR, and snapshot artifacts, records evidence events in a local outbox, and can run when `CRADLE_URL` points at an unavailable Server without losing local evidence. Server documentation describes the database as canonical state, and Rust documentation describes its local files as artifacts/outbox/debug state rather than the canonical memory core.

## Progress

- [x] (2026-06-07 21:57 CST) Created this ExecPlan after confirming the current code has Rust memory summary/pipeline behavior and Server DB memory/search/knowledge behavior.
- [x] (2026-06-07 22:03 CST) Refactored Rust local store into `ChronicleOutbox`, writing `outbox/events.ndjson` instead of root-level local memory state.
- [x] (2026-06-07 22:07 CST) Removed Rust memory summary, activity pipeline, crystallization, dream, search, cron, capability, and child-process summary modules from default compiled/runtime paths.
- [x] (2026-06-07 22:09 CST) Changed `cradle-chronicle --smoke` to prove artifact plus outbox behavior instead of memory generation.
- [x] (2026-06-07 22:12 CST) Changed daemon loop to record and best-effort deliver snapshot, accessibility, raw audio, transcript, processing-result, and speaker-profile evidence events, without local memory generation or local knowledge maintenance.
- [x] (2026-06-07 22:15 CST) Aligned Chronicle Rust and Server docs with Server/DB as canonical product state and Rust as evidence runtime.
- [x] (2026-06-07 22:19 CST) Ran focused Rust and Server validation and recorded results in this plan.
- [x] (2026-06-07 22:21 CST) Re-ran a focused source search for old Rust memory-core symbols; remaining hits are only the smoke assertion that `memory-manifest.json` is absent and Rust docs explicitly saying it is no longer generated.
- [x] (2026-06-07 22:23 CST) Re-ran final validation after plan updates: Chronicle tests, Server typecheck, explicit offline smoke, and clippy all passed.

## Surprises & Discoveries

- Observation: Rust `daemon.rs` still runs local summary, local pipeline, and dream maintenance during daemon operation.
  Evidence: `chronicle/src/daemon.rs` imports `RecursiveSummarizer`, `LocalSummaryWriter`, `Pipeline`, and `DreamEngine`, calls `run_summary`, `process_pipeline`, and dream cron branches.

- Observation: The binary smoke test currently enforces the old architecture.
  Evidence: `chronicle/tests/smoke.rs` asserts `root.join("memories").exists()`, exactly one memory file, and `memory-manifest.json`.

- Observation: Server has the product surface that agents and users actually consume.
  Evidence: `apps/server/src/modules/chat-runtime/service.ts` calls `buildAgentMemoryContext`; `apps/server/src/modules/chronicle/index.ts` exposes Chronicle memory, activity, knowledge, event, privacy, and model-resource routes; `packages/db/src/schema/chronicle.ts` defines the canonical `chronicle_*` tables.

- Observation: The Rust crate had existing clippy warnings outside the ownership refactor once the old modules were removed from the compile graph.
  Evidence: `cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings` exposed warnings in `chronicle/src/audio/screen_capture_kit_audio.rs` and `chronicle/src/onnx/*`; those files were adjusted so clippy now passes.

- Observation: The Server typecheck still passed despite a very dirty repository with many unrelated worktree changes.
  Evidence: `pnpm typecheck:server` completed successfully after the Chronicle README/server ownership update.

- Observation: The final source search confirms old Rust memory-core runtime symbols are gone from `chronicle/src` and `chronicle/tests`.
  Evidence: `rg -n "ChronicleCore|memory-manifest|run_summary|process_pipeline|DreamEngine|RecursiveSummarizer|LocalSummaryWriter|pub mod (capabilities|core|crystallizer|dream|memory_pipeline|pipeline|search|triage|cron)|cradle_chronicle::(capabilities|core|memory_pipeline|pipeline|dream|search|triage|crystallizer|codex_exec|cron)" chronicle/src chronicle/tests --glob '!chronicle/target/**'` now only reports `chronicle/tests/smoke.rs` asserting no `memory-manifest.json` exists and `chronicle/src/README.md` stating Rust no longer generates it.

## Decision Log

- Decision: Server/DB owns Chronicle product semantics.
  Rationale: Settings, API/CLI, chat turn context, memory search/edit/delete, activity segments, knowledge cards, dream maintenance, privacy export, and schema migrations are Cradle product concerns. They need one canonical source, and the existing product surface already reads Server DB.
  Date/Author: 2026-06-07 / Codex.

- Decision: Rust owns capture/runtime evidence and a durable outbox, not memory or knowledge lifecycle.
  Rationale: Rust is the right place for macOS capture, audio capture, Accessibility, OCR/ASR/VAD/speaker embedding, local model diagnostics, and artifact writing. It should produce evidence and retry delivery, while Server decides what becomes memory or knowledge.
  Date/Author: 2026-06-07 / Codex.

- Decision: Remove memory generation from Rust default and smoke paths instead of keeping compatibility code.
  Rationale: Keeping local memory summaries as a fallback preserves the wrong ownership boundary. Offline safety should come from outbox events and artifacts, not from a second memory system.
  Date/Author: 2026-06-07 / Codex.

- Decision: Delete the Rust memory/knowledge modules instead of hiding them behind disabled exports.
  Rationale: The project is pre-release and the user explicitly requested the best architecture, not compatibility shims. Leaving dead modules in the tree would invite future code to depend on a second Chronicle core.
  Date/Author: 2026-06-07 / Codex.

- Decision: Keep Rust best-effort delivery narrow and route-based.
  Rationale: Rust can POST evidence events whose shape already matches Server-owned ingest concepts, but it should not decide activity segmentation, memory creation, knowledge crystallization, or privacy projections. Unknown diagnostic events remain local outbox-only.
  Date/Author: 2026-06-07 / Codex.

## Outcomes & Retrospective

The refactor is complete. Rust Chronicle is now a narrower evidence runtime. It captures screen/audio/accessibility evidence, writes artifacts, appends local outbox records, runs local ONNX diagnostics/inference where needed, and attempts best-effort delivery to Server ingest routes. It no longer contains the default Rust memory summary, memory manifest, activity pipeline, crystallization, dream, search, cron, capability, or child-process summary core.

Server/DB is the single Chronicle product owner. The Server module README states that `chronicle_*` tables own config, ingest, activity segmentation, memory/search, knowledge, privacy projection, agent context, CLI/API, and Web UI. Rust local files are explicitly artifacts, debug state, and outbox evidence.

Validation passed:

    cargo fmt --manifest-path chronicle/Cargo.toml
    cargo test --manifest-path chronicle/Cargo.toml
    CRADLE_URL=http://127.0.0.1:1 cargo run --manifest-path chronicle/Cargo.toml -- --smoke --storage-root /tmp/cradle-chronicle-evidence-smoke --capture-limit 2
    pnpm typecheck:server
    cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings

The smoke command succeeded with Server unavailable and reported:

    cradle chronicle smoke completed: observed=2 persisted=2 delivered=0 duplicates=0 privacy_filtered=0 outbox=/tmp/cradle-chronicle-evidence-smoke/outbox/events.ndjson

The final rerun used `/tmp/cradle-chronicle-evidence-smoke-final` and produced the same shape:

    cradle chronicle smoke completed: observed=2 persisted=2 delivered=0 duplicates=0 privacy_filtered=0 outbox=/tmp/cradle-chronicle-evidence-smoke-final/outbox/events.ndjson

The main lesson is that Chronicle had grown two owners for the same semantic layer. The clean fix was not to bridge them. The correct boundary is Server as product memory system and Rust as evidence producer.

## Context and Orientation

The repository root is `/Users/wibus/dev/Cradle`. The Rust Chronicle crate lives under `chronicle/`. Its binary entry point is `chronicle/src/main.rs`; its long-running capture loop is `chronicle/src/daemon.rs`; capture artifact logic is under `chronicle/src/recorder/`; screen capture providers are under `chronicle/src/screen/`; audio and local ONNX helpers are under `chronicle/src/audio/` and `chronicle/src/onnx/`.

In this plan, an artifact is a file written by Rust under the Chronicle storage root, such as `frame-00001.jpg`, `capture-00001.json`, `ocr-00001.json`, `snapshot.json`, audio WAV files, or audio metadata. An outbox is a durable local queue of evidence events that Rust has observed and can deliver to Server ingest routes. Canonical state means the source of truth used by UI, API, CLI, chat runtime, and future migrations; after this refactor canonical Chronicle state is the Server database tables named `chronicle_*`.

The Server Chronicle module lives under `apps/server/src/modules/chronicle/`. `index.ts` defines HTTP routes. `model.ts` defines TypeBox request/response contracts. `service.ts` owns DB-backed behavior. `README.md` describes the module. Chat runtime reads Chronicle memory context through `apps/server/src/modules/chronicle/agent-context.ts` from `apps/server/src/modules/chat-runtime/service.ts`.

## Plan of Work

First, create an explicit Rust outbox boundary. The existing `chronicle/src/store/mod.rs` writes `events.ndjson` and `memory-manifest.json`. Change this module so it represents an evidence outbox and no longer records memory manifests. Its append-only event file remains useful for offline recovery and diagnostics, but its documentation and types must say outbox/evidence rather than local memory index.

Second, remove Rust memory/knowledge semantics from default compiled and runtime paths. Update `chronicle/src/lib.rs`, `chronicle/src/main.rs`, and `chronicle/src/daemon.rs` so `core`, `capabilities`, `memory_pipeline`, `pipeline`, `crystallizer`, `dream`, `search`, `cron`, `codex_exec`, and `triage` are no longer part of the default public library path or daemon loop. Keep capture, recorder, audio, ONNX, models, privacy, Slack normalization, meeting detection, and timestamp helpers.

Third, change smoke behavior. `run_smoke` should capture synthetic frames, write artifacts, append outbox events for each snapshot and a smoke completion event, and return output that names the outbox file rather than a memory file. The smoke test should verify artifacts and `outbox/events.ndjson`, and should no longer require `memories/` or `memory-manifest.json`.

Fourth, change daemon behavior. The daemon should record snapshot, accessibility, message, transcript, raw audio, audio processing, and speaker-profile evidence events into the outbox. It may attempt best-effort delivery to Server ingest endpoints later in this plan if the route mapping remains narrow and safe. It must not summarize frames, run local activity pipeline, create local memory chunks, crystallize knowledge, or dream-merge memory.

Fifth, align docs. Update `chronicle/README.md`, `chronicle/src/README.md`, `chronicle/src/store/README.md`, `chronicle/tests/README.md`, and `apps/server/src/modules/chronicle/README.md` so they describe the single-owner boundary. Delete the old Rust memory pipeline docs along with the old Rust memory pipeline modules. Rust local-only diagnostics remain valid, but Rust local memory core language must be removed.

## Concrete Steps

Work from `/Users/wibus/dev/Cradle`.

Run a baseline search when resuming:

    rg -n "ChronicleCore|memory-manifest|run_summary|process_pipeline|DreamEngine|RecursiveSummarizer|LocalSummaryWriter" chronicle/src chronicle/tests

After the Rust refactor, the default runtime files `chronicle/src/main.rs`, `chronicle/src/daemon.rs`, and `chronicle/tests/smoke.rs` should not contain those old memory-core symbols except in comments that explicitly describe removed behavior.

Run focused validation:

    cargo fmt --manifest-path chronicle/Cargo.toml
    cargo test --manifest-path chronicle/Cargo.toml
    CRADLE_URL=http://127.0.0.1:1 cargo run --manifest-path chronicle/Cargo.toml -- --smoke --storage-root /tmp/cradle-chronicle-evidence-smoke --capture-limit 2

Expected smoke output should include `cradle chronicle smoke completed` and mention an outbox path. The storage root should contain display artifacts and `outbox/events.ndjson`, and should not need `memories/` or `memory-manifest.json`.

Actual smoke validation output after implementation:

    cradle chronicle smoke completed: observed=2 persisted=2 delivered=0 duplicates=0 privacy_filtered=0 outbox=/tmp/cradle-chronicle-evidence-smoke/outbox/events.ndjson

Run focused Server validation after doc/service changes:

    pnpm typecheck:server

If full Server typecheck is blocked by unrelated dirty work, record the blocking files and run a narrower command that typechecks or tests the changed Chronicle module where available.

## Validation and Acceptance

Acceptance requires these observable behaviors:

1. `cargo test --manifest-path chronicle/Cargo.toml` passes.
2. `CRADLE_URL=http://127.0.0.1:1 cargo run --manifest-path chronicle/Cargo.toml -- --smoke --storage-root /tmp/cradle-chronicle-evidence-smoke --capture-limit 2` succeeds.
3. The smoke storage root contains `frame-00001.jpg`, `capture-00001.json`, `ocr-00001.json`, `snapshot.json`, and `outbox/events.ndjson`.
4. The smoke path no longer creates or requires a local memory summary or `memory-manifest.json`.
5. The daemon code no longer imports or calls Rust memory summary, local activity pipeline, crystallization, dream maintenance, or search index behavior.
6. Documentation states that Server DB is canonical Chronicle product state and Rust local files are artifacts/outbox/debug state.

## Idempotence and Recovery

The refactor should be safe to repeat. Temporary smoke directories under `/tmp/cradle-chronicle-*` can be removed and recreated. Do not delete user storage roots such as `~/.cradle/chronicle`. If tests fail after removing compiled modules from `chronicle/src/lib.rs`, inspect whether a remaining default path still imports a removed memory module. Prefer moving behavior toward the outbox boundary rather than restoring local memory compatibility.

Because the worktree may contain unrelated user changes, do not run destructive git commands. If unrelated files fail typecheck, record them and continue with focused validation for changed files.

## Artifacts and Notes

Initial evidence before implementation:

    chronicle/src/daemon.rs imports RecursiveSummarizer, LocalSummaryWriter, Pipeline, DreamEngine.
    chronicle/tests/smoke.rs requires memories/ and memory-manifest.json.
    apps/server/src/modules/chronicle/README.md says canonical UI source is Cradle DB.

Final evidence after implementation:

    chronicle/src/lib.rs exports evidence runtime modules only.
    chronicle/src/store/mod.rs defines ChronicleOutbox and ChronicleOutboxEvent.
    chronicle/src/main.rs smoke path reports outbox=/tmp/.../outbox/events.ndjson.
    chronicle/tests/smoke.rs asserts memory-manifest.json is absent.
    apps/server/src/modules/chronicle/README.md says Server and chronicle_* DB tables are canonical source.

Revision note 2026-06-07: Initial plan created to support the user-requested goal of moving Chronicle to the best single-owner architecture.

Revision note 2026-06-07 22:21 CST: Updated the living plan after implementation to mark all work complete, record validation results, and capture the final ownership boundary.

Revision note 2026-06-07 22:23 CST: Added final post-update validation evidence so the plan reflects the completed stopping point.

## Interfaces and Dependencies

In `chronicle/src/store/mod.rs`, expose an evidence outbox type with a small API:

    pub struct ChronicleOutbox { ... }
    impl ChronicleOutbox {
        pub fn new(root: impl AsRef<Path>) -> Self;
        pub fn events_path(&self) -> PathBuf;
        pub fn append_event(&self, event: &ChronicleOutboxEvent) -> ChronicleResult<()>;
    }

The event payload should remain `serde_json::Value` so Rust can record evidence from different producers without owning Server semantics. Event `kind` values should match Server-owned ingest concepts such as `snapshot`, `accessibility-event`, `audio-raw-segment`, `audio-transcript`, `audio-raw-processing-result`, `speaker-profile`, and `message`.

Server remains the owner of route schemas in `apps/server/src/modules/chronicle/model.ts`, route metadata in `apps/server/src/modules/chronicle/index.ts`, and DB behavior in `apps/server/src/modules/chronicle/service.ts`. Generated CLI files must not be edited manually.
