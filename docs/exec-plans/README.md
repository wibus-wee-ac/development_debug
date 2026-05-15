<!-- Once this directory changes, update this README.md -->

# Docs/Exec-Plans

Living execution plans for complex changes are stored here.
Each plan must follow the repository ExecPlan format and remain self-contained as work evolves.
Use date-prefixed filenames so contributors can find the latest plan quickly.

Current canonical main-process backend paths after the 2026-05-05 ownership refactor are under `src/main/features/`, `src/main/app/ipc/`, `src/main/platform/`, and `src/main/events/`. Older plans may still reference pre-refactor locations such as `src/main/application/`, `src/main/services/`, `src/main/contexts/`, or `src/main/lib/`.

## Files

- **20260418-01-chat-feature.md**: Execution plan for building ACP-backed chat in the Electron app.
- **20260418-02-ipc-devtool-backend.md**: Execution plan for an IPC-only devtool backend and event pipeline.
- **20260420-01-stream-provider-refactor.md**: Execution plan for refactoring the chat stream to follow OpenAI Responses API style, introducing a provider abstraction, and adding the sidebar session activity indicator.
- **20260420-02-cli-tui-provider.md**: Execution plan for adding a `cli-tui` provider kind to support Claude Code CLI, Codex CLI, and similar terminal UI tools as first-class session types rendered via xterm.js.
- **20260424-01-agent-runtime-provider-layer.md**: Execution plan for a destructive Agent Runtime Provider layer upgrade covering unified agent profiles, provider catalog, credential storage, ACP/CLI adapters, Codex App Server, and OpenAI-compatible providers.
- **20260423-01-kanban-system.md**: Execution plan for a standalone Kanban system with workspaces as projects, status-based columns, boards, milestones, issues (with sub-issues and comments), and an issue side panel.
- **20260425-01-unified-chat-event-bridge.md**: Execution plan for unifying the three independent `chat:response-event` IPC subscribers into a single preload-wrapped event bridge with `useChatEvents` hook.
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
- **20260505-07-normalized-activity-timeline.md**: Breaking execution plan for deleting raw transport from core, replacing it with typed timeline facts plus reducers/projections, and making chat a pure projection; now implemented with migration, renderer/preload bridge rewrite, and chat E2E regression coverage.
- **20260505-08-approval-mediation-foundation.md**: Execution plan for adding a shared approval queue and renderer surface for interactive backends without faking uniform approval semantics where they do not exist.
- **20260505-09-skills-routing-control-plane.md**: Execution plan for adding product-owned skill routing intent and compatibility mapping while keeping skill content filesystem-first.
- **20260505-10-skills-cache-and-ipc-thinning.md**: Execution plan for adding in-process skills scan caching and moving `workspace` / `acp` business semantics out of thick IPC adapters into feature-owned application services.
- **20260505-11-singleton-dehydration-frontend-projection.md**: Execution plan for removing singleton-driven frontend message assumptions and projecting chat UI directly from dehydrated timeline facts.
- **20260505-12-uimessage-dehydration.md**: Execution plan for migrating renderer chat state to pure UI messages dehydrated from timeline facts.
- **20260507-01-observability-with-minimal-conversions.md**: Execution plan for sharpening observability without introducing broad conversion layers.
- **20260507-02-session-await-resume-runtime.md**: Execution plan for introducing a product-owned session await/resume runtime, CLI registration contract, awaiting projection, and later GitHub adapters without making Kanban the owner.
- **20260510-01-apps-server-elysia-replatform.md**: Execution plan for destructively replatforming `apps/server` from the Tsuki/Hono metadata runtime to Elysia with explicit composition, schema-first routes, stable OpenAPI generation, and web contract recovery.
- **20260512-01-agent-runtime-alma-inspired-upgrades.md**: Execution plan for agent runtime core upgrades inspired by Alma architecture analysis, covering approval enhancement, delta SSE, agentic loop control, network resilience, and run lifecycle.
- **20260512-02-vercel-ai-sdk-migration.md**: Execution plan for migrating the provider layer to Vercel AI SDK v6 as core abstraction, replacing self-built timeline events with native UIMessageChunk, and simplifying the API to a single POST /response SSE endpoint.
- **20260512-03-tool-approval-native-ai-sdk.md**: Execution plan for integrating AI SDK native `needsApproval` tool approval into the openai-compatible provider, with policy-key auto-approval and frontend approval UI.
- **20260512-04-auto-compaction.md**: Execution plan for automatic context window management via `prepareStep`, implementing sliding window compaction and optional summarization for long sessions.
- **20260512-05-cost-dashboard-per-step-tracking.md**: Execution plan for per-step token usage tracking via `onStepFinish`, model-based cost estimation, optional budget controls, and a cost dashboard frontend.
- **20260515-01-system-agent-architecture.md**: Architecture and integration plan for the System Agent, covering HiJarvis integration, context reporting, plugin hooks, and streaming bridge design.
- **20260515-02-pty-websocket-live-channel.md**: Execution plan for refactoring PTY live transport to a WebSocket session channel while keeping HTTP-owned lifecycle, splitting runtime/timeline/transport ownership, and adding user-visible terminal regression validation.
