<!-- Once this directory changes, update this README.md -->

# Features/Agent-Runtime

Renderer data hooks for Agent Runtime profiles, Agent identities, and transitional session state.
This feature exposes unified Agent Profile query ownership plus Agent entity CRUD to launchers and settings.
Provider execution and credentials remain in the Electron main process.

## Files

- **use-agent-profiles.ts**: `useAgentProfiles` hook — owns unified Agent Runtime profile query state and update/delete mutations
- **use-agents.ts**: `useAgents` hook — CRUD for Agent identity entities (TanStack Query mutations)
- **use-agent-models.ts**: `useAgentModels` hook — fetches available models for a given provider profile
- **use-acp-agents.ts**: Transitional `useInstalledAcpAgents` hook backed by unified profiles
- **use-acp-session-state.ts**: Transitional no-op ACP session state hook retained while provider-level model state is rewired
- **index.ts**: Barrel export
