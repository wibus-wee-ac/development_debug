<!-- Once this directory changes, update this README.md -->

# Docs/Exec-Plans

Living execution plans for complex changes are stored here.
Each plan must follow the repository ExecPlan format and remain self-contained as work evolves.
Use date-prefixed filenames so contributors can find the latest plan quickly.

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
