<!-- Once this directory changes, update this README.md -->

# Features/Agent Management

Unified settings feature for Provider (agent_profiles) and Agent identity management.
Provider CRUD covers ACP, CLI TUI, and OpenAI-compatible providers.
Agent identity CRUD provides name, DiceBear avatar, model preference, thinking effort, and per-agent skill selection.

## Files

- **agent-list.tsx**: AgentList settings page — inline expand-to-create Agent editor with DiceBear avatar picker, system prompt, and per-agent skill configuration
- **agent-runtime-settings.tsx**: AgentRuntimeSettings component — unified Agent Profile management UI
- **agents-settings.tsx**: AgentsSettings (Providers) — ACP Registry + manual provider profile CRUD
- **acp-settings.tsx**: Legacy ACP settings (superseded by agents-settings.tsx)
- **index.ts**: Barrel export for the agent management feature
