# Build a Cradle-Owned OpenTelemetry Runtime for Metrics, Traces, Logs, and Leak Diagnostics

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not currently check in a root-level `PLANS.md`. This document is authored and must be maintained in accordance with `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained so a contributor can resume the work with only this file and the repository checkout.

## Purpose / Big Picture

Cradle already records local observability events and incidents, but it does not yet have a full telemetry runtime that lets a developer answer, from one connected view, which chat run, runtime host, terminal, desktop renderer, or Chronicle daemon caused a memory or performance problem. The goal of this plan is to make observability a first-class Cradle-owned capability that uses OpenTelemetry for standard traces and metrics, pino logs for correlated logs, existing Cradle observability events for forensic records, and guarded profiling tools for memory leak diagnosis.

After this change, a developer can start Cradle with telemetry enabled, run an agent workflow, and inspect a connected chain: a Grafana dashboard shows process and runtime memory trends; Tempo or another trace backend shows the chat run span; logs include the same trace id; local `observability_events` rows include the same trace id; and a local runtime snapshot endpoint shows exact active runs, provider hosts, terminal process RSS, Chronicle daemon RSS, and desktop renderer resource facts. This is not a generic telemetry platform hidden in infrastructure. The owner is the `observability` server module and the server telemetry infrastructure; feature modules contribute their own semantic spans and metrics without writing data into another owner namespace.

## Progress

- [x] (2026-06-08 13:55 CST) Read the ExecPlan skill and `/Users/wibus/.agents/skills/execplan/references/PLANS.md`; confirmed the plan must be self-contained, living, outcome-focused, and stored under `docs/exec-plans/`.
- [x] (2026-06-08 14:03 CST) Inspected current observability, health, PTY, Chronicle daemon, desktop reporter, Langfuse, pino logging, and server startup code to ground the plan in existing ownership boundaries.
- [x] (2026-06-08 14:18 CST) Created this ExecPlan with phased implementation, validation commands, environment variables, route/interface design, and Grafana/OTEL/backend integration details.
- [x] (2026-06-08 02:02 CST) Implemented Milestone 1: added `apps/server/src/telemetry/` with OpenTelemetry NodeSDK lifecycle, typed env config, resource attributes, OTLP trace/metric exporters, Prometheus reader option, runtime/auto/pino instrumentation, host metrics startup, and Langfuse as an optional span processor.
- [x] (2026-06-08 02:04 CST) Implemented Milestone 2: replaced AI SDK/provider `langfuseEnabled` gates with `aiTelemetryEnabled()`, added active-span trace fields to pino logger wrapper, and defaulted observability events to active span `traceId` plus `attrs.otel`.
- [x] (2026-06-08 02:06 CST) Implemented Milestone 3: added `/observability/runtime-snapshot`, generated `cradle observability runtime-snapshot`, exposed observability queue health, and added low-cardinality metric update functions for server, chat runtime, provider runtime, PTY, Chronicle, and observability.
- [x] (2026-06-08 02:09 CST) Implemented Milestone 4: added `POST /observability/runtime-samples`, bounded in-memory desktop sample storage, runtime snapshot `desktop.latestSamples`, and Electron main-process periodic resource reporting from `app.getAppMetrics()`, `process.getProcessMemoryInfo()`, and `BrowserWindow`.
- [x] (2026-06-08 02:14 CST) Implemented Milestone 5: added guarded `POST /observability/diagnostics/heap-snapshot`, local/token checks, Cradle data-dir snapshot output, observability events for snapshot success/failure, and `apps/server/scripts/leak-harness.ts` with `pnpm --filter @cradle/server leak:harness`.
- [x] (2026-06-08 02:12 CST) Implemented Milestone 6: updated `documentations/content/docs/operations/observability.mdx` with OTEL, Prometheus, Grafana stack, Langfuse exporter, runtime snapshot, and guarded diagnostics instructions. Verified telemetry runtime startup, trace-event correlation, CLI command registration, runtime snapshot behavior, desktop sample ingestion, focused tests, and typechecks.
- [x] (2026-06-08 02:32 CST) Continued metric coverage until currently available low-cardinality runtime facts are exported without requiring manual snapshot calls. Added automatic runtime metric sampling, server CPU/uptime/active resources, chat replay delta gauges, provider host state gauges, PTY session/descendant gauges, Chronicle running/CPU gauge, observability queue state gauges, and desktop process/window/memory gauges.
- [x] (2026-06-08 02:50 CST) Added Desktop-owned observability env pass-through for server child processes, covered the pass-through helper with a desktop unit test, and documented Desktop/Grafana launch commands.

## Surprises & Discoveries

- Observation: The current Langfuse integration is intentionally narrow and is not a full telemetry runtime.
  Evidence: `apps/server/src/langfuse.ts` creates a `BasicTracerProvider` with only `LangfuseSpanProcessor`, calls `trace.setGlobalTracerProvider(provider)`, and exposes `langfuseEnabled`.

- Observation: AI SDK telemetry is currently coupled to Langfuse credentials instead of a general telemetry switch.
  Evidence: `apps/server/src/modules/chat-runtime-engine/ai-sdk-engine.ts`, `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts`, and `apps/server/src/modules/chat-runtime-providers/codex/provider.ts` import `langfuseEnabled` to decide whether to enable AI SDK telemetry behavior.

- Observation: Several high-value resource snapshots already exist and should be reused rather than replaced.
  Evidence: `apps/server/src/modules/health/service.ts` exposes server memory and CPU; `apps/server/src/modules/pty/pty.runtime.ts` reads `ps` and computes terminal process-tree RSS/CPU; `apps/server/src/modules/chronicle/daemon-manager.ts` exposes daemon RSS/CPU; `apps/server/src/modules/provider-runtime/host-manager.ts` lists active provider runtime hosts.

- Observation: Existing local observability already has a trace id column, but the record path does not automatically bind it to the active OpenTelemetry span.
  Evidence: `packages/db/src/schema/observability.ts` defines `observability_events.traceId`, and `apps/server/src/modules/observability/contract.ts` accepts `traceId`, but `createObservabilityEvent()` only uses explicit input.

- Observation: The worktree is dirty with many unrelated user changes.
  Evidence: `git status --short` lists modified desktop, server, and web files outside this plan. Do not revert or overwrite unrelated changes.

- Observation: OpenTelemetry API 1.9 observable gauges do not accept a callback as the third argument.
  Evidence: `pnpm --filter @cradle/server typecheck` initially failed with `TS2554: Expected 1-2 arguments, but got 3` in `apps/server/src/telemetry/metrics.ts`. The implementation now creates each observable gauge first and registers callbacks with `addCallback()`.

- Observation: The generated CLI had drift from current server OpenAPI beyond the new runtime-snapshot route.
  Evidence: `pnpm gen:cli` generated `packages/cli/src/commands/generated/observability/runtime-snapshot.ts` and also refreshed several existing generated commands plus `resources/skills/cradle-cli/SKILL.md`. `pnpm --filter @cradle/cli typecheck` passed after generation.

- Observation: Shutdown-time logger flushing can throw if SonicBoom destinations are not ready.
  Evidence: A trace-correlation verification wrote an observability event successfully, then exited with `Error: sonic boom is not ready yet` from `flushLogger()`. `flushLogger()` is now best-effort and catches flush errors during process shutdown.

- Observation: A concurrent chat-runtime change added `releaseTerminalPersistedActiveRunForSession` and needed explicit narrowing before server typecheck could pass.
  Evidence: `pnpm --filter @cradle/server typecheck` failed with `TS2345` at `apps/server/src/modules/chat-runtime/service.ts:6471` because `run` could be `undefined`. Adding `if (!run) return false` preserved the user's logic and restored typecheck.

- Observation: Custom metrics must be refreshed independently of HTTP snapshot calls.
  Evidence: Before this revision, `apps/server/src/modules/observability/runtime-snapshot.ts` was the only code path calling `update*Metrics(...)`, so Prometheus scrape freshness depended on someone calling `/observability/runtime-snapshot`. `apps/server/src/telemetry/runtime-sampler.ts` now samples automatically when metrics are enabled.

- Observation: Prometheus exporter prefix plus already-prefixed metric names would double-prefix Cradle metrics.
  Evidence: Metrics are named `cradle_*`; exporter config previously used `prefix: 'cradle_'`, which would expose names like `cradle_cradle_process_memory_bytes`. The Prometheus exporter now uses an empty prefix and verified scrape output includes `cradle_process_memory_bytes`.

- Observation: Desktop-launched server observability depended on the broad inherited `process.env` object rather than an explicit Desktop-owned pass-through contract.
  Evidence: `apps/desktop/src/main/server-process.ts` built `serverEnv` with `...process.env`, then overrode lifecycle values such as `CRADLE_HOST`, `CRADLE_PORT`, and `CRADLE_DATA_DIR`. This worked in many dev shells but made OTEL/Grafana behavior implicit and fragile.

## Decision Log

- Decision: The owner for product observability semantics remains `apps/server/src/modules/observability`, while reusable OpenTelemetry bootstrapping lives under `apps/server/src/telemetry`.
  Rationale: OpenTelemetry SDK setup is cross-cutting infrastructure, but event, incident, runtime snapshot, and export semantics are a Cradle capability and belong to the observability namespace. This follows the repository ownership rule: features should live where their semantics, lifecycle, and migration are owned.
  Date/Author: 2026-06-08 / Codex.

- Decision: Replace `langfuseEnabled` as the telemetry gate with a Cradle-owned `telemetryEnabled` or equivalent config, and make Langfuse an optional exporter/span processor.
  Rationale: Producing traces and metrics is not the same as exporting LLM traces to Langfuse. Coupling those concerns prevents local OTEL/Grafana usage without Langfuse credentials.
  Date/Author: 2026-06-08 / Codex.

- Decision: Use OpenTelemetry NodeSDK for server telemetry instead of continuing to manually assemble only `BasicTracerProvider`.
  Rationale: NodeSDK is the standard integration point for traces, metrics, resource attributes, and auto-instrumentations. It lets Cradle configure OTLP exporters and runtime/HTTP/pino instrumentation in one place.
  Date/Author: 2026-06-08 / Codex.

- Decision: Keep high-cardinality identifiers such as `sessionId`, `runId`, `messageId`, file paths, prompts, and full error messages out of metric labels.
  Rationale: Metrics backends become expensive and hard to query when labels have unbounded values. Those identifiers belong in traces, logs, and observability events, not Prometheus labels.
  Date/Author: 2026-06-08 / Codex.

- Decision: Add a JSON runtime snapshot endpoint in addition to Prometheus/OTLP metrics.
  Rationale: Metrics show trends, but leak diagnosis needs concrete state such as the exact active run count, provider host list, terminal resource snapshots, and renderer process facts. A structured snapshot is better for CLI/devtool/leak harness use.
  Date/Author: 2026-06-08 / Codex.

- Decision: Heap snapshots and allocation profiling must be guarded local diagnostics, not always-on observability endpoints.
  Rationale: Node's own diagnostics guidance says heap snapshots pause the main thread and may require memory up to roughly twice the heap size, which can crash a process. They are valuable for leak diagnosis but unsafe as an unconditional production endpoint.
  Date/Author: 2026-06-08 / Codex.

- Decision: Keep desktop runtime samples bounded and in memory.
  Rationale: Electron owns process/window sampling. The server only needs recent samples for runtime snapshot and metrics; durable storage would create a new retention/migration surface before there is a product need.
  Date/Author: 2026-06-08 / Codex.

- Decision: Make logger trace correlation explicit in Cradle's logger wrapper even though pino instrumentation is also configured.
  Rationale: Server startup creates the pino logger before the NodeSDK starts, and automatic pino patching is import-order sensitive. The wrapper guarantees JSON log fields include active `traceId`, `spanId`, and `traceFlags` whenever a span exists.
  Date/Author: 2026-06-08 / Codex.

- Decision: Use a telemetry-owned automatic sampler that reads the observability runtime snapshot assembler.
  Rationale: The runtime snapshot assembler already respects owner boundaries by reading health, chat runtime, provider runtime, PTY, Chronicle, desktop samples, and observability queue state. Reusing it keeps metrics and JSON diagnostics consistent while avoiding duplicate resource-gathering code.
  Date/Author: 2026-06-08 / Codex.

- Decision: Keep new metric labels low-cardinality and move high-cardinality facts to runtime snapshot only.
  Rationale: The new metrics expose process kind, runtime kind, PTY role, Electron process type, and metric kind. They intentionally do not expose run id, session id, provider target id, pid, window id, file paths, or prompts.
  Date/Author: 2026-06-08 / Codex.

- Decision: Desktop explicitly passes observability configuration to the forked server through an allowlist.
  Rationale: Desktop owns the Electron launcher and server child-process environment, so OTEL, Prometheus, OTLP, Langfuse, profiling, and guarded diagnostics settings must be an auditable contract. Server lifecycle values remain Desktop-owned and are not part of this pass-through helper.
  Date/Author: 2026-06-08 / Codex.

## Outcomes & Retrospective

The implementation is complete for the planned first OTEL observability runtime. Cradle Server now owns telemetry configuration and lifecycle under `apps/server/src/telemetry/`. Langfuse is no longer the global telemetry gate; it is an optional span processor/exporter. AI SDK telemetry is controlled by `aiTelemetryEnabled()`. Logs and observability events inherit active span context. `/observability/runtime-snapshot` returns server, chat runtime, provider runtime, PTY, Chronicle, desktop, and observability queue facts. Desktop main reports bounded process/window samples. Heap snapshot diagnostics are guarded and disabled by default. Operations documentation explains the local OTEL/Grafana path.

Validation passed:

    pnpm --filter @cradle/server typecheck
    pnpm --filter @cradle/desktop typecheck
    pnpm --filter @cradle/cli typecheck
    pnpm --filter @cradle/server exec tsc --noEmit --target ESNext --module ESNext --moduleResolution bundler --types node scripts/leak-harness.ts
    pnpm --filter @cradle/server exec vitest run tests/health.test.ts tests/observability.test.ts
    pnpm --filter @cradle/cli cradle observability --help

Manual verification passed:

    CRADLE_OTEL_ENABLED=1 CRADLE_OTEL_TRACES_ENABLED=1 CRADLE_OTEL_METRICS_ENABLED=1 NODE_ENV=development pnpm exec tsx -e "..."
    [telemetry] OpenTelemetry enabled service=cradle-server traces=true metrics=true
    [telemetry] Langfuse exporter disabled
    telemetry-ok

    /observability/runtime-snapshot -> 200
    snapshot keys: timestamp,server,chatRuntime,providerRuntime,pty,chronicle,desktop,observability
    /observability/diagnostics/heap-snapshot with diagnostics disabled -> 404 diagnostics_disabled

    Trace-correlation verification:
    events 1 traceId=yes otelAttrs=yes

    Desktop sample verification:
    runtime-sample 200 1 123

The implementation also includes a lightweight leak harness script that repeatedly calls an optional workflow endpoint, records `/observability/runtime-snapshot`, triggers GC when available, and reports RSS/heap/external/arrayBuffers deltas. Deeper future work can still add workflow-specific harness presets or Pyroscope integration, but the generic local harness is in place.

The follow-up metric coverage is also complete for currently available low-cardinality runtime facts. Metrics now update on an automatic sampler when telemetry metrics are enabled, not only when someone queries `/observability/runtime-snapshot`. Verified Prometheus scrape output includes server memory, CPU, active resources, chat active runs, provider hosts, PTY sessions, Chronicle state, observability queue, and desktop windows.

Prometheus metrics verification:

    metrics-status 200
    cradle_process_memory_bytes yes
    cradle_process_cpu_percent yes
    cradle_process_active_resources_total yes
    cradle_chat_active_runs_total yes
    cradle_provider_runtime_hosts_total yes
    cradle_pty_sessions_total yes
    cradle_chronicle_daemon_state yes
    cradle_observability_queue_depth yes
    cradle_desktop_windows_total yes

Automatic sampler verification without calling `/observability/runtime-snapshot`:

    auto-status 200 memory=yes resources=yes

## Context and Orientation

The repository root is `/Users/wibus/dev/Cradle`. The server application lives under `apps/server`. It uses Elysia routes, TypeBox schemas, Drizzle-backed SQLite tables, pino logging, and generated CLI commands from OpenAPI metadata. The main server entry is `apps/server/src/index.ts`, which initializes logging, process fatal handlers, Langfuse tracing, server config, and `createServerApp()`.

The existing local observability module lives in `apps/server/src/modules/observability/`. `index.ts` exposes `/observability/events`, `/observability/incidents`, `/observability/error-patterns`, `/observability/flush`, and `/observability/export`. `service.ts` records events, batches them to SQLite, applies incident rules, reads chat runtime snapshots, and exports diagnostics bundles. `contract.ts` defines event and incident helpers. `model.ts` owns TypeBox route schemas. `README.md` describes the module. Database schema for observability lives in `packages/db/src/schema/observability.ts`.

The current health endpoint lives in `apps/server/src/modules/health/`. `service.ts` reads `process.memoryUsage()` and `process.cpuUsage()` and returns heap, RSS, external memory, and CPU sample data. This is useful but limited to the server process and only exposed as JSON under `/health`.

The PTY runtime, which runs terminal UI sessions such as Claude Code or Codex CLI, lives in `apps/server/src/modules/pty/`. `pty.runtime.ts` has `snapshotResources()` that shells out to `ps -axo pid=,ppid=,rss=,pcpu=` and computes RSS and CPU across each terminal process tree. The route `/terminal-sessions/resources` already exposes this shape.

The Chronicle daemon manager lives in `apps/server/src/modules/chronicle/daemon-manager.ts`. Chronicle is a local evidence runtime for capture/audio/model work. `getDaemonResources()` reads RSS and CPU for the daemon process. Chronicle product semantics, API, and database state are owned by `apps/server/src/modules/chronicle/`.

The provider runtime host manager lives in `apps/server/src/modules/provider-runtime/host-manager.ts`. A provider runtime host is an in-process or external resource retained for a provider target and scope. It has a lease/ref-count model and a `listHosts()` method that exposes host id, runtime kind, provider target id, scope id, ref counts, and timestamps.

The desktop app lives under `apps/desktop`. Its current `apps/desktop/src/main/observability-reporter.ts` only reports fatal desktop main-process errors to `/observability/events`. Electron main and renderer process memory are not yet sampled. Desktop must remain the owner of Electron-specific APIs such as `app.getAppMetrics()`, `process.getProcessMemoryInfo()`, `BrowserWindow`, `webContents`, and IPC listener accounting; the server can receive resource samples but should not reach into Electron namespaces directly.

OpenTelemetry, abbreviated OTEL, is a vendor-neutral set of APIs and SDKs for traces, metrics, logs, and related telemetry. A trace is a tree of timed spans describing one operation such as a chat run or provider API call. A metric is a numeric time series such as heap bytes or active run count. A log is an event-like text or structured record. A profile is a sampled view of CPU or allocations over time. This plan uses OTEL for standard traces and metrics, pino for logs with trace ids, Cradle observability events for forensic records, and optional profiling for deep leak diagnosis.

## Plan of Work

Milestone 1 establishes a real server telemetry runtime. Create a new directory `apps/server/src/telemetry/`. Move the Langfuse-specific initialization out of `apps/server/src/langfuse.ts` into `apps/server/src/telemetry/langfuse.ts` or replace the old file with a narrow compatibility re-export during the migration. Add `apps/server/src/telemetry/config.ts` to parse environment variables and expose a typed config. Add `apps/server/src/telemetry/index.ts` with `initializeTelemetry()` and `shutdownTelemetry()`. Use OpenTelemetry NodeSDK as the central SDK. Configure resource attributes such as `service.name`, `service.version`, `deployment.environment`, `process.pid`, and a stable Cradle component name. Register OTLP trace and metric exporters when configured. Register Langfuse span processing only when `CRADLE_LANGFUSE_ENABLED=1` or Langfuse credentials are present and the user has not disabled it. Keep `NODE_ENV === 'test'` telemetry disabled by default to avoid tests sending data.

Milestone 1 also adjusts server startup. In `apps/server/src/index.ts`, initialize telemetry before code that should be instrumented. Auto-instrumentation works best when registered before importing modules that create HTTP clients, loggers, or other instrumented libraries. The ideal future shape is a preload entry, such as `node --import ./dist/telemetry/preload.js dist/main.js`, but the first implementation can make `index.ts` import only telemetry/bootstrap code before importing `app`, `logger`, and feature modules. Document the limitation in `apps/server/src/telemetry/README.md`: if a dependency is imported before instrumentation starts, that dependency may not be patched for auto spans.

Milestone 2 decouples AI SDK telemetry from Langfuse. Replace imports of `langfuseEnabled` in `apps/server/src/modules/chat-runtime-engine/ai-sdk-engine.ts`, `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts`, and `apps/server/src/modules/chat-runtime-providers/codex/provider.ts` with a Cradle telemetry helper such as `aiTelemetryEnabled()` or `telemetryEnabled`. AI SDK spans should be produced when Cradle telemetry is enabled, even if Langfuse is disabled. Langfuse should receive those spans only if its exporter/span processor is active.

Milestone 2 also adds log and event correlation. In `apps/server/src/logging/logger.ts`, add a small helper that reads the current active OTEL span context and appends `traceId`, `spanId`, and `traceFlags` to pino fields. This can be done through pino instrumentation or through Cradle's logger wrapper, but the result must be that JSON logs written to `server.log` include trace identifiers when a span is active. In `apps/server/src/modules/observability/service.ts` or `contract.ts`, default missing `traceId` and `attrs.otel.spanId` from the active span context. The event record should remain valid without OTEL; if no span exists, it records no trace id.

Milestone 3 adds custom metrics and a runtime snapshot. The metric implementation belongs in `apps/server/src/telemetry/metrics.ts`, while route ownership belongs in `apps/server/src/modules/observability/`. Add `GET /observability/runtime-snapshot` in `apps/server/src/modules/observability/index.ts`, with schemas in `model.ts` and data assembly in `service.ts` or a dedicated `runtime-snapshot.ts` under the observability module. The snapshot should read existing owner APIs rather than duplicate logic: server memory/CPU from health service helpers or shared functions; active chat run summaries and replay buffer summaries from `apps/server/src/modules/chat-runtime/service.ts`; provider hosts from `providerRuntimeHostManager.listHosts()`; PTY resources from `Pty.listResources()`; Chronicle daemon resources from `getDaemonResources()`; observability queue depth/dropped event counters from the observability service.

Milestone 3 metrics should use low-cardinality labels only. Define gauges and counters for server process memory, Node heap memory, event loop lag if available from runtime instrumentation, active chat runs by `runtime_kind`, replay buffer chunk totals by `runtime_kind`, provider runtime host count by `runtime_kind`, PTY RSS by `role`, Chronicle daemon RSS, observability queue depth, and dropped observability events. If using OTLP metrics, export them through the NodeSDK metric reader. If adding a Prometheus route, use either OpenTelemetry's Prometheus exporter or a simple text route under `/observability/metrics` that is documented as local/dev-only until production Collector wiring is complete. Do not emit `runId`, `sessionId`, `providerTargetId`, `workspacePath`, or prompt text as metric labels.

Milestone 4 adds desktop reporting. In `apps/desktop/src/main/observability-reporter.ts`, add a periodic resource reporter that samples Electron main and renderer facts and posts them to a server-owned ingestion route. The server route can be `POST /observability/runtime-samples` or another explicit name under the observability module. The desktop payload should include main process PID and memory, `app.getAppMetrics()` rows, BrowserWindow/webContents counts, renderer process IDs, renderer type or URL category, and sample timestamp. The server should store only a bounded recent in-memory sample window for runtime snapshot and metrics, unless a later decision adds durable sample storage. Do not write desktop-owned lifecycle data into unrelated server tables.

Milestone 5 adds guarded diagnostics for memory leaks. Add a server route such as `POST /observability/diagnostics/heap-snapshot` only if `CRADLE_DIAGNOSTICS_ENABLED=1` and local access/token checks pass. The route writes a heap snapshot under a Cradle-owned diagnostics directory inside `CRADLE_DATA_DIR`, records an observability event with snapshot metadata, and returns the path. Document that heap snapshots can pause the process and can double memory usage. Add a leak harness script under an owned scripts location, such as `apps/server/scripts/leak-harness.ts`, that repeatedly calls selected workflows or endpoints, records `/observability/runtime-snapshot` after each iteration, optionally triggers GC when Node is started with `--expose-gc`, and reports whether post-GC heap/RSS returns to a stable plateau.

Milestone 5 can also add optional profiling through `@pyroscope/nodejs` if the user wants continuous profiles in Grafana. Profiling must be controlled by `CRADLE_PROFILING_ENABLED=1` and configured with `CRADLE_PYROSCOPE_SERVER_URL`. Profiles are useful for CPU and allocation trends, but they do not replace heap snapshots for retain-path diagnosis.

Milestone 6 documents and validates local Grafana integration. Add an operations document under `documentations/content/docs/operations/` or update `documentations/content/docs/operations/observability.mdx`. Add a local compose file only if the repository has an existing place for local infrastructure; otherwise document a minimal Collector/Grafana/Tempo/Prometheus/Pyroscope setup without committing generated dashboard artifacts. The acceptance path should include starting the server with OTEL enabled, making a chat request or simple HTTP request, querying `/observability/runtime-snapshot`, confirming logs include `traceId`, confirming `/observability/events` rows contain `traceId` when recorded inside a span, and checking that metrics appear in the configured backend.

## Concrete Steps

Work from `/Users/wibus/dev/Cradle`.

Before editing, check current modified files and avoid overwriting unrelated work:

    git status --short

Expected output currently includes many unrelated modifications in desktop, server, and web files. Do not revert them.

Add server telemetry dependencies from the repository root. Use pnpm so the lockfile remains workspace-consistent:

    pnpm --filter @cradle/server add @opentelemetry/sdk-node @opentelemetry/sdk-trace-node @opentelemetry/sdk-metrics @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http @opentelemetry/auto-instrumentations-node @opentelemetry/instrumentation-runtime-node @opentelemetry/instrumentation-pino @opentelemetry/host-metrics @opentelemetry/resources @opentelemetry/semantic-conventions

If adding local Prometheus export directly:

    pnpm --filter @cradle/server add @opentelemetry/exporter-prometheus

If adding optional profiling:

    pnpm --filter @cradle/server add @pyroscope/nodejs

Create the telemetry module:

    mkdir -p apps/server/src/telemetry

Do not use shell redirection to write files during implementation if working as an agent; use `apply_patch` for manual edits. The initial files should be:

    apps/server/src/telemetry/config.ts
    apps/server/src/telemetry/resource.ts
    apps/server/src/telemetry/exporters.ts
    apps/server/src/telemetry/instrumentation.ts
    apps/server/src/telemetry/metrics.ts
    apps/server/src/telemetry/spans.ts
    apps/server/src/telemetry/langfuse.ts
    apps/server/src/telemetry/index.ts
    apps/server/src/telemetry/README.md

Update `apps/server/src/index.ts` so telemetry starts before server app creation and shuts down during graceful shutdown. The expected shape is:

    initializeLogger()
    initializeTelemetry()
    installProcessFatalHandlers()
    ...
    finally {
      await shutdownTelemetry()
      flushLogger()
      process.exit(0)
    }

If imports prevent early instrumentation, split startup into a tiny bootstrap file that initializes telemetry, then dynamically imports the rest of the server entry. Record the exact choice in the Decision Log before implementing.

Update AI SDK telemetry gates:

    rg -n "langfuseEnabled|initializeLangfuse|experimental_telemetry" apps/server/src

Expected after Milestone 2: no AI SDK module imports `langfuseEnabled`; they import a telemetry-owned helper. Langfuse-specific code remains only under `apps/server/src/telemetry/langfuse.ts` or a compatibility shim.

Add runtime snapshot schemas and route under `apps/server/src/modules/observability/`. Follow the server-app-development skill workflow: update `model.ts` first, add a thin route in `index.ts`, put semantics in `service.ts` or a helper file, and update `README.md`. Add `x-cradle-cli` metadata for `GET /observability/runtime-snapshot` because it is useful to agents and scripts:

    detail: {
      'summary': 'Get runtime observability snapshot',
      'x-cradle-cli': {
        command: ['observability', 'runtime-snapshot'],
      },
    }

Skip `x-cradle-cli` for internal producer routes such as `POST /observability/runtime-samples` or heap snapshot trigger routes, because those are not stable shell commands and may involve sensitive local diagnostics.

After route metadata changes, regenerate the CLI:

    pnpm gen:cli
    pnpm --filter @cradle/cli typecheck
    pnpm --filter @cradle/cli cradle observability --help

Expected help output should include a generated `runtime-snapshot` command after the generator completes.

Run focused server validation:

    pnpm --filter @cradle/server exec vitest run tests/health.test.ts tests/observability.test.ts
    pnpm typecheck:server

If route metadata changed and generated CLI files changed:

    pnpm --filter @cradle/cli typecheck

For manual local verification, start the server with local OTEL enabled but no external backend required:

    CRADLE_OTEL_ENABLED=1 CRADLE_OTEL_TRACES_ENABLED=1 CRADLE_OTEL_METRICS_ENABLED=1 pnpm dev:server

Then in another terminal:

    pnpm --filter @cradle/cli cradle health
    pnpm --filter @cradle/cli cradle observability runtime-snapshot

Expected snapshot output should include `server`, `chatRuntime`, `providerRuntime`, `pty`, `chronicle`, and `observability` sections. Values may be zero or null when no runs, terminals, or Chronicle daemon are active.

## Validation and Acceptance

Acceptance is behavioral. First, the server can start with `CRADLE_OTEL_ENABLED=1` and no Langfuse credentials. In that mode, AI SDK telemetry and server spans are enabled for OTEL, while no Langfuse export occurs. The logs should say telemetry is enabled and Langfuse export is disabled or unavailable.

Second, the server can start with Langfuse credentials and `CRADLE_LANGFUSE_ENABLED=1`. In that mode, existing AI SDK traces continue to reach Langfuse, but the same telemetry runtime also supports OTLP traces and metrics when OTLP endpoints are configured.

Third, when a request records an observability event while a span is active, `GET /observability/events` returns an event whose `traceId` matches the active trace. The server log line emitted in the same operation also contains that trace id. This proves trace-log-event correlation.

Fourth, `GET /observability/runtime-snapshot` returns HTTP 200 and a structured JSON body. In an idle server, it still shows the server memory/CPU section, observability queue health, zero active chat runs, zero or empty provider hosts, terminal totals, and Chronicle daemon running false or null resources. When a PTY session or Chronicle daemon is active, the corresponding sections show non-zero process facts.

Fifth, metrics export uses stable low-cardinality labels. Inspect emitted metric names or Prometheus output and verify that no label contains session ids, run ids, file paths, prompts, or full error messages. The expected label examples are `process="server"`, `kind="rss"`, `runtime_kind="codex"`, and `role="cli-tui"`.

Sixth, tests pass:

    pnpm --filter @cradle/server exec vitest run tests/health.test.ts tests/observability.test.ts
    pnpm typecheck:server

If `x-cradle-cli` metadata is added for `runtime-snapshot`, generated CLI validation also passes:

    pnpm gen:cli
    pnpm --filter @cradle/cli typecheck
    pnpm --filter @cradle/cli cradle observability --help

Seventh, heap snapshot diagnostics are disabled by default. A request to the heap snapshot route without `CRADLE_DIAGNOSTICS_ENABLED=1` should return an explicit disabled or not-found response. With diagnostics enabled and local authorization satisfied, it writes a snapshot into the Cradle data directory, records an observability event, and returns a local path. The endpoint must not be externally exposed without an explicit diagnostic opt-in.

## Idempotence and Recovery

The dependency installation can be repeated with pnpm. If a package version conflicts with the existing OpenTelemetry versions brought by Langfuse, prefer aligning all OpenTelemetry packages to the compatible versions resolved by pnpm rather than mixing multiple SDK major versions. If `pnpm install` or `pnpm add` changes unrelated dependency versions, inspect the lockfile before proceeding.

Telemetry startup must tolerate missing exporter configuration. If OTLP endpoints are absent, the server should still start and either export nothing or use a local/debug exporter only when explicitly configured. If Langfuse credentials are missing, Langfuse export should be disabled without disabling Cradle OTEL spans or metrics.

Runtime snapshot must be safe to call repeatedly. It reads current in-memory/process facts and should not mutate feature state. Desktop runtime samples should be bounded in memory so a reporter bug cannot grow server memory without limit. Use a small ring buffer or latest-sample map keyed by process role/type, not append-only durable storage.

Metrics registration must be idempotent in tests and hot-reload-like dev scenarios. Avoid registering duplicate instruments with the same name when modules are imported multiple times. If necessary, centralize instrument creation in `apps/server/src/telemetry/metrics.ts` and expose update functions instead of creating instruments in feature modules.

Heap snapshot routes are risky by design. They should be retried only in local/dev sessions. If a snapshot fails, record an observability event with failure metadata and return a clear error. Do not delete existing diagnostic artifacts on failure. Do not write snapshots outside `CRADLE_DATA_DIR` or another explicit Cradle-owned diagnostics directory.

Because the worktree is dirty, do not run destructive git commands. Do not revert unrelated user changes. If verification fails due to unrelated modified files, record the exact files and errors in this plan and run the narrowest validation commands that cover the telemetry changes.

## Artifacts and Notes

Current pre-implementation evidence:

    apps/server/src/langfuse.ts:
      const provider = new BasicTracerProvider({
        spanProcessors: [new LangfuseSpanProcessor()],
      })
      trace.setGlobalTracerProvider(provider)

    apps/server/src/modules/chat-runtime-engine/ai-sdk-engine.ts:
      experimental_telemetry: langfuseEnabled

    apps/server/src/modules/health/service.ts:
      const mem = process.memoryUsage()

    apps/server/src/modules/pty/pty.runtime.ts:
      const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,rss=,pcpu='])

Expected post-implementation evidence:

    apps/server/src/telemetry/index.ts:
      export function initializeTelemetry(): void
      export async function shutdownTelemetry(): Promise<void>

    apps/server/src/telemetry/config.ts:
      export function getTelemetryConfig(): TelemetryConfig
      export function telemetryEnabled(): boolean
      export function aiTelemetryEnabled(): boolean

    apps/server/src/modules/observability/index.ts:
      .get('/runtime-snapshot', ...)

    packages/cli/src/commands/generated/observability/runtime-snapshot.ts:
      generated by pnpm gen:cli

    apps/server/src/modules/observability/diagnostics.ts:
      export async function writeHeapSnapshot(...)

    apps/desktop/src/main/observability-reporter.ts:
      export function startDesktopResourceReporting(intervalMs?: number): void

    apps/server/scripts/leak-harness.ts:
      samples /observability/runtime-snapshot and reports memory deltas

Manual verification transcript after implementation:

    $ CRADLE_OTEL_ENABLED=1 CRADLE_OTEL_TRACES_ENABLED=1 CRADLE_OTEL_METRICS_ENABLED=1 NODE_ENV=development pnpm exec tsx -e "..."
    [telemetry] OpenTelemetry enabled service=cradle-server traces=true metrics=true
    [telemetry] Langfuse exporter disabled
    telemetry-ok

    $ pnpm --filter @cradle/cli cradle observability runtime-snapshot
    {
      "server": { "pid": 12345, "memory": { "rssMB": 180.3, ... } },
      "chatRuntime": { "activeRuns": [] },
      "providerRuntime": { "hosts": [] },
      "pty": { "terminals": [], "totals": ... },
      "chronicle": { "running": false, "pid": null, ... },
      "observability": { "queueDepth": 0, "droppedEvents": 0 }
    }

    $ pnpm --filter @cradle/cli cradle observability --help
    Commands:
      runtime-snapshot [options]  Get runtime observability snapshot

    $ trace correlation verification
    events 1 traceId=yes otelAttrs=yes

    $ diagnostics disabled verification
    heap 404 {"code":"diagnostics_disabled","message":"Diagnostics endpoints are disabled"}

Revision note 2026-06-08: Initial plan created after the user requested an ExecPlan for improving Cradle observability with a fuller OpenTelemetry runtime and optional Grafana/profiling integration.

Revision note 2026-06-08 02:12 CST: Updated the living plan after implementation. Marked milestones complete, recorded validation, documented OpenTelemetry API callback behavior, CLI generation drift, logger flush hardening, desktop sample ownership, and guarded heap snapshot diagnostics.

Revision note 2026-06-08 02:15 CST: Added the leak harness script and updated validation evidence so Milestone 5 includes repeatable runtime-snapshot sampling, not only heap snapshot diagnostics.

Revision note 2026-06-08 02:32 CST: Added automatic runtime metric sampling, broadened custom metric coverage to currently available low-cardinality facts, removed Prometheus double-prefix risk, and recorded scrape verification evidence.

## Interfaces and Dependencies

In `apps/server/src/telemetry/config.ts`, define a typed configuration:

    export interface TelemetryConfig {
      enabled: boolean
      serviceName: string
      environment: string
      tracesEnabled: boolean
      metricsEnabled: boolean
      logCorrelationEnabled: boolean
      otlpEndpoint: string | null
      otlpTracesEndpoint: string | null
      otlpMetricsEndpoint: string | null
      langfuseEnabled: boolean
      profilingEnabled: boolean
      diagnosticsEnabled: boolean
    }

Expose helpers:

    export function getTelemetryConfig(): TelemetryConfig
    export function telemetryEnabled(): boolean
    export function aiTelemetryEnabled(): boolean
    export function langfuseExporterEnabled(): boolean

In `apps/server/src/telemetry/index.ts`, expose lifecycle:

    export function initializeTelemetry(): void
    export async function shutdownTelemetry(): Promise<void>

In `apps/server/src/telemetry/spans.ts`, expose helpers for feature modules:

    export function startCradleSpan<T>(
      name: string,
      attrs: Record<string, unknown>,
      fn: () => T,
    ): T

    export async function startCradleSpanAsync<T>(
      name: string,
      attrs: Record<string, unknown>,
      fn: () => Promise<T>,
    ): Promise<T>

The helpers should keep feature code concise and should not force every module to import low-level OTEL APIs.

In `apps/server/src/telemetry/metrics.ts`, expose metric update functions:

    export function updateServerProcessMetrics(snapshot: ServerProcessMetrics): void
    export function updateChatRuntimeMetrics(snapshot: ChatRuntimeMetricSnapshot): void
    export function updateProviderRuntimeMetrics(snapshot: ProviderRuntimeMetricSnapshot): void
    export function updatePtyMetrics(snapshot: PtyMetricSnapshot): void
    export function updateChronicleMetrics(snapshot: ChronicleMetricSnapshot): void
    export function recordObservabilityDroppedEvents(count: number): void

In `apps/server/src/modules/observability/model.ts`, add TypeBox schemas for runtime snapshot. The shape should include:

    server: {
      pid: number
      uptimeSeconds: number
      memory: { rssMB, heapUsedMB, heapTotalMB, externalMB, arrayBuffersMB? }
      cpu: { percent, userMicros, systemMicros, sampleMs, usedMicros, windowReady }
    }
    chatRuntime: {
      activeRuns: Array<{ runId, sessionId, runtimeKind?, providerTargetKind?, modelId? }>
      replayBuffers: Array<{ runId, chunkCount, textDeltaCount, reasoningDeltaCount, toolInputDeltaCount, toolOutputCount, maxDeltaChars }>
    }
    providerRuntime: {
      hosts: Array<{ hostId, runtimeKind, providerTargetId, scopeId, refCount, pinnedCount, hasResource, expiresAt, updatedAt }>
    }
    pty: existing terminal resources response shape
    chronicle: { running, pid, rssMB, cpuPercent }
    desktop: optional latest samples
    observability: { queueDepth, recentEvents, droppedEvents, pendingFlush }

If any field requires a high-cardinality id, keep it in the JSON snapshot only. Do not mirror it as a metric label.

In `apps/desktop/src/main/observability-reporter.ts`, add:

    export function startDesktopResourceReporting(intervalMs?: number): void
    export function stopDesktopResourceReporting(): void

The reporter should post to a server route only after `bindDesktopObservabilityServerUrl(url)` has been called. It should use bounded retry behavior and should drop old samples when the server is unavailable, because resource samples are diagnostic telemetry rather than durable product data.

OpenTelemetry dependencies to use are:

    @opentelemetry/sdk-node
    @opentelemetry/sdk-trace-node
    @opentelemetry/sdk-metrics
    @opentelemetry/exporter-trace-otlp-http
    @opentelemetry/exporter-metrics-otlp-http
    @opentelemetry/auto-instrumentations-node
    @opentelemetry/instrumentation-runtime-node
    @opentelemetry/instrumentation-pino
    @opentelemetry/host-metrics
    @opentelemetry/resources
    @opentelemetry/semantic-conventions

Optional dependencies:

    @opentelemetry/exporter-prometheus
    @pyroscope/nodejs

Use official OpenTelemetry package APIs rather than inventing a custom telemetry abstraction for core SDK behavior. The Cradle-specific layer should be limited to ownership, configuration, semantic span helpers, and safe runtime snapshot/diagnostics surfaces.
