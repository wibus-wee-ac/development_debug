<!-- Once this directory changes, update this README.md -->

# Features/Agent-Runtime

Domain for ACP agent runtime management: installed agents, session state, model/config preferences.
Separated from `features/workspace/` to give agent-runtime concerns their own clear boundary.
Consumed by chat route, new-chat-home, and model pickers.

## Files

- **use-acp-agents.ts**: `useInstalledAcpAgents` hook — queries and caches the list of installed ACP agents
- **use-acp-session-state.ts**: `useAcpSessionState` hook and query helpers — manages ACP session model and config options
- **index.ts**: Barrel export
