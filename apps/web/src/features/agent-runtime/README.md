<!-- Once this directory changes, update this README.md -->

# Features/Agent-Runtime

Renderer data hooks for Agent Runtime profiles, Agent identities, and transitional session state.
This feature exposes unified Agent Profile query ownership plus Agent entity CRUD to launchers and settings.
Provider execution and credentials remain in the Electron main process.
Model visibility semantics are owned here: missing or empty `enabledModels` means all provider models are visible, the sentinel disables all models, and a non-empty list is an explicit allow-list.

## Files

- **model-visibility.ts**: Shared helpers for interpreting provider model visibility config and filtering model descriptors
- **model-visibility.test.ts**: Unit coverage for default-all, all-disabled, and explicit allow-list model visibility semantics
- **use-agent-profiles.ts**: `useAgentProfiles` hook — owns unified Agent Runtime profile query state and update/delete mutations, invalidating model queries when profile config changes
- **use-agents.ts**: `useAgents` hook — CRUD for Agent identity entities (TanStack Query mutations)
- **use-agent-models.ts**: `useAgentModels` and `useAgentModelMap` hooks — fetch visible models for one profile or a profile-keyed composer model map, with shared query-key ownership
- **use-acp-agents.ts**: Transitional `useInstalledAcpAgents` hook backed by unified profiles
- **use-acp-session-state.ts**: Transitional no-op ACP session state hook retained while provider-level model state is rewired
- **index.ts**: Barrel export
