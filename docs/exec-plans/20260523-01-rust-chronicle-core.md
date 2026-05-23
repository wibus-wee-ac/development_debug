# Make Rust Chronicle the Standalone Memory Core

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. The non-negotiable rules are: the plan must be self-contained, must describe observable behavior rather than only internal edits, must be updated as work proceeds, must define repository terms in plain language, and must include concrete commands, expected results, recovery steps, and all important decisions.

## Purpose / Big Picture

Cradle Chronicle should be a Rust-owned memory engine, not a Cradle Server feature implemented in TypeScript. After this work, a developer can run `cradle-chronicle` by itself, capture or ingest local evidence, produce Chronicle memory files and searchable local state, and inspect what happened without starting `apps/server`. Server integration remains possible, but only as an optional capability provider or consumer; it is not the owner of Chronicle semantics.

The visible outcome is a Rust binary that can run a smoke pipeline and a daemon run-once pipeline with no reachable Server, while still writing canonical Chronicle artifacts, memory summaries, event logs, and index state under the chosen storage root. A future UI or Server can read or ask Rust for projections, but the canonical Chronicle lifecycle lives in `chronicle/`.

## Progress

- [x] (2026-05-23 15:56 CST) Read the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md` and captured the mandatory self-contained, living-document, validation-first requirements.
- [x] (2026-05-23 15:56 CST) Read `docs/draft-solutions/done/codex-chronicle-spec.md` and confirmed Codex Chronicle is a Rust process that owns capture, artifacts, memory windows, and memory file output instead of delegating core semantics to a Server module.
- [x] (2026-05-23 15:56 CST) Surveyed current Rust files under `chronicle/`, including `chronicle/src/daemon.rs`, `chronicle/src/cradle_client.rs`, `chronicle/src/memory_pipeline/recursive.rs`, `chronicle/src/memory_pipeline/summarizer.rs`, `chronicle/src/pipeline.rs`, `chronicle/src/config.rs`, and `chronicle/tests/smoke.rs`.
- [ ] Milestone 1: Define the standalone core boundary and add capability traits so core modules no longer import `CradleClient` directly.
- [ ] Milestone 2: Add local Chronicle storage state for events, memory manifests, and replayable evidence references under the storage root.
- [ ] Milestone 3: Move summarization orchestration into Rust capabilities, with local deterministic summarization as the default and child-process LLM as the first non-Server LLM capability.
- [ ] Milestone 4: Rewire daemon, audio, transcript inbox, and pipeline code to use core-owned capabilities and local store first; leave Server reporting only as an optional adapter outside the core path.
- [ ] Milestone 5: Add tests and smoke commands proving Chronicle runs and produces memory with no Server.

## Surprises & Discoveries

- Observation: The current Rust crate is already more than a capture helper; it has OCR, audio capture, VAD/ASR, speaker embedding, recursive memory summaries, cron jobs, triage, crystallization, dedup, dream maintenance, and a smoke binary test.
  Evidence: `chronicle/src/README.md` lists local audio diagnostics, local embedding worker, local PII diagnostic, audio model diagnostics, transcript inbox, cron cleanup, and memory pipeline modules.

- Observation: The current Rust daemon still treats Cradle Server as part of the core path.
  Evidence: `chronicle/src/daemon.rs` imports `crate::cradle_client::CradleClient`, creates `CradleClient::from_env()` in both run-once and loop paths, calls `client.fetch_config()` and `client.summarize()` inside `run_summary`, and reports snapshots, memories, accessibility events, raw audio segments, transcripts, speaker profiles, Slack messages, and processing results through HTTP.

- Observation: There is already a child-process boundary that can become the Rust-owned LLM capability.
  Evidence: `chronicle/src/codex_exec.rs` defines `ChildProcessRequest`, `ChildProcessOutput`, and `run_child_process`, and its test proves stdin/stdout child execution with `/bin/cat`.

- Observation: The existing smoke test already proves the most important standalone invariant: `cradle-chronicle --smoke` writes artifacts and one memory file without macOS permissions or Server.
  Evidence: `chronicle/tests/smoke.rs` runs the compiled binary with `--smoke --storage-root <tmp> --capture-limit 2` and asserts `frame-00001.jpg`, `capture-00001.json`, `ocr-00001.json`, `snapshot.json`, and one memory file.

## Decision Log

- Decision: Do not modify `apps/server` in this plan.
  Rationale: The next phase is explicitly about making Rust Chronicle good. Server may later provide storage, LLM, or reverse invocation capabilities, but it must not shape the Rust core design in this plan.
  Date/Author: 2026-05-23 / Codex

- Decision: Treat Rust Chronicle as the owner of Chronicle semantics.
  Rationale: Codex Chronicle works because Rust owns capture, artifact layout, memory windows, and memory generation. Cradle should not split Chronicle semantics between Rust and TypeScript, because that creates two canonical sources and high coupling.
  Date/Author: 2026-05-23 / Codex

- Decision: Keep external integrations as capability adapters, not core dependencies.
  Rationale: Server, LLM providers, Slack, and model installation may be useful, but core modules should depend on small Rust traits such as “write this event”, “summarize this prompt”, or “locate this model”, not on HTTP routes or Cradle Server payload types.
  Date/Author: 2026-05-23 / Codex

- Decision: Preserve existing local smoke behavior while replacing architecture underneath.
  Rationale: The current smoke test gives a stable safety rail. Every milestone should keep `cargo test --manifest-path chronicle/Cargo.toml` and the smoke command passing.
  Date/Author: 2026-05-23 / Codex

## Outcomes & Retrospective

No implementation has been completed yet. The expected final outcome is a Rust Chronicle core that can be run, tested, and inspected without Server. Any remaining Server integration should be visibly outside the core path and should be safe to remove, disable, or replace without changing Chronicle memory semantics.

## Context and Orientation

The repository root is `/Users/wibus/dev/Cradle`. The Rust Chronicle crate lives in `chronicle/`. It has one binary named `cradle-chronicle`, configured in `chronicle/Cargo.toml`, with its CLI entry point at `chronicle/src/main.rs`.

The word “core” in this plan means the modules that own Chronicle behavior: capture, local evidence artifacts, local signal extraction, memory windowing, summarization orchestration, search/index state, event logs, replay, retention, and daemon lifecycle. A “capability” means a narrow external ability that Chronicle can ask for without becoming coupled to the provider. Examples are “generate a summary for this prompt”, “return the storage root”, “locate a local model file”, or “publish a projection event”. A capability can be implemented by a local deterministic function, a child process, Server, Desktop, or a test fake.

The current Rust crate has useful pieces already:

- `chronicle/src/main.rs` parses CLI modes such as `--smoke`, `--daemon`, `--audio-diagnostics`, `--embed-texts`, `--redact-pii`, `--transcribe-wav`, `--embed-speaker-wav`, and `--inspect-onnx`.
- `chronicle/src/config.rs` parses storage root, provider, capture interval, audio flags, and privacy rules.
- `chronicle/src/daemon.rs` orchestrates the long-running loop, capture, audio processing, transcript processing, cron jobs, Slack polling, summarization, and HTTP reporting.
- `chronicle/src/recorder/` owns artifact persistence and frame deduplication.
- `chronicle/src/screen/` owns capture providers, privacy filtering, synthetic frames, macOS capture, Accessibility polling, and AXObserver runtime.
- `chronicle/src/audio/` owns audio capture, WAV writing, VAD, ASR, speaker embedding, and related diagnostics.
- `chronicle/src/memory_pipeline/` owns memory naming, prompt construction, local summary writing, and recursive summary orchestration.
- `chronicle/src/codex_exec.rs` owns a child-process execution boundary that can become a non-Server LLM capability.
- `chronicle/src/cradle_client.rs` currently owns HTTP payloads and calls into Cradle Server. This file is an integration boundary, not Chronicle core.
- `chronicle/src/pipeline.rs`, `chronicle/src/triage.rs`, `chronicle/src/crystallizer.rs`, and `chronicle/src/embedding.rs` currently contain activity/memory processing concepts, but some paths can still call Cradle Server. They must be reoriented around local core capabilities.

The important architectural problem is that `chronicle/src/daemon.rs` currently mixes three concerns: it captures local evidence, creates local memories, and reports or requests behavior from Cradle Server. This plan separates those concerns without touching Server code.

## Plan of Work

Milestone 1 creates explicit Rust boundaries. Add a new module `chronicle/src/core/` and a new module `chronicle/src/capabilities.rs`. The core module should define the high-level runtime object, and the capabilities module should define traits for outside help. At the end of this milestone, core modules should be able to compile with local-only implementations. `chronicle/src/lib.rs` should export the new modules. `chronicle/src/daemon.rs` does not need to be fully rewritten yet, but new code should make the intended boundary concrete.

Milestone 2 gives Chronicle a local store that is more than loose files. Add `chronicle/src/store/` with a `ChronicleStore` that owns paths under the storage root. It should append an event journal, write memory manifests, and read them back. Use plain JSON or newline-delimited JSON files so the result is inspectable without a database. This store is not a replacement for artifact files; it is a small canonical index that points to artifacts and memories.

Milestone 3 moves summarization behind Rust-owned capabilities. Keep `LocalSummaryWriter` as the default writer. Add a child-process summary writer that uses `chronicle/src/codex_exec.rs` or a new wrapper around it. The child process command should come from an environment variable such as `CRADLE_CHRONICLE_LLM_COMMAND`, and tests should use a tiny local script or `/bin/cat`-style fake. Do not call `/chronicle/summarize` from core summarization.

Milestone 4 rewires the daemon and pipeline. `chronicle/src/daemon.rs` should construct `ChronicleCore`, `ChronicleStore`, and default local capabilities. It should write local artifacts, local events, local memories, and local indexes first. It may optionally publish projections through an integration adapter, but daemon operation and memory generation must not require a reachable Server. Direct imports of `CradleClient` should disappear from `daemon.rs`, `pipeline.rs`, `memory_pipeline/`, and local audio processing paths.

Milestone 5 adds acceptance tests and documentation. Extend `chronicle/tests/smoke.rs` or add a new binary-level test that explicitly points any Server URL at an unreachable local port and still observes successful memory output, store event output, and index/manifest output. Update `chronicle/README.md`, `chronicle/src/README.md`, and `chronicle/tests/README.md` to explain the Rust-owned memory core and the optional nature of external integrations.

## Concrete Steps

Work from the repository root:

    cd /Users/wibus/dev/Cradle

Before implementing, capture the current baseline:

    cargo test --manifest-path chronicle/Cargo.toml

Expected result: all Rust tests pass. If they do not pass before changes, record the failure in `Surprises & Discoveries` before editing production code.

Create the boundary modules:

    mkdir -p chronicle/src/core chronicle/src/store

Edit `chronicle/src/lib.rs` to export `capabilities`, `core`, and `store`. Add `chronicle/src/capabilities.rs`, `chronicle/src/core/mod.rs`, and `chronicle/src/store/mod.rs`. These files should define the interfaces listed in `Interfaces and Dependencies`.

After Milestone 1, run:

    cargo fmt --manifest-path chronicle/Cargo.toml
    cargo test --manifest-path chronicle/Cargo.toml

Expected result: formatting completes with no diff required, and tests pass.

After Milestone 2, run a smoke command with an empty storage root:

    rm -rf /tmp/cradle-chronicle-core-smoke
    cargo run --manifest-path chronicle/Cargo.toml -- --smoke --storage-root /tmp/cradle-chronicle-core-smoke --capture-limit 2
    find /tmp/cradle-chronicle-core-smoke -maxdepth 3 -type f | sort

Expected result: stdout contains `cradle chronicle smoke completed`, the storage root contains frame/capture/OCR/snapshot artifacts, `memories/` contains a memory markdown file, and the new store files such as `events.ndjson` or `memory-manifest.json` exist if the milestone has wired smoke through the store.

After Milestone 3, test the child-process summary capability with a fake summarizer. The exact command may change with implementation, but it should be runnable without Server. If the implementation uses `CRADLE_CHRONICLE_LLM_COMMAND`, validate with a simple executable script under a temp directory that reads stdin and prints a deterministic markdown summary.

After Milestone 4, prove the daemon path does not require Server:

    rm -rf /tmp/cradle-chronicle-core-run-once
    CRADLE_URL=http://127.0.0.1:1 cargo run --manifest-path chronicle/Cargo.toml -- --daemon --provider inbox --run-once --storage-root /tmp/cradle-chronicle-core-run-once

Expected result: the command exits successfully or with only expected inbox-empty behavior, and it must not hang while trying to reach Server. If test fixtures are needed for `provider inbox`, add them under the chosen inbox root and document the fixture layout in this plan before using them.

Run static coupling checks after Milestone 4:

    rg "CradleClient|cradle_client" chronicle/src/daemon.rs chronicle/src/pipeline.rs chronicle/src/memory_pipeline chronicle/src/audio

Expected result: no matches in core paths. Matches are acceptable only in explicitly named integration adapter files such as `chronicle/src/integrations/cradle_server.rs` or legacy tests that target the adapter.

At the end, run:

    cargo fmt --manifest-path chronicle/Cargo.toml
    cargo test --manifest-path chronicle/Cargo.toml
    cargo run --manifest-path chronicle/Cargo.toml -- --smoke --storage-root /tmp/cradle-chronicle-final-smoke --capture-limit 2

Expected result: tests pass, smoke run succeeds, and memory/store artifacts are inspectable under `/tmp/cradle-chronicle-final-smoke`.

## Validation and Acceptance

Acceptance is not “the code compiles”. The feature is accepted when a developer can run Rust Chronicle without Server and observe a complete local memory system.

The minimum accepted behavior is:

1. `cargo test --manifest-path chronicle/Cargo.toml` passes.
2. `cargo run --manifest-path chronicle/Cargo.toml -- --smoke --storage-root /tmp/cradle-chronicle-final-smoke --capture-limit 2` prints `cradle chronicle smoke completed`.
3. The smoke storage root contains local frame artifacts, OCR/capture/snapshot JSON, a memory markdown file, and the new local store/index files.
4. Running the daemon or smoke with `CRADLE_URL=http://127.0.0.1:1` does not prevent local memory output.
5. `chronicle/src/daemon.rs` no longer imports or constructs `CradleClient`.
6. Server-related HTTP code, if retained, lives behind an adapter and is not required by the local smoke or local daemon run-once path.

A stronger accepted behavior, if completed in this plan, is:

1. A child-process LLM summary capability can be configured without changing Server.
2. The event journal records capture, summary, audio, and error events in append-only order.
3. Memory manifests can be read back by a test and used for simple local search or listing.
4. Failed external integrations leave local artifacts and store state intact.

## Idempotence and Recovery

All implementation steps should be additive until tests pass. New modules can be added safely. Existing Server-facing code should be moved behind adapters only after local tests cover the replacement path.

Commands using `/tmp/cradle-chronicle-*` paths are safe to repeat because they remove only their own temp directories. Do not delete user storage roots such as `~/.cradle/chronicle` during this plan. If a daemon command hangs, stop it with Ctrl-C and record the hang in `Surprises & Discoveries` with the command that caused it.

If a milestone fails halfway, restore forward progress by keeping the local smoke path passing first. Do not repair by adding new Server calls to core modules. If an adapter is needed for compatibility, isolate it under a path that clearly names it as integration code.

## Artifacts and Notes

Useful baseline commands from current repo state:

    cargo test --manifest-path chronicle/Cargo.toml
    cargo run --manifest-path chronicle/Cargo.toml -- --smoke --storage-root /tmp/cradle-chronicle-smoke --capture-limit 2

Current coupling evidence to remove from the core path:

    chronicle/src/daemon.rs imports crate::cradle_client::{..., CradleClient}
    chronicle/src/daemon.rs creates CradleClient::from_env()
    chronicle/src/daemon.rs calls client.fetch_config()
    chronicle/src/daemon.rs calls client.summarize()
    chronicle/src/daemon.rs reports local evidence through HTTP after capture
    chronicle/src/pipeline.rs imports cradle_base_url and DEFAULT_CRADLE_URL
    chronicle/src/audio/asr.rs contains RemoteAsr that delegates to Cradle Server

The Codex Chronicle reference in `docs/draft-solutions/done/codex-chronicle-spec.md` is useful only as architectural evidence: Rust owns capture, artifacts, memory windows, and LLM child-process orchestration. This plan does not copy Codex-specific `MEMORY.md` behavior unless a later decision explicitly adds it.

## Interfaces and Dependencies

Add `chronicle/src/capabilities.rs` with these concepts. The exact field names may evolve, but the boundary must remain provider-neutral:

    pub trait SummaryCapability {
        fn summarize(&self, request: SummaryCapabilityRequest) -> ChronicleResult<SummaryCapabilityOutput>;
    }

    pub struct SummaryCapabilityRequest {
        pub prompt: String,
        pub window: crate::memory_pipeline::naming::MemoryWindow,
        pub evidence_paths: Vec<std::path::PathBuf>,
        pub child_summaries: Vec<String>,
    }

    pub struct SummaryCapabilityOutput {
        pub markdown: String,
        pub provider: SummaryProvider,
    }

    pub enum SummaryProvider {
        Local,
        ChildProcess,
        External(String),
    }

    pub trait IntegrationSink {
        fn publish(&self, event: ChronicleIntegrationEvent) -> ChronicleResult<()>;
    }

    pub struct NoopIntegrationSink;

`SummaryCapability` means “given a prompt and evidence, produce markdown”. It must not mention HTTP, Server routes, profiles, or Cradle DB. `IntegrationSink` means “someone outside Chronicle may want a projection event”. The default sink is no-op so core behavior cannot depend on external consumers.

Add `chronicle/src/store/mod.rs` with these concepts:

    pub struct ChronicleStore {
        root: std::path::PathBuf,
    }

    impl ChronicleStore {
        pub fn new(root: impl Into<std::path::PathBuf>) -> Self;
        pub fn append_event(&self, event: &ChronicleStoreEvent) -> ChronicleResult<()>;
        pub fn record_memory(&self, memory: &ChronicleMemoryManifest) -> ChronicleResult<()>;
        pub fn list_memories(&self) -> ChronicleResult<Vec<ChronicleMemoryManifest>>;
    }

    pub struct ChronicleStoreEvent {
        pub id: String,
        pub kind: String,
        pub created_at: String,
        pub payload: serde_json::Value,
    }

    pub struct ChronicleMemoryManifest {
        pub id: String,
        pub window: String,
        pub created_at: String,
        pub memory_path: std::path::PathBuf,
        pub source_paths: Vec<std::path::PathBuf>,
        pub summary_kind: String,
    }

Use JSON files in the storage root. Recommended initial files are `events.ndjson` for append-only events and `memory-manifest.json` for memory listings. New writes should be atomic where practical: write to a temp file then rename for whole-file manifests, and append a single newline-delimited JSON object for event logs.

Add `chronicle/src/core/mod.rs` with these concepts:

    pub struct ChronicleCore<C, S> {
        store: crate::store::ChronicleStore,
        summary: C,
        sink: S,
    }

    impl<C, S> ChronicleCore<C, S>
    where
        C: crate::capabilities::SummaryCapability,
        S: crate::capabilities::IntegrationSink,
    {
        pub fn new(
            store: crate::store::ChronicleStore,
            summary: C,
            sink: S,
        ) -> Self;
    }

`ChronicleCore` should be the object the daemon eventually uses. It owns local state and asks capabilities for outside help. It must not know about `CradleClient`.

If a Server adapter is retained, put it somewhere that marks it as integration code, for example `chronicle/src/integrations/cradle_server.rs`. It may use `ureq` and Cradle route payloads, but core modules must not import it directly. The adapter can implement `IntegrationSink` or `SummaryCapability`.

Document any deviation from these interface names in the `Decision Log` before implementing it.

Revision note, 2026-05-23: Initial ExecPlan created to redirect Chronicle work away from Server code and toward a standalone Rust memory core with provider-neutral capabilities.
