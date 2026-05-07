# Cradle User Documentation

This documentation set is written for two audiences:

- End users who use Cradle as a local-first desktop workspace for AI-assisted development.
- Integration developers who automate Cradle through its CLI and typed IPC bridge.

## Document Map

- [Quick Start](./quick-start.md): Install, first-run setup, and first successful session.
- [End User Guide](./end-user-guide.md): Daily workflows across workspaces, chat, TUI, Kanban, usage, and settings.
- [Integrations Guide](./integrations-guide.md): Integration architecture, IPC bridge model, event model, and safety boundaries.
- [CLI Reference](./cli-reference.md): Full `cradle` CLI command reference with practical examples.
- [IPC API Reference](./ipc-api-reference.md): Renderer-facing IPC namespaces and methods exposed by Cradle.
- [Data Model & Storage](./data-model-and-storage.md): Core entities, persistence boundaries, and local data ownership.
- [Troubleshooting](./troubleshooting.md): Operational issues, diagnostics, and recovery paths.

## Product Scope Covered By This Docs Set

- Workspace-centric local operation (no cloud dependency required for app state).
- Provider-driven session rendering:
  - Structured chat sessions for chat-capable providers.
  - Native terminal sessions for `cli-tui` providers.
- Lifecycle controls for providers, agent identities, sessions, and issue delegation.
- Local observability (IPC, ACP, Agent Context, and observability buffers) via Devtool.
- Integrations through:
  - Renderer preload bridge (`window.ipc`, `window.cradle`, `window.ipcDevtool`).
  - Socket-based JSON-RPC CLI (`cradle` command).

## Versioning Notes

This documentation reflects the current repository behavior as of the latest committed code in this workspace. If you are extending Cradle, treat this folder as the user-facing contract and update it alongside behavior changes.
