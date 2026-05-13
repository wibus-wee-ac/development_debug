# Chat Runtime Module

Provides server-owned chat turn execution for existing sessions, including timeline persistence, usage writes, SSE streaming, run state updates, and ACP live runtime orchestration.
Route metadata includes `x-cradle-cli` descriptors for non-streaming generated CLI commands.

## Files

- `chat-runtime.module.ts`: Tsuki module registration.
- `chat-runtime.controller.ts`: HTTP endpoints for run creation, timeline hydration, SSE stream, and run state updates.
- `chat-runtime.service.ts`: active-run orchestration and event broadcasting.
- `chat-runtime.store.ts`: DB-backed message/run/timeline/usage persistence.
- `chat-turn-context.ts`: system prompt and history resolution.
- `chat-runtime-provider-registry.ts`: runtime provider registry for ACP Chat, OpenAI-compatible, Claude Agent, and Codex backends.
- `providers/`: concrete runtime providers grouped by backend owner.
	- `providers/acp/config.ts`: ACP runtime config parser for chat-owned profiles.
	- `providers/acp/process-manager.ts`: server-owned ACP subprocess supervisor without Electron shell coupling.
	- `providers/acp/connection-manager.ts`: ACP connection/session/prompt manager for unified chat runtime.
	- `providers/acp/runtime-integration.ts`: bridges ACP approvals and title updates into server approval/session owners.
	- `providers/acp/provider.ts`: ACP Chat provider bound to the unified `/chat` API.
	- `providers/acp/timeline-mapper.ts`: ACP session updates → unified chat timeline mapper.
	- `providers/openai-compatible/provider.ts`: OpenAI-compatible SSE parser and turn runtime.
	- `providers/claude-agent/provider.ts`: Claude Agent SDK runtime bound to the unified `/chat` API.
	- `providers/claude-agent/mapper.ts`: Claude Agent SDK message → unified timeline mapper.
	- `providers/codex/provider.ts`: Codex SDK runtime bound to the unified `/chat` API.
	- `providers/codex/mapper.ts`: Codex SDK thread event → unified timeline mapper.
- `runtime-provider-types.ts`: chat runtime provider contracts.
- `timeline-events.ts`: typed timeline event codec helpers.
