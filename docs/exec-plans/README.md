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
