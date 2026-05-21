<!-- Once this directory changes, update this README.md -->

# Docs/Exec-Plans

Living execution plans for complex changes are stored here.
Each plan must follow the repository ExecPlan format and remain self-contained as work evolves.
Use date-prefixed filenames so contributors can find the latest plan quickly.

Current canonical backend implementation for active product work lives under `apps/server/src/modules/`, `apps/server/src/helpers/`, and related `apps/server` HTTP/runtime infrastructure. Many older plans in this directory still reference historical Electron main-process paths such as `src/main/features/`, `src/main/services/`, `src/main/contexts/`, or `src/main/lib/`; treat those as historical unless a newer note says otherwise.

## Files

- **20260418-01-chat-feature.md**: Historical execution plan for the earliest ACP-backed Electron chat implementation before the later server-owned snapshot + delta runtime.
- **20260418-02-ipc-devtool-backend.md**: Execution plan for an IPC-only devtool backend and event pipeline.
- **20260420-01-stream-provider-refactor.md**: Historical execution plan for an older Electron IPC chat stream refactor before the later server-owned snapshot + delta runtime.
- **20260420-02-cli-tui-provider.md**: Execution plan for adding a `cli-tui` provider kind to support Claude Code CLI, Codex CLI, and similar terminal UI tools as first-class session types rendered via xterm.js.
- **20260424-01-agent-runtime-provider-layer.md**: Historical execution plan for an early Agent Runtime Provider layer consolidation phase; includes now-historical provider-matrix details such as `codex-app-server` and predates the canonical snapshot + delta chat runtime.
- **20260423-01-kanban-system.md**: Execution plan for a standalone Kanban system with workspaces as projects, status-based columns, boards, milestones, issues (with sub-issues and comments), and an issue side panel.
- **20260425-01-unified-chat-event-bridge.md**: Historical execution plan for the old Electron IPC chat push bridge (`chat:response-event`) before the later server-owned SSE chat runtime replaced it.
- **20260425-02-thread-search-fts5.md**: Execution plan for replacing the full-table-scan thread search with SQLite FTS5 full-text search, including jieba Chinese segmentation and BM25 ranking.
- **20260425-03-bundle-code-splitting.md**: Execution plan for activating TanStack Router lazy routes to code-split heavy route bundles (chat/xterm, workspace-detail/tiptap, kanban/dnd-kit).
- **20260426-01-cost-dashboard.md**: Execution plan for token usage tracking pipeline and dashboard with heatmap, sparkline, and stats.
- **20260426-02-task-system-foundation.md**: Execution plan for a Task System covering pending runs (human-in-the-loop checkpoints), scheduled tasks, and agent-to-agent handoff.
- **20260430-01-skills-management-system.md**: Execution plan for a filesystem-first Skills management system covering global/workspace CRUD, per-agent skill selection, and import/export without storing skill content in the DB.
- **20260504-01-backend-application-event-pipeline.md**: Execution plan for introducing backend application-layer delegation orchestration and a domain event pipeline bridge for chat turn lifecycle.
- **20260504-02-kanban-write-application-boundary.md**: Execution plan for moving Kanban write-side commands into the application layer, deleting dead delegation code, and validating the thinner IPC facade.
- **20260505-01-kanban-read-query-boundary.md**: Execution plan for moving Kanban read-side queries into an application-layer query boundary so `KanbanService` can become a pure facade.
- **20260505-02-main-context-ownership-overhaul.md**: Execution plan for moving active Kanban and issue-agent backend code into context-owned directories under `src/main/contexts/`.
- **20260505-03-db-schema-context-split.md**: Execution plan for replacing the monolithic main-process DB schema with context-owned modules under `src/main/db/schema/`.
- **20260505-04-issue-agent-ipc-ownership-split.md**: Execution plan for moving issue-agent delegation/session/activity IPC out of the `kanban` namespace into a dedicated `issueAgent` service.
- **20260505-05-context-owned-ipc-adapters.md**: Execution plan for moving Kanban and issue-agent IPC adapters out of the root `services/` bucket into their owner contexts under `src/main/contexts/*/interfaces/`.
- **20260505-06-backend-control-plane-schema.md**: Execution plan for introducing Cradle-owned backend bindings, runs, and capability snapshots so app sessions no longer store provider-native state directly, now implemented with fresh-DB migration and E2E validation notes.
- **20260505-07-normalized-activity-timeline.md**: Historical execution plan for the timeline-facts chat architecture that preceded the later `messages.messageJson` snapshot rewrite.
- **20260505-08-approval-mediation-foundation.md**: Execution plan for adding a shared approval queue and renderer surface for interactive backends without faking uniform approval semantics where they do not exist.
- **20260505-09-skills-routing-control-plane.md**: Execution plan for adding product-owned skill routing intent and compatibility mapping while keeping skill content filesystem-first.
- **20260505-10-skills-cache-and-ipc-thinning.md**: Execution plan for adding in-process skills scan caching and moving `workspace` / `acp` business semantics out of thick IPC adapters into feature-owned application services.
- **20260505-11-singleton-dehydration-frontend-projection.md**: Historical execution plan for dehydrated timeline-facts frontend projection before the snapshot + delta rewrite.
- **20260505-12-uimessage-dehydration.md**: Historical execution plan for timeline-facts-based UIMessage dehydration before the snapshot + delta rewrite.
- **20260507-01-observability-with-minimal-conversions.md**: Execution plan for sharpening observability without introducing broad conversion layers.
- **20260503-01-agentic-provider-foundation.md**: Historical execution plan for an intermediate provider-layer stage that predates the canonical snapshot + delta chat runtime.
- **20260509-01-apps-web-frontend-migration.md**: Historical execution plan for the web frontend migration, including an earlier chat transport transition narrative.
- **20260507-02-session-await-resume-runtime.md**: Execution plan for introducing a product-owned session await/resume runtime, CLI registration contract, awaiting projection, and later GitHub adapters without making Kanban the owner.
- **20260510-01-apps-server-elysia-replatform.md**: Execution plan for destructively replatforming `apps/server` from the Tsuki/Hono metadata runtime to Elysia with explicit composition, schema-first routes, stable OpenAPI generation, and web contract recovery.
- **20260512-01-agent-runtime-alma-inspired-upgrades.md**: Execution plan for agent runtime core upgrades inspired by Alma architecture analysis, covering approval enhancement, delta SSE, agentic loop control, network resilience, and run lifecycle.
- **20260512-02-vercel-ai-sdk-migration.md**: Historical execution plan for an earlier AI SDK migration stage before the canonical `messages.messageJson` snapshot + sequenced SSE delta runtime.
- **20260512-03-tool-approval-native-ai-sdk.md**: Execution plan for integrating AI SDK native `needsApproval` tool approval into the openai-compatible provider, with policy-key auto-approval and frontend approval UI.
- **20260512-04-auto-compaction.md**: Execution plan for automatic context window management via `prepareStep`, implementing sliding window compaction and optional summarization for long sessions.
- **20260512-05-cost-dashboard-per-step-tracking.md**: Execution plan for per-step token usage tracking via `onStepFinish`, model-based cost estimation, optional budget controls, and a cost dashboard frontend.
- **20260513-02-zustand-streaming-data-layer.md**: Historical execution plan for an older `useChat`/chunk-accumulator frontend streaming layer before snapshot + delta hydration became canonical.
- **20260515-01-system-agent-architecture.md**: Architecture and integration plan for the System Agent, covering HiJarvis integration, context reporting, plugin hooks, and streaming bridge design.
- **20260515-02-pty-websocket-live-channel.md**: Execution plan for refactoring PTY live transport to a WebSocket session channel while keeping HTTP-owned lifecycle, splitting runtime/timeline/transport ownership, and adding user-visible terminal regression validation.
- **20260516-01-chat-boundary-cleanup.md**: Historical execution plan for chunk-replay-era chat boundary cleanup before the later message snapshot rewrite superseded its core assumptions.
- **20260516-02-cli-tui-launch-ownership-cleanup.md**: Execution plan for moving CLI TUI launch ownership to agent/session config and restoring the launch entry through the composer.
- **20260516-03-message-snapshot-chat-runtime.md**: Canonical current execution plan for the breaking rewrite from chunk persistence/timeline replay to `messages.messageJson` snapshots plus sequenced SSE delta events.
- **20260519-03-cradle-chronicle.md**: Execution plan for building the first Cradle-owned Rust Chronicle crate with synthetic smoke capture, artifact storage, privacy filtering, deduplication, and memory summary generation.
- **20260521-05-cc-switch-provider-mirror.md**: CC Switch provider 与 CCDB catalog 镜像调研规格，覆盖外部 provider 到 Cradle-owned profiles 的投影、非 provider 对象的只读 snapshot，以及 plugin/SDK 可行性缺口。
- **20260521-07-alma-cradle-gap-analysis.md**: Alma 与 Cradle 功能差异研究计划，覆盖 Alma packaged app 证据审计、Cradle 能力对比、缺口综合报告，以及 Alma-inspired specs 拆解。
