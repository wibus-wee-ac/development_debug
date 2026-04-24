<!-- Once this directory changes, update this README.md -->

# Features/Agent-Runtime

Renderer data hooks for Agent Runtime profiles and transitional session state.
This feature exposes unified Agent Profile lists to launchers and settings.
Provider execution and credentials remain in the Electron main process.

## Files

- **use-agent-profiles.ts**: `useAgentProfiles` hook — queries unified Agent Runtime profiles
- **use-acp-agents.ts**: Transitional `useInstalledAcpAgents` hook backed by unified profiles
- **use-acp-session-state.ts**: Transitional no-op ACP session state hook retained while provider-level model state is rewired
- **index.ts**: Barrel export
