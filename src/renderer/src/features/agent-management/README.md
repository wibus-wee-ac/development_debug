<!-- Once this directory changes, update this README.md -->

# Features/Agent Management

Unified settings feature for Agent Runtime profiles.
This feature owns profile CRUD UI across ACP, CLI TUI, Codex App Server, and OpenAI-compatible providers.
Provider execution and secrets remain in the Electron main process.

## Files

- **agent-runtime-settings.tsx**: AgentRuntimeSettings component — unified Agent Profile management UI.
- **index.ts**: Barrel export for the agent management feature.
